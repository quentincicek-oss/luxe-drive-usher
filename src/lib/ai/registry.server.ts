/**
 * HarborLine AI model registry — NVIDIA NIM.
 *
 * Every entry here was verified with a REAL server-side call against the
 * project's NVIDIA_API_KEY on 2026-09-13 (see docs/ai-router.md for the raw
 * benchmark table). Models that returned 404 "not found for account" or timed
 * out are recorded in UNAVAILABLE and must never be used.
 *
 * Server-only module. Never import from client code.
 */

export type Tier = "fast" | "balanced" | "deep";

export type TaskKind =
  | "operational" // deterministic RIE / dispatch decisions
  | "assistant" // normal reasoning / explanation
  | "creative"; // copy generation

export interface ModelSpec {
  id: string;
  /** Verified maximum prompt tokens we are willing to send (probed, conservative). */
  inputBudget: number;
  /** Max completion tokens the endpoint accepted for this model. */
  maxOutput: number;
  supportsTools: boolean;
  supportsJsonObject: boolean;
  /** Model emits internal reasoning. Never forwarded to the browser. */
  reasoning: "none" | "separate_field" | "template_toggle";
  /** For template_toggle models: send chat_template_kwargs.thinking. */
  thinking?: boolean;
  /** Hard per-request timeout, sized from measured p-max latency. */
  timeoutMs: number;
  /** Measured latency on the benchmark reasoning prompt, ms. */
  observedMs: number;
  notes: string;
}

const SUPER_THINK: ModelSpec = {
  id: "nvidia/nemotron-3-super-120b-a12b",
  inputBudget: 180_000,
  maxOutput: 32_768,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "template_toggle",
  thinking: true,
  timeoutMs: 120_000,
  observedMs: 5_217,
  notes: "Verified: correct reasoning, clean content, reasoning in separate field, 180k prompt tokens accepted.",
};

const SUPER_FAST: ModelSpec = {
  ...SUPER_THINK,
  thinking: false,
  timeoutMs: 60_000,
  observedMs: 2_701,
  notes: "Verified: thinking disabled, 2.7s, accurate short answers.",
};

const GPT_OSS: ModelSpec = {
  id: "openai/gpt-oss-20b",
  inputBudget: 90_000,
  maxOutput: 32_768,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "separate_field",
  timeoutMs: 60_000,
  observedMs: 7_137,
  notes: "Verified: 1.0s trivial call, correct reasoning, valid JSON, tool call emitted, 90k prompt tokens accepted.",
};

const GLM_FLASH: ModelSpec = {
  id: "z-ai/glm-5.3-flash",
  inputBudget: 90_000,
  maxOutput: 16_384,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "separate_field",
  timeoutMs: 90_000,
  observedMs: 28_890,
  notes: "Verified: correct, clean, valid JSON, tools OK. Slower than Nemotron Super.",
};

const NEMOTRON_ULTRA: ModelSpec = {
  id: "nvidia/nemotron-3-ultra-550b-a55b",
  inputBudget: 120_000,
  maxOutput: 32_768,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "template_toggle",
  thinking: true,
  timeoutMs: 240_000,
  observedMs: 88_644,
  notes: "Strongest verified NVIDIA model. Capacity-constrained: one probe returned 503 overloaded, so fallback is mandatory.",
};

const KIMI_K3: ModelSpec = {
  id: "moonshotai/kimi-k3",
  inputBudget: 90_000,
  maxOutput: 32_768,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "separate_field",
  timeoutMs: 240_000,
  observedMs: 100_228,
  notes: "Verified: correct and concise, valid JSON, tools OK, 90k prompt tokens accepted. High latency.",
};

const DEEPSEEK_V4_PRO: ModelSpec = {
  id: "deepseek-ai/deepseek-v4-pro-0813",
  inputBudget: 90_000,
  maxOutput: 16_384,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "none",
  timeoutMs: 240_000,
  observedMs: 78_032,
  notes: "Verified: correct, valid JSON, tools OK. High latency, no exposed reasoning field.",
};

const LIGHTNING: ModelSpec = {
  id: "nvidia/nemotron-3.5-lightning-30b-a3b",
  inputBudget: 60_000,
  maxOutput: 8_192,
  supportsTools: true,
  supportsJsonObject: true,
  reasoning: "template_toggle",
  thinking: false,
  timeoutMs: 60_000,
  observedMs: 7_519,
  notes: "Last resort only. Verified reachable but leaked chain-of-thought into content with thinking on and produced invalid JSON in json_object mode.",
};

/** Ordered preference per tier: index 0 is primary, the rest are fallbacks. */
export const TIER_CHAINS: Record<Tier, ModelSpec[]> = {
  fast: [GPT_OSS, SUPER_FAST, LIGHTNING],
  balanced: [SUPER_THINK, GPT_OSS, GLM_FLASH],
  deep: [NEMOTRON_ULTRA, KIMI_K3, DEEPSEEK_V4_PRO, SUPER_THINK],
};

/** Verified as NOT usable by this API key — never route to these. */
export const UNAVAILABLE: Record<string, string> = {
  "nvidia/nemotron-nano-3-30b-a3b": "404 not found for account",
  "moonshotai/kimi-k2.6": "404 not found for account",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": "404 not found for account",
  "google/gemma-4-31b-it": "no response within 240s (twice)",
  "deepseek-ai/deepseek-v4-flash-0731": "no response within 240s (twice)",
  "meta/llama-3.3-70b-instruct": "retired 2026-08-26",
};

/** Sampling policy — never one temperature for everything. */
export function samplingFor(kind: TaskKind, tier: Tier): { temperature: number; top_p: number } {
  if (kind === "operational") return { temperature: tier === "deep" ? 0.15 : 0.1, top_p: 0.9 };
  if (kind === "creative") return { temperature: 0.8, top_p: 0.95 };
  return { temperature: tier === "fast" ? 0.3 : 0.4, top_p: 0.95 };
}

/** Dynamic output budget: generous, but not wasteful. */
export function outputBudget(spec: ModelSpec, tier: Tier, longForm: boolean): number {
  const base = tier === "deep" ? 16_384 : tier === "balanced" ? 6_144 : 2_048;
  return Math.min(spec.maxOutput, longForm ? spec.maxOutput : base);
}
