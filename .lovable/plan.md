
# Batch 2 — Revised Plan (Option 4)

Batch 2 as originally scoped is **halted**. Codex audit confirmed five
blocking issues (incomplete seed policies, non-atomic activation, missing
authoritative booking fields, Stripe cutover races, unsafe review-token
design). This plan replaces the single-batch approach with four
sub-batches (2A → 2D) executed in strict order. **No files change this
turn.** Batches 2B–2D cannot begin until the business/legal owner
approves final policy content.

---

## A. Revised Architecture

```text
                ┌───────────────────────────────┐
                │  Business / Legal Approval    │  (out-of-band)
                └──────────────┬────────────────┘
                               ▼
 2A  Booking foundation  →  2B  Policy bundle  →  2C  Snapshot + review
                                                     │
                                                     ▼
                                             2D  Stripe gate (flag-gated)
```

- **2A** adds authoritative, immutable booking fields (`service_context`,
  `price_cents`, `currency`, `row_version`, `content_digest`) plus a
  legacy backfill/quarantine strategy.
- **2B** defines the full four-policy bundle, atomic bundle activation,
  deterministic resolver tie-breakers, and approval metadata. All four
  policies stay inactive until legal sign-off.
- **2C** introduces `booking_policy_snapshots` and an opaque one-time
  server review record. Snapshots are built from locked server rows
  only; no client-supplied fields.
- **2D** wires the hard payment gate behind a server-side feature flag,
  with idempotent Stripe Checkout, webhook state machine, and explicit
  behavior for open pre-gate Stripe sessions.

Each sub-batch is independently deployable and reversible.

---

## B. Exact Schema Changes

### 2A — bookings foundation

```text
ALTER TABLE public.bookings
  ADD COLUMN service_context text,          -- 'standard' | 'airport'
  ADD COLUMN price_cents     integer,        -- authoritative integer amount
  ADD COLUMN currency        text DEFAULT 'usd',
  ADD COLUMN row_version     integer NOT NULL DEFAULT 1,
  ADD COLUMN content_digest  text;           -- hex sha256 of canonical row

-- CHECK: service_context IN ('standard','airport')
-- CHECK: price_cents >= 100  (enforced only on new rows via trigger)
-- CHECK: currency ~ '^[a-z]{3}$'
-- Immutability trigger: once set, service_context/price_cents/currency
--   cannot change; row_version monotonically increases; content_digest
--   recomputed server-side on every UPDATE.
```

Legacy rows: columns stay nullable at first; a follow-up backfill sets
them or moves rows into a `bookings_legacy_quarantine` audit table.
No CHECK NOT NULL until backfill completes.

### 2B — policy bundle

```text
ALTER TABLE public.cancellation_policies
  ADD COLUMN content_hash text,          -- hex sha256 of canonical policy body
  ADD COLUMN approved_by  uuid,          -- auth.users(id)
  ADD COLUMN approved_at  timestamptz,
  ADD COLUMN approval_reason text;

ALTER TABLE public.no_show_policies
  ADD COLUMN content_hash text,
  ADD COLUMN approved_by  uuid,
  ADD COLUMN approved_at  timestamptz,
  ADD COLUMN approval_reason text;

CREATE TABLE public.policy_bundles (
  id                       uuid PK,
  service_context          text NOT NULL,           -- 'standard' | 'airport'
  cancellation_policy_id   uuid NOT NULL REFERENCES cancellation_policies(id),
  no_show_policy_id        uuid NOT NULL REFERENCES no_show_policies(id),
  active                   boolean NOT NULL DEFAULT false,
  activated_at             timestamptz,
  activated_by             uuid,
  activation_reason        text,
  bundle_digest            text NOT NULL,           -- hash of both content_hashes
  created_at               timestamptz DEFAULT now()
);

-- Partial unique index: exactly one active bundle per service_context.
CREATE UNIQUE INDEX ON policy_bundles(service_context) WHERE active;
```

Drop the existing `active` column semantics on individual policy tables
in favor of "active = referenced by an active bundle." (Backwards
compatible: keep column, but resolver reads through bundle.)

### 2C — snapshots + review records

```text
CREATE TABLE public.booking_review_records (
  id                     uuid PK,
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  passenger_id           uuid NOT NULL REFERENCES auth.users(id),
  service_context        text NOT NULL,
  cancellation_policy_id uuid NOT NULL,
  no_show_policy_id      uuid NOT NULL,
  bundle_id              uuid NOT NULL REFERENCES policy_bundles(id),
  price_cents            integer NOT NULL,
  currency               text NOT NULL,
  issued_at              timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,       -- issued_at + 15 min
  nonce                  text NOT NULL,              -- 128-bit random
  content_digest         text NOT NULL,              -- canonical JSON hash
  hmac_signature         text NOT NULL,              -- HMAC-SHA256 with server key
  consumed_at            timestamptz,                -- single-use
  consumed_snapshot_id   uuid
);

CREATE TABLE public.booking_policy_snapshots (
  id                     uuid PK,
  booking_id             uuid NOT NULL UNIQUE REFERENCES bookings(id),
  review_record_id       uuid NOT NULL REFERENCES booking_review_records(id),
  passenger_id           uuid NOT NULL,
  service_context        text NOT NULL,
  cancellation_policy_id uuid NOT NULL,
  cancellation_version   int  NOT NULL,
  cancellation_hash      text NOT NULL,
  no_show_policy_id      uuid NOT NULL,
  no_show_version        int  NOT NULL,
  no_show_hash           text NOT NULL,
  bundle_id              uuid NOT NULL,
  bundle_digest          text NOT NULL,
  price_cents            integer NOT NULL,
  currency               text NOT NULL,
  accepted_at            timestamptz NOT NULL DEFAULT now(),
  accepted_ip            inet,
  accepted_user_agent    text,
  snapshot_digest        text NOT NULL              -- final immutable hash
);
-- Immutability trigger: no UPDATE, no DELETE (except service_role).
```

### 2D — Stripe cutover

```text
CREATE TABLE public.payment_attempts (
  id                     uuid PK,
  booking_id             uuid NOT NULL,
  snapshot_id            uuid NOT NULL REFERENCES booking_policy_snapshots(id),
  idempotency_key        text NOT NULL UNIQUE,
  stripe_session_id      text UNIQUE,
  amount_cents           integer NOT NULL,
  currency               text NOT NULL,
  state                  text NOT NULL,            -- pending|processing|processed|failed
  last_error             text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

ALTER TABLE public.stripe_events
  ADD COLUMN processing_state text NOT NULL DEFAULT 'received',
  ADD COLUMN attempt_count    int  NOT NULL DEFAULT 0,
  ADD COLUMN last_error       text;
-- processing_state: received | processing | processed | failed
```

---

## C. Exact RPC Signatures

All `SECURITY DEFINER SET search_path = public`, admin-gated where
noted, and audit-logged via `_audit_write`.

### 2A
- `bookings_classify_service_context(_pickup jsonb, _dropoff jsonb) → text`
  Deterministic server classifier (pure function, no free-text guessing;
  uses airport polygon / IATA whitelist / structured place-type tags).
- `bookings_backfill_row(_booking_id uuid) → jsonb` — admin, one row.
- `bookings_quarantine_report() → setof jsonb` — admin.

### 2B
- `admin_approve_policy(_table text, _id uuid, _reason text) → jsonb`
- `admin_create_policy_bundle(_service_context text, _cancel_id uuid, _no_show_id uuid) → uuid`
- `admin_activate_policy_bundle(_bundle_id uuid, _reason text) → jsonb`
  — atomic: locks all bundles for the service_context, deactivates the
  currently-active one, activates `_bundle_id`. Rejects if either
  referenced policy is not `approved`.
- `admin_deactivate_policy_bundle(_bundle_id uuid, _reason text) → jsonb`
- `get_active_bundle(_service_context text, _at timestamptz default now()) → jsonb`
  Tie-breaker order: `active=true` → most recent `activated_at` →
  lowest `bundle_id` (UUID sort). Deterministic.

### 2C
- `issue_booking_review_record(_booking_id uuid) → jsonb`
  Returns `{ review_id, expires_at, hmac_signature, canonical_payload }`.
- `accept_booking_policies(_review_id uuid, _hmac text, _client_meta jsonb) → jsonb`
  Single-use: consumes the review record, inserts the snapshot, returns
  `snapshot_id`. Rejects if expired, consumed, or hmac mismatch.
- `get_booking_snapshot(_booking_id uuid) → jsonb` — passenger self.

### 2D
- `create_payment_attempt(_snapshot_id uuid) → jsonb`
  Returns idempotency key, expected amount, currency.
- `record_payment_session(_attempt_id uuid, _session_id text) → void`
- `payments_gate_enabled() → boolean` (reads feature flag row).

---

## D. Legacy Booking Strategy

1. Add new columns nullable in 2A.
2. Run `bookings_backfill_row` in three passes:
   - **Pass 1 — deterministic**: rows with resolvable pickup/dropoff via
     the classifier get `service_context`, `price_cents = round(price*100)`,
     `currency='usd'`, `content_digest` computed.
   - **Pass 2 — quarantine**: rows the classifier cannot resolve (free-text
     addresses, missing price, non-USD) are copied to
     `bookings_legacy_quarantine` with the failure reason. **No guessing.**
   - **Pass 3 — report**: `bookings_quarantine_report()` surfaces
     remaining rows to admin for manual triage.
3. Only after Pass 3 is empty do we tighten `NOT NULL` constraints.
4. Payment gate applies **only** to bookings with a populated
   `service_context` — quarantined legacy rows cannot open new Stripe
   sessions.

---

## E. Policy Bundle & Activation Design

- Four policies to author: `standard_cancel`, `airport_cancel`,
  `standard_no_show`, `airport_no_show`.
- Each policy carries `content_hash` computed over canonical serialization
  of customer-facing + fee fields; `approved_by`/`approved_at` set by
  admin RPC after legal review.
- A **bundle** binds one cancellation + one no-show policy to a
  `service_context`. Two bundles required at go-live (standard, airport).
- **Atomic activation**: `admin_activate_policy_bundle` locks
  `policy_bundles` rows for the service_context `FOR UPDATE`, verifies
  both referenced policies are approved, deactivates the current active
  bundle, activates the new one, and writes audit records — all in one
  transaction.
- **Resolver tie-breaker**: even though the partial unique index
  guarantees ≤1 active bundle, `get_active_bundle` still applies
  `ORDER BY active DESC, activated_at DESC, id ASC LIMIT 1` for
  deterministic replay in case of manual data repair.

---

## F. Review Record / Token Design

- Time buckets are **rejected**.
- Two acceptable shapes (we ship the first):
  1. **Opaque server record** (`booking_review_records`). Client receives
     only `review_id` + `hmac_signature`. All content is server-stored.
     Consumed atomically via `UPDATE ... WHERE consumed_at IS NULL
     RETURNING ...`.
  2. Fallback (not used unless client offline flows appear later): JWS
     with `iat`, `exp`, `jti`, canonical payload, HMAC-SHA256 keyed with
     a server secret from Lovable secrets.
- `hmac_signature` = HMAC-SHA256(server_key, canonical_json(payload)).
  `content_digest` = SHA-256(canonical_json(payload)) — used for
  passenger-visible integrity checks, never for authorization.
- Single-use enforced by `consumed_at IS NULL` predicate on the update.
- Expiry: 15 minutes. Expired records are inert.

---

## G. Stripe & Webhook Cutover

- **Idempotency key** for Stripe Checkout Sessions:
  `hl_pa_<payment_attempt_id>`. Stripe deduplicates identical retries.
- Session creation flow:
  1. Client calls `accept_booking_policies` → snapshot.
  2. Client calls `create_payment_attempt(snapshot_id)`.
  3. Server calls Stripe with `idempotency_key`, attaches
     `metadata = { snapshot_id, snapshot_digest, bundle_digest,
     price_cents, currency, booking_id, payment_attempt_id }`.
  4. Server writes `stripe_session_id` onto the payment_attempt.
- **Webhook state machine** on `stripe_events`:
  `received → processing → processed | failed`. `processing` rows can be
  retried by a scheduled sweeper; `processed` rows are idempotent
  no-ops on redelivery. Failed rows are visible in admin.
- Webhook verifies:
  - signature (already implemented in `stripe.server.ts`);
  - `metadata.snapshot_id` matches `payment_attempt.snapshot_id`;
  - `amount_total == snapshot.price_cents`;
  - `currency == snapshot.currency`;
  - policy versions + `bundle_digest` still exist (mismatch → mark
    `failed`, alert, do **not** finalize booking payment state).
- **Pre-gate open sessions**: on the day of cutover, all Stripe sessions
  created within the previous 24h are enumerated. Sessions without a
  matching `payment_attempts` row are cancelled via Stripe API and
  passengers re-quoted. Documented as an operational runbook step.
- **Feature flag**: `payments_gate_enabled` boolean in
  `support_settings` (or new `feature_flags` row). Off = advisory logs.
  On = hard reject any `createBookingCheckout` without a valid snapshot
  + payment_attempt.

---

## H. RLS, GRANT, SECURITY DEFINER Rules

All new tables:
- `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL ... FROM PUBLIC, anon`.
- `GRANT SELECT ... TO authenticated` **only** where a policy scopes to
  `auth.uid()`.
- `GRANT ALL ... TO service_role`.
- No `INSERT/UPDATE/DELETE` grants to authenticated on
  `bookings_legacy_quarantine`, `policy_bundles`,
  `booking_review_records`, `booking_policy_snapshots`,
  `payment_attempts` — all mutations flow through DEFINER RPCs.
- `REVOKE EXECUTE ... FROM PUBLIC` on every new function, then
  `GRANT EXECUTE ... TO authenticated` only for passenger-facing RPCs
  (`issue_booking_review_record`, `accept_booking_policies`,
  `get_booking_snapshot`, `create_payment_attempt`).
- Snapshot table: immutability trigger blocks UPDATE/DELETE for all
  roles except `service_role`.
- Audit: every admin RPC calls `_audit_write` with the RPC name and the
  reason parameter (required).

---

## I. Test Matrix

**Database**
- Bundle activation: concurrent activations for same service_context →
  exactly one winner (test via two `pg_sleep`-holding transactions).
- Immutability triggers on bookings + snapshots reject UPDATE/DELETE.
- Backfill quarantine: unresolvable rows land in quarantine and are
  never touched by the gate.

**UI**
- Passenger review modal renders bundle content from server response
  only; checkbox unchecked by default; disabled Pay button until
  consent + non-expired review record.
- Admin bundle screen shows approval state and blocks activation of
  unapproved policies.

**Stripe sandbox**
- Duplicate `create_payment_attempt` → same idempotency key → single
  Stripe session.
- Webhook redelivery on a `processed` event → no-op.
- Amount tampering (Stripe dashboard manual adjustment) → snapshot
  verifier flags `failed`, booking is **not** marked paid.
- Pre-gate open sessions are cancelled by the runbook script.

**Race conditions**
- Bundle change mid-review: passenger's review record still points at
  the frozen bundle; new bookings post-change use the new bundle.
- Review record expiry during Stripe redirect → `create_payment_attempt`
  rejects with a re-review path.

---

## J. Deployment Sequence

1. Business/legal approves all four policy bodies. **Blocking.**
2. Ship 2A migration. Backfill pass 1. Report quarantine.
3. Manual triage of quarantine until empty (or explicitly waived by
   business owner per row).
4. Ship 2B migration. Admin authors four policies (v1) and marks each
   `approved`. Create both bundles. Do **not** activate yet.
5. Ship 2C migration + passenger review UI. Advisory only.
6. Activate both bundles atomically via
   `admin_activate_policy_bundle`.
7. Ship 2D migration + `payment_attempts` + webhook state machine with
   `payments_gate_enabled = false`.
8. Smoke test end-to-end in sandbox with real users.
9. Cancel any stray pre-gate Stripe sessions (runbook).
10. Flip `payments_gate_enabled = true`.
11. Monitor for 72h with dashboards on webhook `failed` state.

---

## K. Rollback Sequence

Each sub-batch has an isolated reversal:

- **2D**: set `payments_gate_enabled = false`; keep tables (audit trail).
- **2C**: stop calling `accept_booking_policies` from the UI; snapshots
  remain (historical record). Do not drop the table.
- **2B**: deactivate bundles; policies stay for audit.
- **2A**: leave columns in place (data-safe); revert triggers if
  necessary. Never drop `service_context`/`price_cents` once populated.

Full rollback SQL (destructive, only if none of the sub-batches ever
reached production): drop new tables in reverse dependency order —
`payment_attempts` → `booking_policy_snapshots` →
`booking_review_records` → `policy_bundles` →
`bookings_legacy_quarantine`; ALTER TABLE bookings DROP COLUMN … for the
five new columns; DROP the new RPCs.

---

## L. Business / Legal Decisions Still Required

1. **Final wording** of four customer-facing policy summaries (standard
   cancellation, airport cancellation, standard no-show, airport
   no-show).
2. **Fee structure per policy** (fixed / percentage / full_fare / none;
   caps; free-cancellation cutoff hours; min wait seconds for no-show;
   automatic-charge yes/no; admin-review-required yes/no).
3. **Airport definition** — authoritative list of served airports and
   the classification rule (IATA codes / geofence polygons).
4. **Legacy booking policy** — for pre-gate bookings, do we (a)
   retroactively require acceptance on cancel/no-show, (b) apply a
   grandfathered legacy policy, or (c) exempt them entirely?
5. **Currency scope** — USD only at go-live? Multi-currency deferred?
6. **Approval authority** — which admin account is authorized to sign
   `admin_approve_policy`? (Two-person rule?)
7. **Pre-gate open sessions** — refund vs. re-quote for any session
   older than N minutes at cutover.

Until 1–4 are answered in writing, 2B/2C/2D cannot begin.

---

## M. Project Status After This Planning Turn

- **Files changed this turn**: none.
- **Migrations run**: none.
- **Policies activated**: none.
- **Stripe behavior**: unchanged from current production.
- **Batch 1**: complete and verified (from prior turn).
- **Batch 2**: replaced by 2A–2D above. **Not started.**
- **Codex audit findings**: all five accepted and reflected in this plan.
- **Engineering Protocol**: applied — security-first, backward
  compatible, no client-trusted authorization, atomic activation,
  legacy data quarantined not guessed.

---

IMPLEMENTATION STATUS: BLOCKED — AWAITING BUSINESS AND LEGAL POLICY APPROVAL
