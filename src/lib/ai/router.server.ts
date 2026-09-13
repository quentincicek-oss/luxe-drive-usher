/**
 * HarborLine adaptive AI router (NVIDIA NIM).
 *
 * Server-only. NVIDIA_API_KEY is read inside call sites, never logged, never
 * returned, never sent to the browser. Internal chain-of-thought produced by
 * reasoning models is captured server-side for length accounting only and is
 * NEVER included in the value returned to callers.
 */

import {
  TIER_CHAINS,
  outputBudget,
  samplingFor,
  type ModelSpec,
  type TaskKind,
  type Tier,
} from "./registry.server";

const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

export type Role = "system" | "user" | "assistant";
export interface Msg { role: Role; content: string }

export interface RouteOptions {
  messages: Msg[];
  /** Force a tier. Omit to let the router classify. */
  tier?: Tier;
  taskKind?: TaskKind;
  /** Allow the full model output ceiling (long-form reports, plans). */
  longForm?: boolean;
  /** Ask for a JSON object response and validate it before returning. */
  json?: boolean;
  /** Label used only for diagnostics (no user content). */
  purpose?: string;
}

export interface AttemptRecord {
  model: string;
  ok: boolean;
  ms: number;
  status?: number;
  errorType?: string;
}

export interface RouteResult {
  content: string;
  /** True when the model reasoned internally. The chain-of-thought itself never leaves the server. */
  reasoningUsed: boolean;
  tierUsed: Tier;
  requestedTier: Tier | null;
  modelUsed: string;
  fallbackUsed: boolean;
  attempts: AttemptRecord[];
  latencyMs: number;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  contextTrimmed: boolean;
  summarized: boolean;
}

/* ------------------------------------------------------------------ *
 * Token accounting (character heuristic — no tokenizer in the Worker)
 * ------------------------------------------------------------------ */

const CHARS_PER_TOKEN = 3.6;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);
const messagesTokens = (m: Msg[]) => m.reduce((n, x) => n + estimateTokens(x.content) + 4, 0);

/* ------------------------------------------------------------------ *
 * Complexity classification
 * ------------------------------------------------------------------ */

const DEEP_SIGNALS = [
  "plan", "strategy", "trade-off", "tradeoff", "root cause", "why did", "optimi",
  "reconcile", "conflict", "ambiguous", "multi-step", "step by step", "design",
  "refactor", "debug", "prove", "audit", "risk", "forecast", "escalat",
];
const FAST_SIGNALS = [
  "classify", "categor", "extract", "translate", "summar", "format", "rewrite",
  "yes or no", "list the", "normalize", "tag", "label",
];

export function classifyTier(messages: Msg[], taskKind: TaskKind): Tier {
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const text = user.toLowerCase();
  const tokens = messagesTokens(messages);
  const questions = (user.match(/\?/g) ?? []).length;

  const deepHits = DEEP_SIGNALS.filter((s) => text.includes(s)).length;
  const fastHits = FAST_SIGNALS.filter((s) => text.includes(s)).length;

  let score = 0;
  score += deepHits * 2;
  score -= fastHits * 2;
  if (tokens > 6_000) score += 2;
  if (tokens > 20_000) score += 2;
  if (tokens < 200) score -= 1;
  if (questions >= 3) score += 1;
  if (messages.length > 14) score += 1;
  if (taskKind === "operational") score += 1;

  if (score >= 4) return "deep";
  if (score <= -1) return "fast";
  return "balanced";
}

/* ------------------------------------------------------------------ *
 * Circuit breaker (per worker isolate)
 * ------------------------------------------------------------------ */

interface Breaker { failures: number; openUntil: number }
const breakers = new Map<string, Breaker>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

function isOpen(model: string): boolean {
  const b = breakers.get(model);
  return !!b && b.openUntil > Date.now();
}
function recordFailure(model: string) {
  const b = breakers.get(model) ?? { failures: 0, openUntil: 0 };
  b.failures += 1;
  if (b.failures >= BREAKER_THRESHOLD) {
    b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    b.failures = 0;
  }
  breakers.set(model, b);
}
function recordSuccess(model: string) {
  breakers.set(model, { failures: 0, openUntil: 0 });
}

export function breakerSnapshot() {
  const now = Date.now();
  return [...breakers.entries()].map(([model, b]) => ({
    model,
    open: b.openUntil > now,
    reopens_in_ms: Math.max(0, b.openUntil - now),
    consecutive_failures: b.failures,
  }));
}

/* ------------------------------------------------------------------ *
 * Low-level NIM call
 * ------------------------------------------------------------------ */

interface NimChoiceMessage { content?: string | null; reasoning_content?: string | null }
interface NimResponse {
  choices?: Array<{ message?: NimChoiceMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function classifyError(status: number | undefined, message: string): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_unavailable";
  if (status === 429) return "rate_limited";
  if (status === 503) return "overloaded";
  if (status && status >= 500) return "upstream_error";
  if (status && status >= 400) return "bad_request";
  if (/abort|timeout/i.test(message)) return "timeout";
  return "network";
}

async function callModel(
  key: string,
  spec: ModelSpec,
  messages: Msg[],
  opts: { maxTokens: number; temperature: number; top_p: number; json: boolean },
): Promise<{ content: string; reasoning: string | null; usage: NonNullable<NimResponse["usage"]> | null }> {
  const body: Record<string, unknown> = {
    model: spec.id,
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    top_p: opts.top_p,
    stream: false,
  };
  if (spec.reasoning === "template_toggle") {
    body["chat_template_kwargs"] = { thinking: spec.thinking === true };
  }
  if (opts.json && spec.supportsJsonObject) {
    body["response_format"] = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Body may contain the provider's message; it never contains the key.
      const detail = await res.text().catch(() => "");
      const err = new Error(detail.slice(0, 300) || `HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const json = (await res.json()) as NimResponse;
    const msg = json.choices?.[0]?.message ?? {};
    return {
      content: (msg.content ?? "").trim(),
      reasoning: msg.reasoning_content ? String(msg.reasoning_content) : null,
      usage: json.usage ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Context management: trim, then summarize
 * ------------------------------------------------------------------ */

async function fitContext(
  key: string,
  spec: ModelSpec,
  messages: Msg[],
  reserveOutput: number,
): Promise<{ messages: Msg[]; trimmed: boolean; summarized: boolean }> {
  const budget = Math.max(2_000, spec.inputBudget - reserveOutput - 512);
  if (messagesTokens(messages) <= budget) return { messages, trimmed: false, summarized: false };

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  // Keep the newest turns; they carry the live intent.
  const keep: Msg[] = [];
  let used = messagesTokens(system);
  let cut = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]!;
    const cost = estimateTokens(m.content) + 4;
    if (used + cost > budget * 0.75 && keep.length >= 2) { cut = i + 1; break; }
    used += cost;
    keep.unshift(m);
  }
  const dropped = rest.slice(0, cut);
  if (dropped.length === 0) {
    return { messages: [...system, ...keep], trimmed: true, summarized: false };
  }

  // Summarize what we dropped so nothing important is silently lost.
  let summarized = false;
  let summary = "";
  try {
    const source = dropped
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
      .slice(-40_000);
    const fastSpec = TIER_CHAINS.fast[0]!;
    const out = await callModel(key, fastSpec, [
      { role: "system", content: "Compress the transcript into under 250 words of durable facts, decisions, and open questions. No preamble." },
      { role: "user", content: source },
    ], { maxTokens: 700, temperature: 0.1, top_p: 0.9, json: false });
    summary = out.content;
    summarized = summary.length > 0;
  } catch {
    summary = "";
  }

  const prefix: Msg[] = summary
    ? [{ role: "system", content: `Earlier conversation summary:\n${summary}` }]
    : [{ role: "system", content: "Earlier conversation was trimmed for length." }];

  return { messages: [...system, ...prefix, ...keep], trimmed: true, summarized };
}

/* ------------------------------------------------------------------ *
 * Public router
 * ------------------------------------------------------------------ */

const RETRYABLE = new Set(["rate_limited", "overloaded", "upstream_error", "timeout", "network"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function routeChat(opts: RouteOptions): Promise<RouteResult> {
  const key = process.env["NVIDIA_API_KEY"];
  if (!key) throw new Error("AI provider is not configured");

  const taskKind: TaskKind = opts.taskKind ?? "assistant";
  const requestedTier = opts.tier ?? null;
  const tier: Tier = opts.tier ?? classifyTier(opts.messages, taskKind);

  const chain = TIER_CHAINS[tier].filter((s) => !isOpen(s.id));
  const candidates = chain.length > 0 ? chain : TIER_CHAINS[tier];

  const attempts: AttemptRecord[] = [];
  const started = Date.now();
  let lastError: (Error & { status?: number }) | null = null;

  for (let ci = 0; ci < candidates.length; ci++) {
    const spec = candidates[ci]!;
    const maxTokens = outputBudget(spec, tier, opts.longForm === true);
    const { temperature, top_p } = samplingFor(taskKind, tier);

    let prepared: Msg[] = opts.messages;
    let trimmed = false;
    let summarized = false;
    try {
      const fitted = await fitContext(key, spec, opts.messages, maxTokens);
      prepared = fitted.messages;
      trimmed = fitted.trimmed;
      summarized = fitted.summarized;
    } catch { /* keep original messages; the call may still fit */ }

    // Up to 2 attempts per model with exponential backoff for transient errors.
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const out = await callModel(key, spec, prepared, { maxTokens, temperature, top_p, json: opts.json === true });
        const ms = Date.now() - t0;
        if (!out.content) throw Object.assign(new Error("empty completion"), { status: 502 });
        if (opts.json) JSON.parse(out.content); // malformed JSON = failure, not a silent pass
        attempts.push({ model: spec.id, ok: true, ms });
        recordSuccess(spec.id);
        return {
          content: out.content,
          // Raw CoT is discarded here: it never leaves the server in any form.
          reasoningUsed: out.reasoning !== null && out.reasoning.length > 0,
          tierUsed: tier,
          requestedTier,
          modelUsed: spec.id,
          fallbackUsed: ci > 0,
          attempts,
          latencyMs: Date.now() - started,
          usage: out.usage ?? null,
          contextTrimmed: trimmed,
          summarized,
        };
      } catch (e) {
        const err = e as Error & { status?: number };
        const type = classifyError(err.status, err.message);
        attempts.push({ model: spec.id, ok: false, ms: Date.now() - t0, status: err.status, errorType: type });
        lastError = err;
        recordFailure(spec.id);
        if (type === "auth") throw new Error("AI provider authentication failed");
        if (!RETRYABLE.has(type) || attempt === 1) break;
        await sleep(600 * Math.pow(3, attempt) + Math.floor(Math.random() * 400));
      }
    }
  }

  const e = new Error(
    `AI request failed on every verified model for tier ${tier}: ${lastError?.message ?? "unknown error"}`,
  ) as Error & { attempts?: AttemptRecord[]; tier?: Tier };
  e.attempts = attempts;
  e.tier = tier;
  throw e;
}
