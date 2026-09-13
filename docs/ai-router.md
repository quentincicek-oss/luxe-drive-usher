# HarborLine AI Router (NVIDIA NIM)

Server-only. `NVIDIA_API_KEY` is read inside handlers, never logged, never
returned, never bundled into browser code. Internal chain-of-thought produced by
reasoning models is discarded server-side; only a boolean `reasoning_used`
reaches the client.

## Files

| File | Role |
| --- | --- |
| `src/lib/ai/registry.server.ts` | Benchmarked model specs, tier chains, sampling + output budgets |
| `src/lib/ai/router.server.ts` | Classification, context fitting, retries, fallback, circuit breaker |
| `src/lib/ai/telemetry.server.ts` | Metadata-only logging to `public.ai_router_events` |
| `src/lib/ai.functions.ts` | `aiChat`, `aiAnalyze`, `aiRouterReport` server functions |
| `src/lib/nvidia.functions.ts` | Legacy `nvidiaChat`, now delegating to the router |
| `src/components/admin/AiRouterPanel.tsx` | Admin → System Health diagnostics card |

## Tiers (all models verified against the live key)

| Tier | Chain | Output budget |
| --- | --- | --- |
| fast | `openai/gpt-oss-20b` → `nvidia/nemotron-3-super-120b-a12b` (no thinking) → `nvidia/nemotron-3.5-lightning-30b-a3b` | 2048 |
| balanced | `nvidia/nemotron-3-super-120b-a12b` (thinking) → `openai/gpt-oss-20b` → `z-ai/glm-5.3-flash` | 6144 |
| deep | `nvidia/nemotron-3-ultra-550b-a55b` → `moonshotai/kimi-k3` → `deepseek-ai/deepseek-v4-pro-0813` → `nvidia/nemotron-3-super-120b-a12b` | 16384 |

Tier is auto-classified from intent keywords, prompt size, turn count, and task
kind; callers may override with `tier`.

Sampling: operational 0.1–0.15, assistant 0.3–0.4, creative 0.8.

## Reliability

- Per-model timeouts sized to observed latency (60s → 240s).
- 2 attempts per model, exponential backoff + jitter, only for transient errors
  (429 / 503 / 5xx / timeout / network).
- Non-retryable errors (404 model gone, 400) fall straight through to the next
  model in the chain. Auth errors abort immediately.
- Circuit breaker: 3 consecutive failures opens a model for 60s per isolate.
- Empty completions and malformed JSON count as failures — never returned.
- If every model in a tier fails, the call throws. No fabricated answer, no
  silent downgrade.

## Context handling

No artificial message/character caps. Token-aware fitting against each model's
input budget: newest turns kept verbatim, older turns compressed by a FAST-tier
summarizer and re-injected as a system summary. `context_trimmed` and
`summarized` are reported per call.

## Structured output (`aiAnalyze`)

Returns `result`, `confidence`, `assumptions`, `risk_flags`,
`recommended_action`, plus `model_used`, `tier_used`, `fallback_used`,
`escalated`, `latency_ms`. Validated with Zod server-side. Confidence below the
threshold (default 0.65) triggers one DEEP-tier escalation; if it stays low the
answer carries `low_confidence_human_review_required`. Deterministic
application facts are passed in `facts` and declared authoritative in the system
prompt so the model analyses rather than invents.

## Observability

`public.ai_router_events` stores metadata only (no prompts, completions, or
reasoning). Aggregates are exposed through the admin-only
`admin_ai_router_report(hours)` RPC and rendered in **Admin → System Health →
AI Router**: request/failure/fallback counts, p50/p95 latency, per-model and
per-tier breakdowns, error classes, and live circuit-breaker state.

Rate limit: 60 router requests / 10 minutes per user (`ai_router_request`).
