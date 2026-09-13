/**
 * Client-callable AI surface. All model access goes through the adaptive
 * router; NVIDIA_API_KEY is read only inside handlers and never returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  // Sensible server-side cap: the router does token-aware trimming above this.
  content: z.string().min(1).max(120_000),
});

const TierSchema = z.enum(["fast", "balanced", "deep"]);
const TaskKindSchema = z.enum(["operational", "assistant", "creative"]);

const ChatInput = z.object({
  messages: z.array(MessageSchema).min(1).max(200),
  tier: TierSchema.optional(),
  taskKind: TaskKindSchema.optional(),
  longForm: z.boolean().optional(),
  purpose: z.string().max(60).optional(),
});

/** Structured contract every RIE/backend consumer can rely on. */
export const RieAnalysisSchema = z.object({
  result: z.string().min(1),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()).max(12).default([]),
  risk_flags: z.array(z.string()).max(12).default([]),
  recommended_action: z.string().min(1),
});
export type RieAnalysis = z.infer<typeof RieAnalysisSchema> & {
  model_used: string;
  tier_used: "fast" | "balanced" | "deep";
  fallback_used: boolean;
  escalated: boolean;
  reasoning_summary: string | null;
  latency_ms: number;
};

const AnalyzeInput = z.object({
  question: z.string().min(1).max(40_000),
  /** Deterministic facts computed by application logic — the AI analyses, it does not invent them. */
  facts: z.record(z.string(), z.unknown()).optional(),
  tier: TierSchema.optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  purpose: z.string().max(60).optional(),
});

async function rateLimit(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
  action: string,
  limit: number,
) {
  try {
    const { data } = await supabase.rpc("check_and_bump_rate_limit", {
      _action: action,
      _key: `user:${userId}`,
      _limit: limit,
      _window_seconds: 600,
    });
    const row = Array.isArray(data)
      ? (data[0] as { allowed?: boolean; retry_after?: number } | undefined)
      : (data as { allowed?: boolean; retry_after?: number } | null);
    if (row?.allowed === false) {
      throw new Error(`Too many AI requests. Try again in ${row.retry_after ?? 60}s.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Too many AI requests")) throw e;
    // Fail open on RPC problems, but never on an explicit denial.
  }
}

/** General routed completion. Returns content + routing metadata, never raw reasoning. */
export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ChatInput.parse(data))
  .handler(async ({ data, context }) => {
    const { routeChat } = await import("./ai/router.server");
    const { recordAiEvent, telemetryFromResult } = await import("./ai/telemetry.server");
    const taskKind = data.taskKind ?? "assistant";
    const purpose = data.purpose ?? "ai_chat";

    await rateLimit(context.supabase, context.userId, "ai_router_request", 60);

    try {
      const result = await routeChat({
        messages: data.messages,
        tier: data.tier,
        taskKind,
        longForm: data.longForm,
        purpose,
      });
      await recordAiEvent(telemetryFromResult(result, { purpose, taskKind, userId: context.userId }));
      return {
        content: result.content,
        reasoning_summary: result.reasoningSummary,
        model_used: result.modelUsed,
        tier_used: result.tierUsed,
        fallback_used: result.fallbackUsed,
        latency_ms: result.latencyMs,
        context_trimmed: result.contextTrimmed,
        summarized: result.summarized,
      };
    } catch (e) {
      const err = e as Error & { tier?: "fast" | "balanced" | "deep"; attempts?: [] };
      await recordAiEvent({
        purpose, taskKind, requestedTier: data.tier ?? null,
        tierUsed: err.tier ?? data.tier ?? "balanced", modelUsed: null,
        success: false, fallbackUsed: true,
        errorType: "exhausted", latencyMs: null, promptTokens: null, completionTokens: null,
        attempts: err.attempts ?? [], contextTrimmed: false, summarized: false,
        userId: context.userId,
      });
      throw new Error("AI is temporarily unavailable. Please try again shortly.");
    }
  });

/**
 * Structured RIE analysis. Validates the model's JSON server-side and escalates
 * to the DEEP tier when confidence is below the caller's threshold.
 */
export const aiAnalyze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data, context }): Promise<RieAnalysis> => {
    const { routeChat } = await import("./ai/router.server");
    const { recordAiEvent, telemetryFromResult } = await import("./ai/telemetry.server");
    const purpose = data.purpose ?? "rie_analyze";
    const minConfidence = data.minConfidence ?? 0.65;

    await rateLimit(context.supabase, context.userId, "ai_router_request", 60);

    const system = [
      "You are HarborLine's operations analyst. You ANALYSE deterministic facts supplied by the application; you never invent facts, prices, policies, or availability.",
      "If the facts are insufficient, say so plainly, lower your confidence, and list what is missing under assumptions.",
      "Never reveal internal step-by-step reasoning. Return only the JSON object described below.",
      'Respond with json exactly of this shape: {"result": string, "confidence": number between 0 and 1, "assumptions": string[], "risk_flags": string[], "recommended_action": string}',
    ].join("\n");

    const userContent = data.facts
      ? `${data.question}\n\nVerified facts (authoritative):\n${JSON.stringify(data.facts, null, 2)}`
      : data.question;

    async function attempt(tier: "fast" | "balanced" | "deep" | undefined) {
      const result = await routeChat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        tier,
        taskKind: "operational",
        json: true,
        longForm: tier === "deep",
        purpose,
      });
      await recordAiEvent(
        telemetryFromResult(result, { purpose, taskKind: "operational", userId: context.userId }),
      );
      const parsed = RieAnalysisSchema.safeParse(JSON.parse(result.content));
      if (!parsed.success) throw new Error("structured_output_invalid");
      return { result, analysis: parsed.data };
    }

    try {
      const first = await attempt(data.tier);
      let escalated = false;
      let chosen = first;

      if (!data.tier && first.analysis.confidence < minConfidence && first.result.tierUsed !== "deep") {
        try {
          chosen = await attempt("deep");
          escalated = true;
        } catch {
          chosen = first; // keep the lower-confidence answer, clearly flagged
        }
      }

      return {
        ...chosen.analysis,
        risk_flags:
          chosen.analysis.confidence < minConfidence
            ? [...chosen.analysis.risk_flags, "low_confidence_human_review_required"]
            : chosen.analysis.risk_flags,
        model_used: chosen.result.modelUsed,
        tier_used: chosen.result.tierUsed,
        fallback_used: chosen.result.fallbackUsed,
        escalated,
        reasoning_summary: chosen.result.reasoningSummary,
        latency_ms: chosen.result.latencyMs,
      };
    } catch (e) {
      await recordAiEvent({
        purpose, taskKind: "operational", requestedTier: data.tier ?? null,
        tierUsed: data.tier ?? "balanced", modelUsed: null, success: false, fallbackUsed: true,
        errorType: e instanceof Error && e.message === "structured_output_invalid" ? "invalid_json" : "exhausted",
        latencyMs: null, promptTokens: null, completionTokens: null, attempts: [],
        contextTrimmed: false, summarized: false, userId: context.userId,
      });
      throw new Error("AI analysis could not be produced reliably. No recommendation was generated.");
    }
  });

export type AiRouterReport = {
  as_of: string;
  window_hours: number;
  totals: Record<string, number>;
  by_tier: Array<{ tier: string; requests: number; failures: number; avg_latency_ms: number }>;
  by_model: Array<{ model: string; requests: number; failures: number; avg_latency_ms: number }>;
  by_error: Array<{ error_type: string; occurrences: number }>;
  breakers: Array<{ model: string; open: boolean; reopens_in_ms: number; consecutive_failures: number }>;
  registry: Array<{ tier: string; chain: string[] }>;
};

/** Admin diagnostics for the router. Authorization is enforced in the RPC. */
export const aiRouterReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ hours: z.number().int().min(1).max(720).optional() }).parse(data ?? {}))
  .handler(async ({ data, context }): Promise<AiRouterReport> => {
    const { breakerSnapshot } = await import("./ai/router.server");
    const { TIER_CHAINS } = await import("./ai/registry.server");
    const { data: report, error } = await context.supabase.rpc("admin_ai_router_report", {
      _hours: data.hours ?? 24,
    });
    if (error) throw new Error(error.message);
    return {
      ...(report as unknown as Omit<AiRouterReport, "breakers" | "registry">),
      breakers: breakerSnapshot(),
      registry: (["fast", "balanced", "deep"] as const).map((tier) => ({
        tier,
        chain: TIER_CHAINS[tier].map((m) => m.id),
      })),
    };
  });
