/**
 * HarborLine adaptive AI router (NVIDIA NIM).
 *
 * Server-only. NVIDIA_API_KEY is read inside call sites, never logged, never
 * returned, never sent to the browser. Internal chain-of-thought produced by
 * reasoning models is discarded here and never leaves the server.
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
  /**
   * Authoritative structured state (ride state, driver, pricing inputs,
   * constraints, incidents). Pinned verbatim into the prompt and NEVER
   * trimmed or summarized.
   */
  protectedContext?: string;
  /** Label used only for diagnostics (no user content). */
  purpose?: string;
  /**
   * Server-only override of the model chain for this call. Used by the admin
   * fallback probe; never derived from client input.
   */
  chainOverride?: ModelSpec[];
}

export interface AttemptRecord {
  model: string;
  ok: boolean;
  ms: number;
  status?: number;
  errorType?: string;
  action?: "retry" | "failover" | "abort" | "success";
}

export interface RouteResult {
  content: string;
  /** True when the model reasoned internally. The chain-of-thought never leaves the server. */
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
  /** True when authoritative structured state was pinned into the prompt. */
  protectedContextPinned: boolean;
}

/* ------------------------------------------------------------------ *
 * Token accounting (character heuristic — no tokenizer in the Worker)
 * ------------------------------------------------------------------ */

const CHARS_PER_TOKEN = 3.6;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);
const messagesTokens = (m: Msg[]) => m.reduce((n, x) => n + estimateTokens(x.content) + 4, 0);

const PROTECTED_HEADER =
  "AUTHORITATIVE STRUCTURED STATE (verbatim, never summarized — treat as the single source of truth; " +
  "if it conflicts with anything in the conversation, the state below wins):";

/* ------------------------------------------------------------------ *
 * Complexity classification and escalation triggers
 * ------------------------------------------------------------------ */

const DEEP_SIGNALS = [
  "plan", "strategy", "trade-off", "tradeoff", "root cause", "why did", "optimi",
  "reconcile", "ambiguous", "multi-step", "step by step", "design",
  "refactor", "debug", "prove", "audit", "forecast",
];
const FAST_SIGNALS = [
  "classify", "categor", "extract", "translate", "summar", "format", "rewrite",
  "yes or no", "list the", "normalize", "tag", "label",
];
/** Signals that a request carries conflicting constraints or high operational impact. */
const CONFLICT_SIGNALS = [
  "conflict", "contradict", "double booked", "double-booked", "overlap", "clash",
  "but also", "at the same time", "cannot both", "either", "competing", "mismatch",
];
const HIGH_IMPACT_SIGNALS = [
  "cancel", "refund", "chargeback", "no-show", "no show", "incident", "safety",
  "suspend", "deactivate", "reassign", "escalat", "compliance", "legal", "insurance",
  "vip", "airport delay", "missed flight", "surge", "payout",
];

export interface Complexity {
  tier: Tier;
  score: number;
  conflicting: boolean;
  highImpact: boolean;
  large: boolean;
  triggers: string[];
}

/**
 * Operational work is capped at BALANCED unless a real escalation trigger
 * fires — that keeps everyday RIE decisions off the 40–90s Ultra path.
 */
export function assessComplexity(messages: Msg[], taskKind: TaskKind): Complexity {
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const text = user.toLowerCase();
  const tokens = messagesTokens(messages);
  const questions = (user.match(/\?/g) ?? []).length;

  const deepHits = DEEP_SIGNALS.filter((s) => text.includes(s)).length;
  const fastHits = FAST_SIGNALS.filter((s) => text.includes(s)).length;
  const conflictHits = CONFLICT_SIGNALS.filter((s) => text.includes(s)).length;
  const impactHits = HIGH_IMPACT_SIGNALS.filter((s) => text.includes(s)).length;

  let score = 0;
  score += deepHits * 2;
  score -= fastHits * 2;
  score += conflictHits * 2;
  score += impactHits;
  if (tokens > 6_000) score += 2;
  if (tokens > 20_000) score += 2;
  if (tokens < 200) score -= 1;
  if (questions >= 3) score += 1;
  if (messages.length > 14) score += 1;

  const triggers: string[] = [];
  if (conflictHits > 0) triggers.push("conflicting_constraints");
  if (impactHits > 0) triggers.push("high_operational_impact");
  if (tokens > 20_000) triggers.push("very_large_context");
  if (deepHits >= 3) triggers.push("multi_step_reasoning");

  let tier: Tier = score >= 4 ? "deep" : score <= -1 ? "fast" : "balanced";

  if (taskKind === "operational") {
    // Quality-first but latency-aware: Super 120B handles it unless a trigger fires.
    const forceDeep = conflictHits > 0 || (impactHits > 0 && score >= 4) || tokens > 20_000;
    if (tier === "fast") tier = "balanced";
    tier = forceDeep ? "deep" : "balanced";
  }

  return {
    tier,
    score,
    conflicting: conflictHits > 0,
    highImpact: impactHits > 0,
    large: tokens > 20_000,
    triggers,
  };
}

/** Back-compat helper. */
export const classifyTier = (messages: Msg[], taskKind: TaskKind): Tier =>
  assessComplexity(messages, taskKind).tier;

/* ------------------------------------------------------------------ *
 * Circuit breaker (per worker isolate)
 * ------------------------------------------------------------------ */

interface Breaker { failures: number; openUntil: number; lastError?: string }
const breakers = new Map<string, Breaker>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const UNAVAILABLE_COOLDOWN_MS = 15 * 60_000;

function isOpen(model: string): boolean {
  const b = breakers.get(model);
  return !!b && b.openUntil > Date.now();
}
function recordFailure(model: string, errorType: string) {
  const b = breakers.get(model) ?? { failures: 0, openUntil: 0 };
  b.failures += 1;
  b.lastError = errorType;
  // A retired / unknown model is not a blip: park it for much longer.
  if (errorType === "model_unavailable") {
    b.openUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
    b.failures = 0;
  } else if (b.failures >= BREAKER_THRESHOLD) {
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
    last_error: b.lastError ?? null,
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
  if (status === 400 && /retire|decommission|no longer/i.test(message)) return "model_unavailable";
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
      const err = new Error(detail.slice(0, 300) || `HTTP ${res.status}`) as Error & {
        status?: number;
        retryAfterMs?: number;
      };
      err.status = res.status;
      const ra = res.headers.get("retry-after");
      if (ra) {
        const secs = Number(ra);
        if (Number.isFinite(secs)) err.retryAfterMs = Math.max(0, secs * 1000);
      }
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
 * Context management: protect structured state, trim, then summarize
 * ------------------------------------------------------------------ */

async function fitContext(
  key: string,
  spec: ModelSpec,
  messages: Msg[],
  reserveOutput: number,
  protectedContext: string | undefined,
): Promise<{ messages: Msg[]; trimmed: boolean; summarized: boolean }> {
  const pinned: Msg[] = protectedContext
    ? [{ role: "system", content: `${PROTECTED_HEADER}\n${protectedContext}` }]
    : [];
  const pinnedTokens = messagesTokens(pinned);
  const budget = Math.max(2_000, spec.inputBudget - reserveOutput - pinnedTokens - 512);

  if (messagesTokens(messages) <= budget) {
    return { messages: [...pinned, ...messages], trimmed: false, summarized: false };
  }

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
    return { messages: [...pinned, ...system, ...keep], trimmed: true, summarized: false };
  }

  // Only conversational prose is compressed; authoritative state above is untouched.
  let summarized = false;
  let summary = "";
  try {
    const source = dropped
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
      .slice(-40_000);
    const fastSpec = TIER_CHAINS.fast[0]!;
    const out = await callModel(key, fastSpec, [
      {
        role: "system",
        content:
          "Compress the transcript into under 250 words of durable facts, decisions, and open questions. " +
          "Preserve every address, date, time, price, vehicle, passenger count, driver name, and stated constraint verbatim. No preamble.",
      },
      { role: "user", content: source },
    ], { maxTokens: 700, temperature: 0.1, top_p: 0.9, json: false });
    summary = out.content;
    summarized = summary.length > 0;
  } catch {
    summary = "";
  }

  const prefix: Msg[] = summary
    ? [{ role: "system", content: `Earlier conversation summary (prose only):\n${summary}` }]
    : [{ role: "system", content: "Earlier conversation was trimmed for length." }];

  return { messages: [...pinned, ...system, ...prefix, ...keep], trimmed: true, summarized };
}

/* ------------------------------------------------------------------ *
 * Public router
 * ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

/** How the router reacts to each error class. */
function policyFor(errorType: string): "abort" | "failover" | "retry_once" {
  switch (errorType) {
    case "auth":
      return "abort";
    case "model_unavailable": // retired / unknown to this key — never retry
    case "overloaded": // capacity: hammering the same model does not help
    case "bad_request":
      return "failover";
    default: // timeout, network, upstream_error, rate_limited, invalid output
      return "retry_once";
  }
}

export async function routeChat(opts: RouteOptions): Promise<RouteResult> {
  const key = process.env["NVIDIA_API_KEY"];
  if (!key) throw new Error("AI provider is not configured");

  const taskKind: TaskKind = opts.taskKind ?? "assistant";
  const requestedTier = opts.tier ?? null;
  const tier: Tier = opts.tier ?? assessComplexity(opts.messages, taskKind).tier;
  const structured = opts.json === true || taskKind === "operational";

  // Models proven unreliable for structured/operational work are excluded outright.
  const eligible = (opts.chainOverride ?? TIER_CHAINS[tier]).filter((s) => !(structured && s.plainTextOnly));
  const open = eligible.filter((s) => !isOpen(s.id));
  // Each model appears at most once: no fallback loops.
  const candidates = (open.length > 0 ? open : eligible).filter(
    (s, i, a) => a.findIndex((x) => x.id === s.id && x.thinking === s.thinking) === i,
  );

  if (candidates.length === 0) throw new Error(`No eligible model for tier ${tier}`);

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
      const fitted = await fitContext(key, spec, opts.messages, maxTokens, opts.protectedContext);
      prepared = fitted.messages;
      trimmed = fitted.trimmed;
      summarized = fitted.summarized;
    } catch { /* keep original messages; the call may still fit */ }

    // At most 2 attempts per model, and only for transient error classes.
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const out = await callModel(key, spec, prepared, { maxTokens, temperature, top_p, json: opts.json === true });
        const ms = Date.now() - t0;
        if (!out.content) throw Object.assign(new Error("empty completion"), { status: 502 });
        if (opts.json) JSON.parse(out.content); // malformed JSON = failure, not a silent pass
        attempts.push({ model: spec.id, ok: true, ms, action: "success" });
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
          protectedContextPinned: !!opts.protectedContext,
        };
      } catch (e) {
        const err = e as Error & { status?: number; retryAfterMs?: number };
        const type = classifyError(err.status, err.message);
        const policy = policyFor(type);
        const willRetry = policy === "retry_once" && attempt === 0;
        attempts.push({
          model: spec.id,
          ok: false,
          ms: Date.now() - t0,
          status: err.status,
          errorType: type,
          action: policy === "abort" ? "abort" : willRetry ? "retry" : "failover",
        });
        lastError = err;
        recordFailure(spec.id, type);

        if (policy === "abort") throw new Error("AI provider authentication failed");
        if (!willRetry) break; // straight to the next model in the chain

        if (type === "rate_limited") {
          // Honour NVIDIA's Retry-After when it is short; otherwise fail over now.
          const wait = err.retryAfterMs ?? 2_000;
          if (wait > MAX_RATE_LIMIT_WAIT_MS) break;
          await sleep(wait);
        } else {
          await sleep(800 + Math.floor(Math.random() * 500));
        }
      }
    }
  }

  const e = new Error(
    `AI request failed on every eligible model for tier ${tier}: ${lastError?.message ?? "unknown error"}`,
  ) as Error & { attempts?: AttemptRecord[]; tier?: Tier };
  e.attempts = attempts;
  e.tier = tier;
  throw e;
}
