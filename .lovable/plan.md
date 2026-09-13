# HarborLine Executive — Independent Audit (13 Sep 2026)

Evidence-based, read-only. Nothing was edited, no SQL was run that changes data, nothing was published. Earlier chat claims were re-verified; where they were wrong, that is stated.

## Your five questions, answered from evidence

**1) Is the NVIDIA router actually used? No — it is a parallel subsystem.**
`src/routes/api/blake.ts:104,175,182` calls the Lovable AI Gateway (`ai.gateway.lovable.dev`, `openai/gpt-5.5`, `LOVABLE_API_KEY`) and imports nothing from `src/lib/ai/*`. The only callers of the NVIDIA router (`aiChat`, `aiAnalyze`, `aiRouterReport`, `aiModelHealth`, `aiFallbackProbe`) are in `src/components/admin/AiRouterPanel.tsx`, rendered only at `src/routes/admin.health.tsx:147`. `nvidiaChat` (`src/lib/nvidia.functions.ts:23`) has zero callers. So: no passenger- or driver-facing flow uses the router; the concierge that guests actually talk to is the older Gateway path. Also note there is no `aiSelfTest` server function — the panel drives scenarios from `src/lib/ai/selftest.ts` client-side (an earlier claim of a server-side self-test was inaccurate).

**2) Client-controlled AI input — real, exploitable by any signed-in user (HIGH).**
`src/lib/ai.functions.ts:22-86`: the schemas accept `role:"system"`, `tier:"deep"`, `taskKind`, `longForm`, `protectedContext`, `facts`/`requiredFacts`, and `rules` with no clamping. `aiChat`/`aiAnalyze` carry only `requireSupabaseAuth` (`:120,176`) — no admin gate — so a passenger or driver can call the endpoint directly, bypassing the admin-only UI: force DEEP 550B runs (cost), inject a fake system message, and fabricate `rules` with `passed:true`, which `evaluateGuardrails` (`src/lib/ai/guardrails.server.ts:68`) trusts as-is. Mitigations that do exist: 60 requests/10 min per user (`ai.functions.ts:91`, fails open on RPC error), and `aiModelHealth`/`aiFallbackProbe` do check admin. `aiRouterReport` is safe — the DB function `admin_ai_router_report` enforces `has_role` (verified in the database). Chain-of-thought is genuinely never returned (`router.server.ts:437`).

**3) Production does NOT contain the AI work — confirmed, no contradiction remains.**
The published bundle at `luxe-drive-usher.lovable.app/assets/index-DmHUkmIL.js` contains the old concierge (`siri-orb`, `X-Concierge-Agent`) and none of `reliability`, `escalation`, `AI Router`, `aiRouterReport`, `Analyzing request`. Production is the pre-router version. Caveat that still holds: preview and production share one database, so `ai_router_events` and the AI-related RPCs are live for both.

**4) Migration state — two parallel systems, and the "frozen" Batch 2A work is inert.**
30 SQL files in `supabase/migrations/` match 30 applied rows in `supabase_migrations.schema_migrations` (through `20260723184317`) — consistent. Separately, `drizzle/migrations/0000_create_ai_router_events.sql` is tracked only in Drizzle's journal, so schema history now lives in two places. The frozen work is Batch 2A M-1: `bookings.contract_state`, `content_digest`, `classifier_digest`, `*_addr_digest`, `amenity_set_digest`, `base_price_cents`, `amenity_total_cents`, `total_price_cents`, `service_context` all exist but are **100% NULL** (1 booking row in the database), no code writes them, and the four `booking_contract_quarantine*` tables have RLS on with zero policies and no writers. M-2 onward (backfill, digest triggers, checkout gating) was never applied.

**5) Live payment readiness — blocked purely on credentials.**
Configured secrets: `STRIPE_SANDBOX_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `NVIDIA_API_KEY`, `LOVABLE_API_KEY`, Google Maps (connector). There is **no `STRIPE_LIVE_API_KEY` and no live webhook secret**, and `.env` carries only a sandbox-shaped `VITE_PAYMENTS_CLIENT_TOKEN`. `src/lib/stripe.server.ts:15-16` reads the live key only in live mode, so a live checkout throws "…is not configured". Also absent: `RESEND_API_KEY` and `TWILIO_*`, so booking emails and SMS silently record as no-ops (`email.server.ts:149`, `sms.server.ts:122`). No secret values were read or printed.

## Confirmed defects

| # | Sev | Where | Why it matters / reachable? | Smallest safe fix |
|---|---|---|---|---|
| 1 | HIGH | `src/lib/nvidia.functions.ts:23` | `createServerFn` with **no auth middleware, no rate limit** — a public RPC anyone on the internet can call to burn your NVIDIA budget. Reachable now in preview and (as dead code) harmless only because no UI calls it. | Delete the file (it has no callers). |
| 2 | HIGH | `src/lib/ai.functions.ts:22-86,119-336` | Client controls `role:"system"`, tier, `rules`, `protectedContext` — cost abuse and fake "authoritative" facts/guardrails from any signed-in user. | Drop `system` from the role enum; ignore client `tier`/`rules`/`protectedContext` unless caller is admin; add `requireAdmin` to `aiChat`/`aiAnalyze` while they are admin-only tools. |
| 3 | MED | `src/routes/api/blake.ts:187` | Guest messages are forwarded with their client-supplied `role`, so a crafted request can send a `system` turn to the model and override the concierge persona/scope. Reachable by any signed-in guest. | Force `role` to `user`/`assistant` when mapping. |
| 4 | MED | `src/lib/trust.functions.ts:143` | `submitNoShow` writes `dispatch_status='cancelled'` with a direct table update, bypassing `advance_assignment`'s transition, ownership and audit logic (no `driver_trip_events` row). | Route it through the RPC, or add an admin/driver-owned check plus an event insert. |
| 5 | MED | `src/lib/trust.functions.ts:113-121` | Driver-supplied `arrivalAt`/`attempts` are only sanity-checked; a driver can claim contact attempts they never made, which feeds no-show fees. | Server-derive `arrivalAt`; count attempts from `communication_events`. |
| 6 | MED | database grants | `anon` holds full table privileges on `ai_router_events` and `booking_contract_quarantine_cases` (RLS currently blocks reads, so not exploitable today) — the earlier grant cleanup missed these. | `REVOKE ALL … FROM anon` on both. |
| 7 | MED | no rate limits | `claimReferral`, `supportOpenConversation`/`supportSendMessage`, `reportIncident`, `recordLegalAcceptance`, `createBookingServer` have none; referral codes are enumerable and support threads floodable. | Add `check_and_bump_rate_limit` buckets. |
| 8 | MED | driver documents | Nothing server-side blocks a driver with an expired licence/insurance from accepting or starting a trip; `DocumentRow.tsx` only displays expiry. | Add an expiry check inside `advance_assignment`. |
| 9 | LOW | `src/lib/stripe.server.ts:42-48` → `BookingCheckoutModal.tsx:19,57` | Missing-config errors surface raw env-var names to guests, and `getStripe()` throws during render with no error boundary. | Map to a friendly "payments unavailable" state. |
| 10 | LOW | `monitoring_capture` (anon-executable), rate-limit fail-open (`blake.ts:155`, `ai.functions.ts:103`) | Anonymous log flooding; limits silently disabled when the RPC errors. | Revoke `anon` execute; fail closed with a short retry. |
| 11 | LOW | `src/routes/driver.*.tsx`, `r.$code.tsx` | No `head()` — no titles and no `noindex` on driver pages. | Add `head()` with `robots: noindex`. |
| 12 | LOW | `IncidentModal.tsx:50`, `NoShowModal.tsx:82` | Labels not linked to inputs (`htmlFor`/`id`) — screen readers can't announce them. | Wire up ids. |

**Verified sound** (no action): RLS on `bookings`/`profiles`/`user_roles`/`chat_messages`/`booking_pins` is correctly owner- and role-scoped; every `admin_*` database function checks `has_role`, so the 20 anon-executable ones fail closed; the six policy-less tables are intentional default-deny; the dispatch state machine is server-authoritative (`advance_assignment`); pricing is server-derived and the client cannot inject a price; webhook signatures are verified and `stripe_events` gives insert-before-process idempotency; the webhook touches payment only, never trip status; refunds are admin-only; the admin MFA gate cannot be deep-linked past; analytics fire only after consent; enforced HSTS/frame/referrer headers are in place.

**Recommendations, not defects**: CSP is Report-Only with `unsafe-inline`/`unsafe-eval` (`src/server.ts:69`) — tighten before enforcing; `/api/public/health` is liveness-only; webhook signature comparison isn't constant-time; route guards are client-side only (safe because layouts withhold `<Outlet/>`, and RLS is the real boundary).

**Dead code / doc mismatches**: `src/lib/nvidia.functions.ts` and `src/components/driver/useDispatchState.ts` (a second, weaker client-side state machine, zero importers); duplicate `create_booking` overloads in the database; `docs/ai-router.md` presents `nvidiaChat` as a live entry point; `docs/release-checklist.md` claims rate-limit review that items 7 contradicts.

## Prioritized fix plan

1. Remove `nvidiaChat`; lock down `aiChat`/`aiAnalyze` input and access (#1, #2).
2. Force message roles in the concierge endpoint (#3).
3. No-show integrity: route through the RPC, server-derive evidence (#4, #5).
4. Revoke stray `anon` grants and `monitoring_capture` execute (#6, #10).
5. Rate-limit buckets for referral/support/incident/legal/booking (#7).
6. Expired-document gate in dispatch (#8).
7. Checkout error UX, driver `head()`/`noindex`, label wiring (#9, #11, #12).
8. Decide the fate of Batch 2A: finish M-2 onward or drop the inert columns/tables from the roadmap; unify Drizzle vs Supabase migration history.

**(b) Safe in preview now**: items 1–5, 7 (all code plus grant/execute revokes, no data touched).
**(c) Needs credentials or your decision**: live Stripe key + live webhook secret, Resend and Twilio keys, whether Batch 2A continues, enforcing CSP, and any legal sign-off on no-show fee evidence rules.
**(d) Production data risk**: none of the above rewrites data. Grant/execute revokes are metadata-only and reversible. The one shared risk to respect is that preview and production use the same database, so any RPC or policy change is live for the published site immediately.
