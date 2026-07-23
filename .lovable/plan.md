
# HarborLine Batch 2 — Revision 2 (Planning Only)

No files changed. No migrations. No policy activation. No Stripe change. No deploy. No approval requested this turn.

## A. Revision Summary
Codex REJECT & REVISE accepted. Corrections applied: opaque hashed review tokens (HMAC removed — Postgres cannot read Lovable app secrets); explicit RPC GRANT/REVOKE matrix; three-value service_context (`standard|airport|unresolved`); dedicated `contract_version` replacing "freeze on non-null"; hard snapshot immutability with append-only corrections; policy bundle integrity via composite FKs (no cross-table CHECK); explicit review-record status enum with non-`now()` partial index; single-direction snapshot→review FK; Stripe cutover keyed off session `created` + `cutover_at` using `sessions.expire`; webhook lease state machine with owner/expiry/retry; gate tri-state `shadow|enforce|paused` (fail-closed to paused); legacy reason codes + admin resolution workflow. Scope kept to four additive releases.

## B. Corrected Architecture
```
2A additive booking contract → 2B policy bundles (inactive) → 2C shadow review/evidence → 2D payment attempts + webhook lease + gate (shadow→enforce)
```
Existing booking + immediate Stripe Checkout keeps working through 2A/2B/2C. 2D only flips to `enforce` after legal approval, seeded/approved bundles, and a tested cutover.

## C. Corrected Schemas

**2A — bookings (additive, nullable, no freeze)**
```
ALTER TABLE bookings ADD COLUMN service_context text CHECK (service_context IN ('standard','airport','unresolved'));
ALTER TABLE bookings ADD COLUMN pickup_context text CHECK (...);      -- authoritative for waiting/no-show
ALTER TABLE bookings ADD COLUMN dropoff_context text CHECK (...);     -- reporting only
ALTER TABLE bookings ADD COLUMN price_cents integer CHECK (price_cents >= 100);
ALTER TABLE bookings ADD COLUMN currency text CHECK (currency ~ '^[a-z]{3}$');
ALTER TABLE bookings ADD COLUMN contract_version integer NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN classifier_version text;
ALTER TABLE bookings ADD COLUMN classifier_evidence jsonb;
CREATE TABLE airport_registry (id uuid PK, kind text CHECK (kind IN ('airport','fbo','private_airfield')), iata text, geo jsonb, active boolean, ...);
```
No immutability trigger on bookings — invalidation is via `contract_version`.

**2B — policy bundles (composite FK integrity)**
```
ALTER TABLE cancellation_policies ADD COLUMN service_type text NOT NULL;
ALTER TABLE cancellation_policies ADD CONSTRAINT uq_cancel_id_svc UNIQUE (id, service_type);
ALTER TABLE cancellation_policies ADD COLUMN content_hash text, approved_by uuid, approved_at timestamptz, approval_reason text, effective_from timestamptz, effective_to timestamptz;
-- same for no_show_policies

CREATE TABLE policy_bundles (
  id uuid PK, service_context text NOT NULL CHECK (service_context IN ('standard','airport')),
  cancellation_policy_id uuid NOT NULL, no_show_policy_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','active','retired')),
  activated_at timestamptz, activated_by uuid, activation_reason text,
  bundle_digest text NOT NULL,
  FOREIGN KEY (cancellation_policy_id, service_context) REFERENCES cancellation_policies(id, service_type),
  FOREIGN KEY (no_show_policy_id, service_context) REFERENCES no_show_policies(id, service_type)
);
CREATE UNIQUE INDEX ON policy_bundles(service_context) WHERE status='active';
```

**2C — review records + append-only evidence**
```
CREATE TABLE booking_review_records (
  id uuid PK, booking_id uuid NOT NULL, passenger_id uuid NOT NULL,
  service_context text NOT NULL, bundle_id uuid NOT NULL REFERENCES policy_bundles(id),
  bundle_digest text NOT NULL, price_cents int NOT NULL, currency text NOT NULL,
  contract_version int NOT NULL,
  status text NOT NULL CHECK (status IN ('issued','consumed','expired','revoked')),
  token_hash text NOT NULL,                       -- sha256 of raw opaque token
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz, revoked_at timestamptz, revoke_reason text,
  enforcement_mode text NOT NULL CHECK (enforcement_mode IN ('shadow','enforce')),
  ui_version text, wording_version text, schema_version text
);
CREATE UNIQUE INDEX ON booking_review_records(booking_id, passenger_id) WHERE status='issued';

CREATE TABLE booking_policy_snapshots (
  id uuid PK,
  review_record_id uuid NOT NULL UNIQUE REFERENCES booking_review_records(id),
  booking_id uuid NOT NULL, passenger_id uuid NOT NULL,
  contract_version int NOT NULL,
  service_context text NOT NULL,
  cancellation_policy_id uuid NOT NULL, cancellation_hash text NOT NULL, cancellation_version int NOT NULL,
  no_show_policy_id uuid NOT NULL,      no_show_hash text NOT NULL,      no_show_version int NOT NULL,
  bundle_id uuid NOT NULL, bundle_digest text NOT NULL,
  price_cents int NOT NULL, currency text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(), accepted_ip inet, accepted_user_agent text,
  enforcement_mode text NOT NULL, ui_version text, wording_version text, schema_version text,
  snapshot_digest text NOT NULL
);
-- Trigger: reject UPDATE and DELETE for every role including service_role app path.

CREATE TABLE booking_snapshot_corrections (
  id uuid PK, snapshot_id uuid NOT NULL REFERENCES booking_policy_snapshots(id),
  supersedes_id uuid REFERENCES booking_snapshot_corrections(id),
  reason text NOT NULL, actor uuid NOT NULL, created_at timestamptz DEFAULT now(),
  correction_payload jsonb NOT NULL, correction_digest text NOT NULL
);
```

**2D — payments**
```
CREATE TABLE payment_attempts (
  id uuid PK, booking_id uuid NOT NULL, snapshot_id uuid NOT NULL REFERENCES booking_policy_snapshots(id),
  environment text NOT NULL, amount_cents int NOT NULL, currency text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  stripe_session_id text UNIQUE, stripe_created_at timestamptz,
  state text NOT NULL CHECK (state IN ('pending','session_created','processing','processed','failed','expired')),
  last_error text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

ALTER TABLE stripe_events
  ADD COLUMN processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received','processing','processed','failed')),
  ADD COLUMN lease_owner text, ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count int NOT NULL DEFAULT 0, ADD COLUMN next_retry_at timestamptz,
  ADD COLUMN last_error text, ADD COLUMN processed_at timestamptz;

CREATE TABLE payment_gate_state (
  id boolean PK DEFAULT true CHECK (id), mode text NOT NULL CHECK (mode IN ('shadow','enforce','paused')),
  cutover_at timestamptz, updated_by uuid, updated_at timestamptz DEFAULT now()
);
```

## D. RPC Signatures & Permissions
All `SECURITY DEFINER SET search_path = public`. Default: `REVOKE EXECUTE ON FUNCTION x FROM PUBLIC, anon;`

Passenger (called with signed-in Supabase client): `GRANT EXECUTE TO authenticated`
- `issue_booking_review_record(_booking_id uuid) → { review_id, raw_token, expires_at }` — locks booking, revokes prior issued records, inserts new. Raw token returned once; only `token_hash` stored.
- `accept_booking_policies(_review_id uuid, _submitted_token_hash text, _client_meta jsonb) → { snapshot_id }` — server function hashes the passenger's raw token before calling; RPC validates hash, `auth.uid()=passenger_id`, `status='issued'`, not expired, booking `contract_version` still matches, bundle still exists, digest matches. Atomically flips status→`consumed` and inserts snapshot. Idempotent replay: if `consumed_at` set and hashes match → return existing snapshot_id.
- `get_booking_snapshot(_booking_id uuid) → jsonb` — passenger self.
- `create_payment_attempt(_snapshot_id uuid) → { attempt_id, idempotency_key, amount_cents, currency }`.

Admin (`GRANT EXECUTE TO authenticated`; internal `has_role(auth.uid(),'admin')` check):
- `admin_approve_policy`, `admin_create_policy_bundle`, `admin_activate_policy_bundle`, `admin_deactivate_policy_bundle`, `admin_resolve_unresolved_booking`, `admin_set_payment_gate_mode`, `admin_expire_pregate_sessions`.

Service-role internal (no execute grant to authenticated): `_webhook_claim_lease`, `_webhook_finalize_event`, `_maintenance_snapshot_tombstone`.

Public resolver: `get_active_bundle(_service_context) → jsonb` — `GRANT EXECUTE TO authenticated`.

## E. Contract-Version & Invalidation Rules
Contract-relevant fields: `price_cents, currency, pickup_at, pickup_identity, dropoff_identity, service_context, vehicle_type, passenger_count, priced_amenities`. Any change → `contract_version++`, and any `issued` review record for that booking becomes `revoked` (trigger). Operational fields (driver assignment, status, notifications, audit) never bump. Post-payment: snapshot never rewritten; use `booking_snapshot_corrections` or refund/rebook records.

## F. Review-Token Design
Raw token = 256-bit CSPRNG, base64url. Returned to passenger exactly once by `issue_booking_review_record`. Storage stores only `sha256(raw)` in `token_hash`. On acceptance the TanStack server function computes `sha256(raw)` and passes the hash to the RPC. HMAC removed — Postgres has no access to Lovable app secrets, and hash comparison alone (combined with `auth.uid()` ownership, status, expiry, and digest checks inside the RPC) provides authenticated single-use semantics. Expiry 15 min. Single-use enforced by `UPDATE ... WHERE status='issued' RETURNING`.

## G. Snapshot Immutability & Correction
Trigger on `booking_policy_snapshots` rejects UPDATE/DELETE for every role including service_role application path. Corrections append rows to `booking_snapshot_corrections` (supersession chain). Retention/GDPR erasure only via separately owned `_maintenance_snapshot_tombstone(reason, actor)` that writes an audit record + cryptographic tombstone; never silent rewrite.

## H. Policy-Bundle Integrity
No cross-table CHECK. Integrity from composite FKs `(policy_id, service_type)`. Approval, effective window, completeness, and stable canonical `content_hash` (sorted-key JSON, UTF-8 NFC, ISO-8601 timestamps) validated in `admin_activate_policy_bundle`. `bundle_digest = sha256(cancel.content_hash || '|' || no_show.content_hash || '|' || service_context)`. Deterministic test vectors published in migration tests.

## I. Stripe Session & Cutover
`payment_attempts` records `stripe_session_id` and `stripe_created_at` immediately after Session creation. Idempotency key `hl_pa_<attempt_id>` passed via Stripe request options. Grandfathering keyed off `stripe_created_at` vs `payment_gate_state.cutover_at`: sessions with `stripe_created_at < cutover_at` are grandfathered; sessions ≥ `cutover_at` without a linked accepted snapshot are rejected. Only open sessions may be cancelled via `stripe.checkout.sessions.expire(id)`; completed / already-expired sessions are left alone and reported.

## J. Webhook Lease & Atomicity
Claim: `UPDATE stripe_events SET processing_state='processing', lease_owner=$w, lease_expires_at=now()+interval '2 min', attempt_count=attempt_count+1 WHERE id=$id AND (processing_state='received' OR processing_state='failed' AND next_retry_at<=now() OR (processing_state='processing' AND lease_expires_at<now())) RETURNING *`. Single winner. Finalize RPC in one tx: verify event → verify Stripe session vs `payment_attempts` → verify amount+currency vs snapshot → mark booking paid → `payment_attempts.state='processed'` → `stripe_events.processing_state='processed', processed_at=now()` → write payment + audit. Historical accepted snapshot is source of truth; webhook never re-resolves the active bundle. On failure: `state='failed'`, `last_error`, `next_retry_at` with backoff.

## K. Gate-State Behavior
`payment_gate_state.mode`:
- `shadow`: existing Stripe path unchanged; new review/attempt infra observed only. No enforcement.
- `enforce`: `createBookingCheckout` requires a live accepted snapshot + `payment_attempts` row for `contract_version`, else hard reject.
- `paused`: no new Stripe Sessions may be created at all.
Read server-side on every checkout (or ≤5s bounded cache). Unknown/invalid/unavailable → fail-closed to `paused`. Rolling back `enforce` sets `paused`, never silently back to unauthenticated payment.

## L. Legacy-Booking Resolution
Quarantine reason codes: `NO_PICKUP_COORDS`, `NO_DROPOFF_COORDS`, `NON_USD_CURRENCY`, `PRICE_MISSING`, `PRICE_INCONSISTENT`, `AMBIGUOUS_AIRPORT_MATCH`, `UNKNOWN_VEHICLE_TYPE`. Classifier writes `service_context='unresolved'` and `classifier_evidence` when it cannot decide — never defaults to `standard`. Admin resolves via `admin_resolve_unresolved_booking(_booking_id, _service_context, _price_cents, _currency, _reason)` which bumps `contract_version`, writes `_audit_write`, and records actor+reason. Authoritative price source is the existing `create_booking` RPC output; the plan does NOT assume any `suggested_price` field. Existing pre-2D Stripe sessions are grandfathered (see I).

## M. Files by Sub-Batch
- **2A**: 1 migration; `src/lib/policies.functions.ts` (add classifier helpers only if needed). No route/UI changes.
- **2B**: 1 migration; extend `src/lib/policies.functions.ts` and `src/components/admin/BookingPoliciesPanel.tsx` for bundle CRUD + approval + activation.
- **2C**: 1 migration; new `src/lib/reviews.functions.ts`; new `src/components/BookingReviewModal.tsx`; `src/routes/book.tsx` gains a shadow-only review step; snapshots recorded but Stripe path unchanged.
- **2D**: 1 migration; extend `src/lib/payments.functions.ts` (payment_attempts + gate read); update `src/routes/api/public/payments/webhook.ts` for lease + atomic finalize; `src/components/admin/BookingPoliciesPanel.tsx` gains gate-mode admin control.

## N. Tests & Acceptance Gates
DB: composite-FK rejects mismatched service_type; snapshot UPDATE/DELETE denied for every role; contract-version bump revokes issued reviews; concurrent bundle activation → exactly one winner; webhook lease → single claimer under contention; classifier defaults to `unresolved` for ambiguity. Stripe sandbox: idempotent attempt replay = one Session; amount tampering → `failed`; redelivery on `processed` = no-op; `sessions.expire` only touches open sessions. UI: shadow review renders server-provided bundle only, checkbox default unchecked, Pay disabled until consent + non-expired non-revoked review. Gate: unknown gate row → treated as `paused`.

## O. Deployment Sequence
1. 2A migration + classifier + `airport_registry` seed. Backfill pass writes `unresolved` where ambiguous. Admin triages via `admin_resolve_unresolved_booking`.
2. 2B migration. Author 4 policies (draft). Legal approves wording (blocking). Admin approves + creates both bundles. Do NOT activate until legal sign-off documented.
3. Activate both bundles atomically.
4. 2C migration + shadow review UI. `enforcement_mode='shadow'` on all records. Existing Stripe path unchanged.
5. 2D migration with `payment_gate_state.mode='shadow'`. Run shadow ≥72h. Verify zero unexplained `failed`. Expire stray open pre-cutover sessions via runbook. Set `cutover_at`, flip to `enforce`. Monitor 72h.

## P. Rollback
- 2D: `mode='paused'` (never silently back to open). Tables retained.
- 2C: stop calling `accept_booking_policies` from UI; snapshots retained.
- 2B: deactivate bundles; policies retained.
- 2A: leave columns; revert classifier if needed. Never drop populated columns.

## Q. Business/Legal Decisions Required
1. Final wording of 4 policies (standard/airport × cancel/no-show). 2. Fee structure per policy. 3. Authoritative airport/FBO/private-airfield registry list + classification rule. 4. Legacy pre-gate booking policy (retro-accept / grandfathered / exempt). 5. Currency scope (USD-only at go-live?). 6. Approval authority (two-person rule?). 7. Pre-gate open-session treatment (expire vs re-quote vs refund).

## R. Safe Before Legal Approval
- 2A migration + classifier + registry seed + admin resolution UI.
- 2B migration + bundle CRUD + approval workflow (bundles stay `draft`/`approved`, never `active`).
- 2C migration + shadow review UI recording shadow-mode records only.
- 2D migration + webhook lease + gate row with `mode='shadow'`.
Blocked until legal approval: bundle `active` state, `mode='enforce'`, and any pre-gate session expiry.

## S. Remaining Ambiguities
- Exact `vehicle_type` and `priced_amenities` fields that count as contract-relevant.
- Whether dropoff-airport bookings need distinct fee treatment vs pickup-airport.
- Retention window for `booking_review_records` beyond consumed snapshots.
- Whether admin-triggered `contract_version` bump should notify passenger with a re-review link automatically.

---

PLAN STATUS: REVISION 2 — AWAITING INDEPENDENT REVIEW
IMPLEMENTATION STATUS: BLOCKED
No files changed.
