/**
 * AI router telemetry. Metadata only — never prompts, completions, reasoning,
 * or secrets. Failures here must never break an AI request.
 */
import type { AttemptRecord, RouteResult } from "./router.server";
import type { TaskKind, Tier } from "./registry.server";

export interface TelemetryInput {
  purpose: string;
  taskKind: TaskKind;
  requestedTier: Tier | null;
  tierUsed: Tier;
  modelUsed: string | null;
  success: boolean;
  fallbackUsed: boolean;
  errorType: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  attempts: AttemptRecord[];
  contextTrimmed: boolean;
  summarized: boolean;
  userId: string | null;
}

export async function recordAiEvent(input: TelemetryInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_router_events").insert({
      purpose: input.purpose,
      task_kind: input.taskKind,
      requested_tier: input.requestedTier,
      tier_used: input.tierUsed,
      model_used: input.modelUsed,
      success: input.success,
      fallback_used: input.fallbackUsed,
      error_type: input.errorType,
      latency_ms: input.latencyMs,
      prompt_tokens: input.promptTokens,
      completion_tokens: input.completionTokens,
      attempts: input.attempts as unknown as never,
      context_trimmed: input.contextTrimmed,
      summarized: input.summarized,
      user_id: input.userId,
    });
  } catch {
    // Observability is best-effort.
  }
}

export function telemetryFromResult(
  result: RouteResult,
  meta: { purpose: string; taskKind: TaskKind; userId: string | null },
): TelemetryInput {
  return {
    purpose: meta.purpose,
    taskKind: meta.taskKind,
    requestedTier: result.requestedTier,
    tierUsed: result.tierUsed,
    modelUsed: result.modelUsed,
    success: true,
    fallbackUsed: result.fallbackUsed,
    errorType: null,
    latencyMs: result.latencyMs,
    promptTokens: result.usage?.prompt_tokens ?? null,
    completionTokens: result.usage?.completion_tokens ?? null,
    attempts: result.attempts,
    contextTrimmed: result.contextTrimmed,
    summarized: result.summarized,
    userId: meta.userId,
  };
}
