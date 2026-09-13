/**
 * Client-callable AI surface. All model access goes through the adaptive
 * router; NVIDIA_API_KEY is read only inside handlers and never returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { DeterministicRule, GuardrailConflict } from "./ai/guardrails.server";
import type { ReliabilityAssessment } from "./ai/reliability.server";

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
  /** Authoritative structured state — pinned verbatim, never summarized. */
  protectedContext: z.record(z.string(), z.unknown()).optional(),
  purpose: z.string().max(60).optional(),
});

const RuleSchema = z.object({
  id: z.string().min(1).max(80),
  domain: z.enum([
    "eligibility", "driver_availability", "ride_state", "required_documents",
    "safety", "pricing", "assignment", "geographic",
  ]),
  passed: z.boolean(),
  statement: z.string().min(1).max(500),
  forbids: z.array(z.string().min(1).max(60)).max(10).optional(),
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
  /** Model self-reported confidence. Weak signal — see `reliability`. */
  model_confidence: number;
  reliability: ReliabilityAssessment;
  deterministic_decision: "allowed" | "blocked";
  guardrail_conflicts: GuardrailConflict[];
  ai_overridden: boolean;
  model_used: string;
  tier_used: "fast" | "balanced" | "deep";
  fallback_used: boolean;
  escalated: boolean;
  escalation_reasons: string[];
  reasoning_used: boolean;
  protected_context_pinned: boolean;
  context_trimmed: boolean;
  summarized: boolean;
  latency_ms: number;
};

const AnalyzeInput = z.object({
  question: z.string().min(1).max(40_000),
  /** Deterministic facts computed by application logic — the AI analyses, it does not invent them. */
  facts: z.record(z.string(), z.unknown()).optional(),
  /** Names of facts this decision needs; drives the input-completeness signal. */
  requiredFacts: z.array(z.string().min(1).max(60)).max(40).optional(),
  /** Authoritative structured state, pinned verbatim and never summarized. */
  protectedContext: z.record(z.string(), z.unknown()).optional(),
  /** Deterministic rule outcomes; these override any AI recommendation. */
  rules: z.array(RuleSchema).max(40).optional(),
  tier: TierSchema.optional(),
  /** Caller explicitly wants maximum-depth reasoning. */
  maxDepth: z.boolean().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  purpose: z.string().max(60).optional(),
});

async function rateLimit(supabase: unknown, userId: string, action: string, limit: number) {
  type RpcCaller = { rpc: (fn: never, args: never) => Promise<{ data: unknown }> };
  try {
    const { data } = await (supabase as RpcCaller).rpc("check_and_bump_rate_limit" as never, {
      _action: action,
      _key: `user:${userId}`,
      _limit: limit,
      _window_seconds: 600,
    } as never);
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

async function requireAdmin(context: { supabase: unknown; userId: string }) {
  type RpcCaller = { rpc: (fn: never, args: never) => Promise<{ data: unknown }> };
  const { data } = await (context.supabase as RpcCaller).rpc("has_role" as never, {
    _user_id: context.userId,
    _role: "admin",
  } as never);
  if (data !== true) throw new Error("Admin access required");
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
        protectedContext: data.protectedContext ? JSON.stringify(data.protectedContext, null, 2) : undefined,
        purpose,
      });
      await recordAiEvent(telemetryFromResult(result, { purpose, taskKind, userId: context.userId }));
      return {
        content: result.content,
        reasoning_used: result.reasoningUsed,
        model_used: result.modelUsed,
        tier_used: result.tierUsed,
        fallback_used: result.fallbackUsed,
        latency_ms: result.latencyMs,
        context_trimmed: result.contextTrimmed,
        summarized: result.summarized,
        protected_context_pinned: result.protectedContextPinned,
        usage: result.usage,
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
 * Structured RIE analysis.
 *
 * Deterministic rules are authoritative; the model analyses inside them.
 * Output is schema-validated, scored by the reliability engine (model
 * self-confidence is only one weak input), and escalated to DEEP once when the
 * evidence is weak, constraints conflict, validation fails, or the caller asks
 * for maximum depth.
 */
export const aiAnalyze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data, context }): Promise<RieAnalysis> => {
    const { routeChat, assessComplexity } = await import("./ai/router.server");
    const { recordAiEvent, telemetryFromResult } = await import("./ai/telemetry.server");
    const { evaluateGuardrails } = await import("./ai/guardrails.server");
    const { assessReliability } = await import("./ai/reliability.server");
    const purpose = data.purpose ?? "rie_analyze";
    const minConfidence = data.minConfidence ?? 0.65;
    const rules = (data.rules ?? []) as DeterministicRule[];

    await rateLimit(context.supabase, context.userId, "ai_router_request", 60);

    const guardPreview = evaluateGuardrails(rules, "");
    const system = [
      "You are HarborLine's operations analyst. You ANALYSE deterministic facts supplied by the application; you never invent facts, prices, policies, or availability.",
      "If the facts are insufficient, say so plainly, lower your confidence, and list what is missing under assumptions.",
      "Never reveal internal step-by-step reasoning. Return only the JSON object described below.",
      guardPreview.promptBlock,
      'Respond with json exactly of this shape: {"result": string, "confidence": number between 0 and 1, "assumptions": string[], "risk_flags": string[], "recommended_action": string}',
    ].filter(Boolean).join("\n");

    const factKeys = Object.keys(data.facts ?? {});
    const required = data.requiredFacts ?? [];
    const presentRequired = required.filter((k) => factKeys.includes(k) && data.facts?.[k] != null);
    const inputCompleteness = required.length === 0 ? (factKeys.length > 0 ? 0.8 : 0.4) : presentRequired.length / required.length;
    const missingRequired = required.filter((k) => !presentRequired.includes(k));

    const userContent = [
      data.question,
      data.facts ? `\nVerified facts (authoritative):\n${JSON.stringify(data.facts, null, 2)}` : "",
      missingRequired.length ? `\nMissing required facts: ${missingRequired.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const complexity = assessComplexity(
      [{ role: "user", content: userContent }],
      "operational",
    );

    const escalationReasons: string[] = [];
    if (data.maxDepth) escalationReasons.push("caller_requested_max_depth");
    if (complexity.conflicting) escalationReasons.push("conflicting_constraints");
    if (complexity.large) escalationReasons.push("very_large_context");
    if (rules.some((r) => !r.passed && r.domain === "safety")) escalationReasons.push("safety_rule_violation");

    const initialTier = data.tier ?? (escalationReasons.length > 0 ? "deep" : complexity.tier);

    let schemaValid = false;

    async function attempt(tier: "fast" | "balanced" | "deep") {
      const result = await routeChat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        tier,
        taskKind: "operational",
        json: true,
        longForm: tier === "deep",
        protectedContext: data.protectedContext ? JSON.stringify(data.protectedContext, null, 2) : undefined,
        purpose,
      });
      await recordAiEvent(
        telemetryFromResult(result, { purpose, taskKind: "operational", userId: context.userId }),
      );
      const parsed = RieAnalysisSchema.safeParse(JSON.parse(result.content));
      if (!parsed.success) throw new Error("structured_output_invalid");
      schemaValid = true;
      return { result, analysis: parsed.data };
    }

    try {
      let chosen = await attempt(initialTier);
      let escalated = false;
      let guard = evaluateGuardrails(rules, chosen.analysis.recommended_action);

      let reliability = assessReliability({
        inputCompleteness,
        deterministicRulesPassed: guard.violations.length === 0,
        schemaValid: true,
        contradictions: guard.conflicts.length,
        missingFacts: Math.max(missingRequired.length, chosen.analysis.assumptions.length > 6 ? 1 : 0),
        modelConfidence: chosen.analysis.confidence,
        fallbackUsed: chosen.result.fallbackUsed,
        escalated: false,
      });

      const needsDeeper =
        !data.tier &&
        chosen.result.tierUsed !== "deep" &&
        (chosen.analysis.confidence < minConfidence ||
          reliability.band === "low" ||
          reliability.band === "unusable" ||
          guard.conflicts.length > 0);

      if (needsDeeper) {
        if (chosen.analysis.confidence < minConfidence) escalationReasons.push("low_model_confidence");
        if (reliability.band === "low" || reliability.band === "unusable") escalationReasons.push("low_reliability_assessment");
        if (guard.conflicts.length > 0) escalationReasons.push("guardrail_conflict");
        try {
          const deeper = await attempt("deep");
          chosen = deeper;
          escalated = true;
          guard = evaluateGuardrails(rules, deeper.analysis.recommended_action);
          reliability = assessReliability({
            inputCompleteness,
            deterministicRulesPassed: guard.violations.length === 0,
            schemaValid: true,
            contradictions: guard.conflicts.length,
            missingFacts: missingRequired.length,
            modelConfidence: deeper.analysis.confidence,
            fallbackUsed: deeper.result.fallbackUsed,
            escalated: true,
          });
        } catch {
          escalationReasons.push("deep_escalation_failed");
        }
      }

      const riskFlags = [...chosen.analysis.risk_flags];
      if (reliability.humanReviewRequired) riskFlags.push("human_review_required");
      if (guard.conflicts.length > 0) riskFlags.push("ai_recommendation_conflicts_with_deterministic_rules");
      if (guard.violations.length > 0) riskFlags.push("deterministic_rule_violation");
      if (missingRequired.length > 0) riskFlags.push(`missing_facts:${missingRequired.join("|")}`);

      return {
        ...chosen.analysis,
        // Deterministic rules win: the recommendation is annotated, never trusted blindly.
        recommended_action: guard.aiOverridden
          ? `BLOCKED BY DETERMINISTIC RULES (${guard.conflicts.map((c) => c.ruleId).join(", ")}). ` +
            `AI suggested: ${chosen.analysis.recommended_action}`
          : chosen.analysis.recommended_action,
        risk_flags: riskFlags.slice(0, 12),
        model_confidence: chosen.analysis.confidence,
        reliability,
        deterministic_decision: guard.deterministicDecision,
        guardrail_conflicts: guard.conflicts,
        ai_overridden: guard.aiOverridden,
        model_used: chosen.result.modelUsed,
        tier_used: chosen.result.tierUsed,
        fallback_used: chosen.result.fallbackUsed,
        escalated,
        escalation_reasons: [...new Set(escalationReasons)],
        reasoning_used: chosen.result.reasoningUsed,
        protected_context_pinned: chosen.result.protectedContextPinned,
        context_trimmed: chosen.result.contextTrimmed,
        summarized: chosen.result.summarized,
        latency_ms: chosen.result.latencyMs,
      };
    } catch (e) {
      await recordAiEvent({
        purpose, taskKind: "operational", requestedTier: data.tier ?? null,
        tierUsed: initialTier, modelUsed: null, success: false, fallbackUsed: true,
        errorType: e instanceof Error && e.message === "structured_output_invalid" ? "invalid_json" : "exhausted",
        latencyMs: null, promptTokens: null, completionTokens: null, attempts: [],
        contextTrimmed: false, summarized: false, userId: context.userId,
      });
      void schemaValid;
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
  breakers: Array<{ model: string; open: boolean; reopens_in_ms: number; consecutive_failures: number; last_error: string | null }>;
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

export type ModelHealthRow = {
  model: string;
  pin: "dated" | "alias";
  available: boolean;
  status: number | null;
  latency_ms: number | null;
  note: string;
};

/**
 * Model-drift / retirement detector. NVIDIA exposes no versioned ids for most
 * of these models, so availability is probed instead of pinned.
 */
export const aiModelHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ checked_at: string; models: ModelHealthRow[] }> => {
    await requireAdmin({ supabase: context.supabase, userId: context.userId });
    const { ALL_MODELS } = await import("./ai/registry.server");
    const key = process.env["NVIDIA_API_KEY"];
    if (!key) throw new Error("AI provider is not configured");

    const rows: ModelHealthRow[] = [];
    for (const spec of ALL_MODELS) {
      const t0 = Date.now();
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: spec.id, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        });
        const text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 160);
        rows.push({
          model: spec.id,
          pin: spec.pin,
          available: res.ok,
          status: res.status,
          latency_ms: Date.now() - t0,
          note: res.ok
            ? "reachable"
            : res.status === 404
              ? "not available to this key (retired or renamed)"
              : text || `HTTP ${res.status}`,
        });
      } catch (e) {
        rows.push({
          model: spec.id, pin: spec.pin, available: false, status: null,
          latency_ms: Date.now() - t0,
          note: e instanceof Error ? e.message.slice(0, 160) : "probe failed",
        });
      }
    }
    return { checked_at: new Date().toISOString(), models: rows };
  });

/**
 * Admin-only fallback probe: routes through a chain whose primary model is
 * known to be unavailable to this key, proving failover works end to end.
 * The chain is built server-side; clients cannot choose models.
 */
export const aiFallbackProbe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin({ supabase: context.supabase, userId: context.userId });
    const { routeChat } = await import("./ai/router.server");
    const { TIER_CHAINS } = await import("./ai/registry.server");
    const { recordAiEvent, telemetryFromResult } = await import("./ai/telemetry.server");

    const primary = TIER_CHAINS.fast[0]!;
    const missing = { ...primary, id: "nvidia/nemotron-nano-3-30b-a3b", notes: "probe: known 404" };
    const result = await routeChat({
      messages: [{ role: "user", content: "Reply with exactly: FALLBACK OK" }],
      tier: "fast",
      taskKind: "assistant",
      purpose: "selftest_E_fallback",
      chainOverride: [missing, primary],
    });
    await recordAiEvent(
      telemetryFromResult(result, { purpose: "selftest_E_fallback", taskKind: "assistant", userId: context.userId }),
    );
    return {
      content: result.content,
      model_used: result.modelUsed,
      fallback_used: result.fallbackUsed,
      attempts: result.attempts,
      latency_ms: result.latencyMs,
    };
  });
