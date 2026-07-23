# HarborLine Batch 2 — Revision 2.1 Implementation Specification

No files changed this turn. No migrations. No code changes. No policy activation. No deploy. No implementation.

## A. Revision Summary

Codex final decision: APPROVE PLAN WITH CONDITIONS. Revision 2.1 incorporates the mandatory conditions:

1. Real booking field names used: `pickup_time`, `ride_type`, `passengers`.
2. Explicit `contract_version` mutation matrix documented.
3. Amenity mutations must bump parent booking `contract_version` in-transaction.
4. Deterministic legacy pricing rules: prefer stored `price` over `suggested_price`.
5. Correct 2B migration: do not re-add existing columns; apply only additive changes.
6. Atomic bundle readiness RPC for `enforce` transition.
7. Canonical digest specification: JCS-style JSON, NFC normalization, deterministic key ordering.
8. 2C shadow mode never blocks Pay.
9. Privacy: `token_hash` never exposed to client or authenticated role.
10. Defer IP/UA collection from 2C; schema reserves nullable fields.
11. Stripe session expiry moved to TanStack server function; PostgreSQL records only the attempt.
12. Environment-specific gate rows (development/sandbox/production).
13. Pre-2D open-session reconciliation runbook required before `enforce`.

Scope remains four additive releases: 2A, 2B, 2C, 2D.

## B. Release Architecture

```
2A booking contract normalization
  → 2B policy bundles (draft/approved/active)
    → 2C shadow review/evidence (never blocks Pay)
      → 2D payment attempts + webhook lease + gate (shadow→enforce)
```

Existing booking + immediate Stripe Checkout keeps working through 2A/2B/2C. 2D only flips to `enforce` after legal approval, seeded/approved bundles, a successful reconciliation runbook, and a tested atomic readiness check.

## C. 2A — Booking Contract Normalization

### C.1. Additive columns on `public.bookings`

```sql
ALTER TABLE public.bookings
  ADD COLUMN service_context text
    CHECK (service_context IN ('standard','airport','unresolved'))
    DEFAULT 'unresolved',
  ADD COLUMN pickup_context text
    CHECK (pickup_context IN ('street','airport','fbo','private_airfield','unknown'))
    DEFAULT 'unknown',
  ADD COLUMN dropoff_context text
    CHECK (dropoff_context IN ('street','airport','fbo','private_airfield','unknown'))
    DEFAULT 'unknown',
  ADD COLUMN price_cents integer
    CHECK (price_cents >= 100),
  ADD COLUMN currency text
    CHECK (currency ~ '^[a-z]{3}$'),
  ADD COLUMN contract_version integer NOT NULL DEFAULT 1,
  ADD COLUMN classifier_version text,
  ADD COLUMN classifier_evidence jsonb;
```

Existing columns retained: `pickup`, `dropoff`, `pickup_time`, `ride_type`, `passengers`, `status`, `passenger_id`, etc. No immutability trigger on `bookings` — invalidation is via `contract_version` bump.

### C.2. `airport_registry`

```sql
CREATE TABLE public.airport_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('airport','fbo','private_airfield')),
  iata text,
  icao text,
  name text NOT NULL,
  geo jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_airport_registry_kind ON public.airport_registry(kind);
CREATE INDEX idx_airport_registry_iata ON public.airport_registry(iata) WHERE active = true;

GRANT SELECT ON public.airport_registry TO authenticated;
GRANT SELECT ON public.airport_registry TO anon;
GRANT ALL ON public.airport_registry TO service_role;

ALTER TABLE public.airport_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active airports"
  ON public.airport_registry FOR SELECT
  TO public
  USING (active = true);
```

Seed data loaded for legal-approved airports/FBOs/private airfields. Classifier uses the registry as the sole authoritative source.

### C.3. `service_context` classifier

- `standard`: neither pickup nor dropoff is an airport/FBO/private airfield.
- `airport`: pickup or dropoff (or both) is an airport/FBO/private airfield.
- `unresolved`: classifier cannot decide, writes `classifier_evidence`, never defaults to `standard`.

Quarantine reason codes for `unresolved`:

- `NO_PICKUP_COORDS`
- `NO_DROPOFF_COORDS`
- `NON_USD_CURRENCY`
- `PRICE_MISSING`
- `PRICE_INCONSISTENT`
- `AMBIGUOUS_AIRPORT_MATCH`
- `UNKNOWN_VEHICLE_TYPE`

### C.4. Legacy pricing rules

Backfill runs in 2A migration only for rows with `price_cents IS NULL`:

```
1. If bookings.price is present and numeric, price_cents = round(price * 100).
2. Else if bookings.suggested_price is present and numeric, price_cents = round(suggested_price * 100).
3. Else currency is forced to 'usd' and price_cents is set to a sentinel quarantine value 100.
   These rows become service_context = 'unresolved' and require admin resolution.
```

All future bookings receive `price_cents` and `currency` from the server-authoritative `create_booking` RPC.

### C.5. GRANTs for 2A

```sql
GRANT SELECT ON public.airport_registry TO authenticated;
GRANT SELECT ON public.airport_registry TO anon;
GRANT ALL ON public.airport_registry TO service_role;

-- No new grants on public.bookings required; existing authenticated grants apply.
-- service_role retains ALL on public.bookings.
```

### C.6. Files for 2A

- 1 migration: booking contract columns + airport registry + seed + legacy backfill.
- Optional: `src/lib/policies.functions.ts` classifier helpers (if not already present).
- No route/UI changes.

## D. 2B — Policy Bundles

### D.1. Corrective migration on existing tables

Assumes `cancellation_policies` and `no_show_policies` already exist from Batch 1. Add only missing columns.

```sql
-- cancellation_policies
ALTER TABLE public.cancellation_policies
  ADD COLUMN IF NOT EXISTS service_type text
    NOT NULL DEFAULT 'standard'
    CHECK (service_type IN ('standard','airport')),
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to timestamptz;

ALTER TABLE public.cancellation_policies
  DROP CONSTRAINT IF EXISTS uq_cancel_id_svc,
  ADD CONSTRAINT uq_cancel_id_svc UNIQUE (id, service_type);

-- no_show_policies
ALTER TABLE public.no_show_policies
  ADD COLUMN IF NOT EXISTS service_type text
    NOT NULL DEFAULT 'standard'
    CHECK (service_type IN ('standard','airport')),
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to timestamptz;

ALTER TABLE public.no_show_policies
  DROP CONSTRAINT IF EXISTS uq_noshow_id_svc,
  ADD CONSTRAINT uq_noshow_id_svc UNIQUE (id, service_type);
```

### D.2. `policy_bundles`

```sql
CREATE TABLE public.policy_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_context text NOT NULL
    CHECK (service_context IN ('standard','airport')),
  cancellation_policy_id uuid NOT NULL,
  no_show_policy_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('draft','approved','active','retired')),
  approved_by uuid,
  approved_at timestamptz,
  approval_reason text,
  activated_at timestamptz,
  activated_by uuid,
  activation_reason text,
  effective_from timestamptz,
  effective_to timestamptz,
  bundle_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (cancellation_policy_id, service_context)
    REFERENCES public.cancellation_policies(id, service_type),
  FOREIGN KEY (no_show_policy_id, service_context)
    REFERENCES public.no_show_policies(id, service_type)
);

CREATE UNIQUE INDEX idx_policy_bundles_active
  ON public.policy_bundles(service_context)
  WHERE status = 'active';

CREATE INDEX idx_policy_bundles_service_status
  ON public.policy_bundles(service_context, status);

GRANT SELECT ON public.policy_bundles TO authenticated;
GRANT ALL ON public.policy_bundles TO service_role;
REVOKE ALL ON public.policy_bundles FROM anon;

ALTER TABLE public.policy_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read policy bundles"
  ON public.policy_bundles FOR SELECT
  TO authenticated
  USING (true);
```

### D.3. Canonical digest specification

For any policy content JSON `j`:

1. Convert all string values to Unicode NFC normalized form.
2. Convert all timestamps to ISO-8601 UTC with `Z` suffix.
3. Lowercase all currency codes.
4. Sort object keys lexicographically at every level (JCS-style / RFC 8785).
5. Remove whitespace between tokens.
6. Encode as UTF-8 bytes.
7. Compute `sha256(content_json)`.

Bundle digest:

```
D = sha256( cancellation.content_hash || '|' ||
            no_show.content_hash       || '|' ||
            service_context )
```

Test vectors are published in the migration for parity checks between client and server canonicalizers.

### D.4. RPCs for 2B

All functions are `SECURITY DEFINER SET search_path = public`. Default: `REVOKE EXECUTE ON FUNCTION x FROM PUBLIC, anon;`

**Admin functions** — `GRANT EXECUTE TO authenticated`; internal `has_role(auth.uid(), 'admin')` check.

- `admin_approve_policy(_policy_id uuid, _policy_kind text, _reason text) → void`
  - Sets `approved_by`, `approved_at`, `approval_reason`. Kind: `cancel` or `no_show`.

- `admin_create_policy_bundle(
    _service_context text,
    _cancellation_policy_id uuid,
    _no_show_policy_id uuid,
    _effective_from timestamptz,
    _effective_to timestamptz
  ) → uuid`
  - Verifies both policies are approved, service_context matches, and digest computes.
  - Creates bundle with status `draft`.

- `admin_update_policy_bundle(_bundle_id uuid, ...) → void`
  - Only allowed while status is `draft` or `approved`.

- `admin_approve_policy_bundle(_bundle_id uuid, _reason text) → void`
  - Moves bundle from `draft` to `approved`.

- `admin_activate_policy_bundle(_bundle_id uuid, _reason text) → void`
  - Atomically retires the existing active bundle for the same `service_context` and activates the new one.
  - Uses `SELECT ... FOR UPDATE` on `policy_bundles` to ensure exactly one active bundle per service_context.

- `admin_deactivate_policy_bundle(_bundle_id uuid, _reason text) → void`
  - Moves active bundle to `retired`; leaves no active bundle for that service_context.

- `admin_list_policy_bundles(_service_context text) → jsonb`

- `admin_get_policy_bundle(_bundle_id uuid) → jsonb`

- `admin_activate_bundle_readiness(_environment text) → jsonb`
  - Returns `{ ready: boolean, reasons: text[] }`.
  - Checks:
    - Active bundles exist for `standard` and `airport`.
    - No unresolved payable bookings with `service_context = 'unresolved'`.
    - Reconciliation report exists for pre-2D open sessions.
    - Webhook lease machinery is present and tested.

- `admin_set_payment_gate_mode(_environment text, _mode text, _cutover_at timestamptz, _reason text) → void`
  - Allowed modes: `shadow`, `enforce`, `paused`.
  - Transition to `enforce` requires `admin_activate_bundle_readiness(_environment).ready = true`.
  - Rollback from `enforce` sets `paused`, never `shadow`.

- `admin_resolve_unresolved_booking(
    _booking_id uuid,
    _service_context text,
    _price_cents integer,
    _currency text,
    _reason text
  ) → void`
  - Internal `has_role(auth.uid(), 'admin')` check.
  - Bumps `contract_version`, writes `_audit_write`, records actor+reason.
  - Requires `_service_context IN ('standard','airport')`.

- `admin_expire_pregate_sessions(_environment text) → jsonb`
  - TanStack server function calls Stripe `sessions.expire` for open sessions created before `cutover_at`. PostgreSQL records only metadata and counts.

**Public resolver** — `GRANT EXECUTE TO authenticated`.

- `get_active_bundle(_service_context text) → jsonb`
  - Returns the active bundle for the service context or `null`.

### D.5. GRANTs for 2B

```sql
REVOKE ALL ON public.cancellation_policies FROM anon;
REVOKE ALL ON public.no_show_policies FROM anon;
REVOKE ALL ON public.policy_bundles FROM anon;

GRANT SELECT ON public.cancellation_policies TO authenticated;
GRANT SELECT ON public.no_show_policies TO authenticated;
GRANT SELECT ON public.policy_bundles TO authenticated;

GRANT ALL ON public.cancellation_policies TO service_role;
GRANT ALL ON public.no_show_policies TO service_role;
GRANT ALL ON public.policy_bundles TO service_role;
```

### D.6. Files for 2B

- 1 migration: policy bundle tables + columns + GRANTs + seed policies.
- Extend `src/lib/policies.functions.ts`.
- Extend `src/components/admin/BookingPoliciesPanel.tsx` for bundle CRUD, approval, and activation.

## E. 2C — Shadow Review & Immutable Snapshots

### E.1. `booking_review_records`

```sql
CREATE TABLE public.booking_review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_context text NOT NULL
    CHECK (service_context IN ('standard','airport')),
  bundle_id uuid NOT NULL REFERENCES public.policy_bundles(id),
  bundle_digest text NOT NULL,
  price_cents integer NOT NULL,
  currency text NOT NULL,
  contract_version integer NOT NULL,
  status text NOT NULL
    CHECK (status IN ('issued','consumed','expired','revoked')),
  token_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  enforcement_mode text NOT NULL
    CHECK (enforcement_mode IN ('shadow','enforce')),
  ui_version text,
  wording_version text,
  schema_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_booking_review_records_issued
  ON public.booking_review_records(booking_id, passenger_id)
  WHERE status = 'issued';

CREATE INDEX idx_booking_review_records_booking
  ON public.booking_review_records(booking_id, status);

GRANT SELECT ON public.booking_review_records TO authenticated;
REVOKE ALL ON public.booking_review_records FROM anon;
GRANT ALL ON public.booking_review_records TO service_role;

ALTER TABLE public.booking_review_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger reads own review records"
  ON public.booking_review_records FOR SELECT
  TO authenticated
  USING (passenger_id = auth.uid());

CREATE POLICY "Service role manages review records"
  ON public.booking_review_records FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Privacy rule: `token_hash` must never be returned to the client. The policy above grants `SELECT` but RPCs and server functions must never expose the column value to the authenticated client. The server function only returns `review_id`, `raw_token` (once), and `expires_at` from the issue RPC.

### E.2. `booking_policy_snapshots`

```sql
CREATE TABLE public.booking_policy_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_record_id uuid NOT NULL UNIQUE REFERENCES public.booking_review_records(id),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_version integer NOT NULL,
  service_context text NOT NULL
    CHECK (service_context IN ('standard','airport')),
  cancellation_policy_id uuid NOT NULL,
  cancellation_hash text NOT NULL,
  cancellation_version integer NOT NULL,
  no_show_policy_id uuid NOT NULL,
  no_show_hash text NOT NULL,
  no_show_version integer NOT NULL,
  bundle_id uuid NOT NULL REFERENCES public.policy_bundles(id),
  bundle_digest text NOT NULL,
  price_cents integer NOT NULL,
  currency text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_ip inet,
  accepted_user_agent text,
  enforcement_mode text NOT NULL
    CHECK (enforcement_mode IN ('shadow','enforce')),
  ui_version text,
  wording_version text,
  schema_version text,
  snapshot_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_policy_snapshots_booking
  ON public.booking_policy_snapshots(booking_id, contract_version);

GRANT SELECT ON public.booking_policy_snapshots TO authenticated;
REVOKE ALL ON public.booking_policy_snapshots FROM anon;
GRANT ALL ON public.booking_policy_snapshots TO service_role;

ALTER TABLE public.booking_policy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger reads own snapshots"
  ON public.booking_policy_snapshots FOR SELECT
  TO authenticated
  USING (passenger_id = auth.uid());

CREATE POLICY "Service role manages snapshots"
  ON public.booking_policy_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger: reject UPDATE and DELETE for every role including service_role application path.
CREATE OR REPLACE FUNCTION trg_reject_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'booking_policy_snapshots is immutable: % on id % not allowed', TG_OP, OLD.id;
END;
$$;

CREATE TRIGGER reject_snapshot_mutation
  BEFORE UPDATE OR DELETE ON public.booking_policy_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION trg_reject_snapshot_mutation();
```

Snapshot digest:

```
D = sha256( booking_id || '|' ||
            passenger_id || '|' ||
            contract_version || '|' ||
            service_context || '|' ||
            cancellation_policy_id || '|' || cancellation_hash || '|' || cancellation_version || '|' ||
            no_show_policy_id || '|' || no_show_hash || '|' || no_show_version || '|' ||
            bundle_id || '|' || bundle_digest || '|' ||
            price_cents || '|' ||
            currency )
```

All values concatenated as UTF-8 strings. `accepted_ip` and `accepted_user_agent` are deferred in 2C; they remain nullable and are not populated by the acceptance flow.

### E.3. `booking_snapshot_corrections`

```sql
CREATE TABLE public.booking_snapshot_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.booking_policy_snapshots(id),
  supersedes_id uuid REFERENCES public.booking_snapshot_corrections(id),
  reason text NOT NULL,
  actor uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  correction_payload jsonb NOT NULL,
  correction_digest text NOT NULL
);

GRANT SELECT ON public.booking_snapshot_corrections TO authenticated;
REVOKE ALL ON public.booking_snapshot_corrections FROM anon;
GRANT ALL ON public.booking_snapshot_corrections TO service_role;

ALTER TABLE public.booking_snapshot_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger reads own corrections"
  ON public.booking_snapshot_corrections FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.booking_policy_snapshots s
    WHERE s.id = snapshot_id AND s.passenger_id = auth.uid()
  ));
```

### E.4. Contract-version mutation matrix

Fields that bump `contract_version` when changed (and revoke any `issued` review records):

- `price_cents`
- `currency`
- `pickup_time`
- `pickup` (free text)
- `pickup_identity` (structured place)
- `dropoff` (free text)
- `dropoff_identity` (structured place)
- `service_context`
- `ride_type`
- `passengers`
- `priced_amenities` (JSONB amenities)

Fields that do NOT bump `contract_version`:

- `status`
- `driver_id`
- `dispatch_status`
- `vehicle_assignment`
- `notifications`
- `audit` fields
- `location` / `gps` updates
- `pin` / `verified_at`
- operational timestamps

Amenity mutation rule: any write to `priced_amenities` must happen inside the `bookings_mutate_amenities` RPC, which atomically updates the amenities JSON and increments `bookings.contract_version` for the parent booking.

### E.5. RPCs for 2C

All functions `SECURITY DEFINER SET search_path = public`. Default: `REVOKE EXECUTE FROM PUBLIC, anon;`

**Passenger functions** — `GRANT EXECUTE TO authenticated`.

- `issue_booking_review_record(_booking_id uuid) → jsonb`
  - Locks booking row with `SELECT ... FOR UPDATE`.
  - Requires `auth.uid() = bookings.passenger_id`.
  - Rejects `service_context = 'unresolved'`.
  - Fetches active bundle via `get_active_bundle`.
  - Revokes any prior `issued` records for this `(booking_id, passenger_id)`.
  - Inserts new record with status `issued`, mode `shadow`, 15-minute expiry.
  - Returns `{ review_id, raw_token, expires_at }`. Raw token is a 256-bit CSPRNG base64url string.
  - Stores only `sha256(raw_token)` in `token_hash`.

- `accept_booking_policies(_review_id uuid, _submitted_token_hash text, _client_meta jsonb) → jsonb`
  - Requires `auth.uid() = passenger_id`.
  - Verifies `status = 'issued'` and `expires_at > now()`.
  - Verifies `_submitted_token_hash = token_hash`.
  - Verifies booking `contract_version` still matches the review record.
  - Verifies the active bundle still exists and `bundle_digest` matches.
  - Atomically updates review record `status = 'consumed'`, `consumed_at = now()` and inserts a `booking_policy_snapshots` row.
  - Idempotent replay: if already consumed and hashes match, returns existing `snapshot_id`.
  - Returns `{ snapshot_id, accepted_at }`.

- `get_booking_snapshot(_booking_id uuid) → jsonb`
  - Passenger self. Returns the most recent accepted snapshot for their booking or `null`.

- `bookings_mutate_amenities(_booking_id uuid, _amenities jsonb) → jsonb`
  - Requires ownership.
  - Atomically updates `priced_amenities` and increments `contract_version`.
  - Revokes any `issued` review records for the booking.

- `create_payment_attempt(_snapshot_id uuid) → jsonb`
  - Returns `{ attempt_id, idempotency_key, amount_cents, currency }`. Does not create a Stripe session in 2C.

**Admin functions** — `GRANT EXECUTE TO authenticated`; internal `has_role(auth.uid(), 'admin')` check.

- `admin_revoke_review_record(_review_id uuid, _reason text) → void`
- `admin_expire_review_record(_review_id uuid) → void`
- `admin_list_booking_snapshots(_booking_id uuid) → jsonb`
- `admin_maintenance_snapshot_tombstone(_snapshot_id uuid, _reason text) → void` — writes audit + cryptographic tombstone for GDPR erasure; never silent rewrite.

**Service-role internal** — no execute grant to authenticated.

- `_revoke_issued_reviews_on_contract_bump()` — trigger function on `bookings`.

### E.6. Trigger: revoke issued reviews on contract bump

```sql
CREATE OR REPLACE FUNCTION trg_revoke_issued_reviews_on_contract_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contract_version <> OLD.contract_version THEN
    UPDATE public.booking_review_records
    SET status = 'revoked',
        revoked_at = now(),
        revoke_reason = 'contract_version_bump'
    WHERE booking_id = NEW.id
      AND status = 'issued';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER revoke_issued_reviews_on_contract_bump
  AFTER UPDATE OF contract_version ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION trg_revoke_issued_reviews_on_contract_bump();
```

### E.7. GRANTs for 2C

```sql
REVOKE ALL ON public.booking_review_records FROM anon;
REVOKE ALL ON public.booking_policy_snapshots FROM anon;
REVOKE ALL ON public.booking_snapshot_corrections FROM anon;

GRANT SELECT ON public.booking_review_records TO authenticated;
GRANT SELECT ON public.booking_policy_snapshots TO authenticated;
GRANT SELECT ON public.booking_snapshot_corrections TO authenticated;

GRANT ALL ON public.booking_review_records TO service_role;
GRANT ALL ON public.booking_policy_snapshots TO service_role;
GRANT ALL ON public.booking_snapshot_corrections TO service_role;
```

### E.8. Files for 2C

- 1 migration: review records, snapshots, corrections, triggers, GRANTs.
- New `src/lib/reviews.functions.ts`.
- New `src/components/BookingReviewModal.tsx`.
- `src/routes/book.tsx` gains a shadow-only review step.
- Snapshots are recorded but Stripe path is unchanged; Pay button is never blocked.

## F. 2D — Payment Gate & Stripe Cutover

### F.1. `payment_attempts`

```sql
CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.booking_policy_snapshots(id),
  environment text NOT NULL
    CHECK (environment IN ('development','sandbox','production')),
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  stripe_session_id text UNIQUE,
  stripe_created_at timestamptz,
  state text NOT NULL
    CHECK (state IN ('pending','session_created','processing','processed','failed','expired')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_attempts_booking
  ON public.payment_attempts(booking_id, state);

CREATE INDEX idx_payment_attempts_stripe_session
  ON public.payment_attempts(stripe_session_id);

GRANT SELECT ON public.payment_attempts TO authenticated;
REVOKE ALL ON public.payment_attempts FROM anon;
GRANT ALL ON public.payment_attempts TO service_role;

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger reads own attempts"
  ON public.payment_attempts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id AND b.passenger_id = auth.uid()
  ));
```

### F.2. `stripe_events` extensions

```sql
ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS processing_state text
    NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received','processing','processed','failed')),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;
```

### F.3. `payment_gate_state`

```sql
CREATE TABLE public.payment_gate_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  environment text NOT NULL UNIQUE
    CHECK (environment IN ('development','sandbox','production')),
  mode text NOT NULL
    CHECK (mode IN ('shadow','enforce','paused')),
  cutover_at timestamptz,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payment_gate_state(environment, mode, cutover_at)
VALUES ('development','shadow', null),
       ('sandbox','shadow', null),
       ('production','shadow', null)
ON CONFLICT (environment) DO NOTHING;

GRANT SELECT ON public.payment_gate_state TO authenticated;
REVOKE ALL ON public.payment_gate_state FROM anon;
GRANT ALL ON public.payment_gate_state TO service_role;

ALTER TABLE public.payment_gate_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read gate state"
  ON public.payment_gate_state FOR SELECT
  TO authenticated
  USING (true);
```

### F.4. Gate behavior

- `shadow`: existing Stripe path unchanged; review/attempt infra observed only. No enforcement. Pay button never blocked.
- `enforce`: `createBookingCheckout` requires a live accepted snapshot + `payment_attempts` row for the current `contract_version`, else hard reject.
- `paused`: no new Stripe Sessions may be created at all.

Unknown/invalid/unavailable gate row → fail-closed to `paused`. Rolling back `enforce` sets `paused`, never silently back to unauthenticated payment.

### F.5. Stripe cutover rule

`payment_attempts` records `stripe_session_id` and `stripe_created_at` immediately after Session creation. Idempotency key format: `hl_pa_<attempt_id>` passed via Stripe request options.

Grandfathering keyed off `stripe_created_at` vs `payment_gate_state.cutover_at`:

- Sessions with `stripe_created_at < cutover_at` are grandfathered.
- Sessions with `stripe_created_at >= cutover_at` without a linked accepted snapshot are rejected.
- Only open sessions may be cancelled via Stripe `sessions.expire`; completed or already-expired sessions are left alone and reported.

Stripe session expiry is performed from a TanStack server function (`admin_expire_pregate_sessions`). PostgreSQL only records the attempt and count; it does not call the Stripe API.

### F.6. Webhook lease & atomicity

Claim query:

```sql
UPDATE public.stripe_events
SET processing_state = 'processing',
    lease_owner = $worker_id,
    lease_expires_at = now() + interval '2 minutes',
    attempt_count = attempt_count + 1,
    next_retry_at = null
WHERE id = $event_id
  AND (
    processing_state = 'received'
    OR (processing_state = 'failed' AND next_retry_at <= now())
    OR (processing_state = 'processing' AND lease_expires_at < now())
  )
RETURNING *;
```

Single winner. Finalize RPC in one transaction:

1. Verify event signature and idempotency.
2. Verify Stripe session vs `payment_attempts`.
3. Verify amount + currency vs the historical snapshot.
4. Mark booking paid.
5. Set `payment_attempts.state = 'processed'`.
6. Set `stripe_events.processing_state = 'processed'`, `processed_at = now()`.
7. Write payment + audit records.

Historical accepted snapshot is the source of truth; webhook never re-resolves the active bundle. On failure: set `state = 'failed'`, record `last_error`, set `next_retry_at` with exponential backoff.

On redelivery of a `processed` event: no-op, return `200` without re-applying.

### F.7. RPCs for 2D

**Passenger functions** — `GRANT EXECUTE TO authenticated`.

- `create_payment_attempt(_snapshot_id uuid) → jsonb`
  - Returns `{ attempt_id, idempotency_key, amount_cents, currency }`.

- `get_booking_payment_status(_booking_id uuid) → jsonb`
  - Passenger self.

**Admin functions** — `GRANT EXECUTE TO authenticated`; internal `has_role(auth.uid(), 'admin')` check.

- `admin_set_payment_gate_mode(_environment text, _mode text, _cutover_at timestamptz, _reason text) → void`
- `admin_activate_bundle_readiness(_environment text) → jsonb`
- `admin_expire_pregate_sessions(_environment text) → jsonb`
  - Returns metadata only; actual Stripe expiry runs in TanStack server function.

**Service-role internal** — no execute grant to authenticated.

- `_webhook_claim_lease(_event_id uuid, _worker_id text) → jsonb`
- `_webhook_finalize_event(_event_id uuid, _worker_id text) → void`
- `_maintenance_snapshot_tombstone(_snapshot_id uuid, _reason text) → void`

### F.8. GRANTs for 2D

```sql
REVOKE ALL ON public.payment_attempts FROM anon;
REVOKE ALL ON public.payment_gate_state FROM anon;
REVOKE ALL ON public.stripe_events FROM anon;

GRANT SELECT ON public.payment_attempts TO authenticated;
GRANT SELECT ON public.payment_gate_state TO authenticated;
-- stripe_events already has appropriate grants; verify no broad anon access.

GRANT ALL ON public.payment_attempts TO service_role;
GRANT ALL ON public.payment_gate_state TO service_role;
GRANT ALL ON public.stripe_events TO service_role;
```

### F.9. Files for 2D

- 1 migration: `payment_attempts`, `stripe_events` extensions, `payment_gate_state`, GRANTs.
- Extend `src/lib/payments.functions.ts` with payment attempt + gate read.
- Update `src/routes/api/public/payments/webhook.ts` for lease + atomic finalize.
- Extend `src/components/admin/BookingPoliciesPanel.tsx` with gate-mode admin control.
- New TanStack server function for pre-cutover session expiry.

## G. Contract-Version & Invalidation Rules

Contract-relevant fields: `price_cents`, `currency`, `pickup_time`, `pickup`, `pickup_identity`, `dropoff`, `dropoff_identity`, `service_context`, `ride_type`, `passengers`, `priced_amenities`. Any change increments `contract_version`, and any `issued` review record for that booking becomes `revoked` (trigger).

Operational fields (status, driver assignment, dispatch_status, notifications, audit, GPS, PIN) never bump `contract_version`.

Post-payment: snapshot is never rewritten. Use `booking_snapshot_corrections` or refund/rebook records.

## H. Review-Token Design

Raw token = 256-bit CSPRNG, base64url. Returned to passenger exactly once by `issue_booking_review_record`. Storage stores only `sha256(raw)` in `token_hash`. On acceptance the TanStack server function computes `sha256(raw)` and passes the hash to the RPC. HMAC removed — Postgres has no access to Lovable app secrets, and hash comparison alone (combined with `auth.uid()` ownership, status, expiry, and digest checks inside the RPC) provides authenticated single-use semantics.

Expiry: 15 minutes. Single-use enforced by `UPDATE ... WHERE status = 'issued' RETURNING`.

Privacy: `token_hash` is never exposed to the client. The authenticated role has `SELECT` on the table for client-side record presence, but the column must be filtered by server functions / RPCs.

## I. Snapshot Immutability & Correction

Trigger on `booking_policy_snapshots` rejects `UPDATE` and `DELETE` for every role including the `service_role` application path. Corrections append rows to `booking_snapshot_corrections` with a supersession chain. Retention/GDPR erasure only via separately owned `_maintenance_snapshot_tombstone(reason, actor)` that writes an audit record + cryptographic tombstone; never silent rewrite.

## J. Policy-Bundle Integrity

No cross-table `CHECK` constraints. Integrity from composite foreign keys `(policy_id, service_type)`. Approval, effective window, completeness, and stable canonical `content_hash` (sorted-key JSON, UTF-8 NFC, ISO-8601 timestamps) are validated in `admin_activate_policy_bundle`. Bundle digest is deterministic: `sha256(cancel.content_hash || '|' || no_show.content_hash || '|' || service_context)`. Test vectors published in migration tests.

## K. Legacy-Booking Resolution

Quarantine reason codes: `NO_PICKUP_COORDS`, `NO_DROPOFF_COORDS`, `NON_USD_CURRENCY`, `PRICE_MISSING`, `PRICE_INCONSISTENT`, `AMBIGUOUS_AIRPORT_MATCH`, `UNKNOWN_VEHICLE_TYPE`. Classifier writes `service_context = 'unresolved'` and `classifier_evidence` when it cannot decide — never defaults to `standard`. Admin resolves via `admin_resolve_unresolved_booking(_booking_id, _service_context, _price_cents, _currency, _reason)` which bumps `contract_version`, writes `_audit_write`, and records actor+reason. Authoritative price source is the existing `create_booking` RPC output; this plan does not assume any `suggested_price` field.

Existing pre-2D Stripe sessions are grandfathered (see F.5).

## L. RLS & GRANT Matrix Summary

- Every new table: `REVOKE ALL FROM anon`.
- `authenticated`: `SELECT` only on read-only or self-owned tables. No direct `INSERT/UPDATE/DELETE` on policy, snapshot, review, attempt, or gate tables.
- `service_role`: `ALL` on all new tables for edge/admin/maintenance paths.
- Every RPC: `REVOKE EXECUTE FROM PUBLIC, anon`; grant only to required roles.
- All functions: `SECURITY DEFINER SET search_path = public`.

## M. Deployment Sequence

1. **2A** migration + classifier + `airport_registry` seed. Backfill pass writes `unresolved` where ambiguous. Admin triages via `admin_resolve_unresolved_booking`.
2. **2B** migration. Author 4 policies (draft). Legal approves wording (blocking). Admin approves + creates both bundles. Do NOT activate until legal sign-off documented.
3. Activate both bundles atomically using `admin_activate_policy_bundle`.
4. Run `admin_activate_bundle_readiness(_environment)`; confirm `ready = true`.
5. **2C** migration + shadow review UI. `enforcement_mode = 'shadow'` on all records. Existing Stripe path unchanged; Pay button never blocked.
6. **2D** migration with `payment_gate_state.mode = 'shadow'` for all environments. Run shadow ≥ 72 hours. Verify zero unexplained `failed` attempts.
7. Execute pre-2D open-session reconciliation runbook: list all open Stripe sessions with `created < cutover_at`, decide per booking (expire / re-quote / refund), record decisions.
8. Set `cutover_at`, call `admin_activate_bundle_readiness(_environment)` again, then flip `production` gate to `enforce`.
9. Monitor 72 hours.

## N. Pre-2D Open-Session Reconciliation Runbook

Before setting `mode = 'enforce'` in production:

1. Query all `payment_attempts` with `state = 'session_created'` and `stripe_created_at < cutover_at`.
2. For each attempt, identify the booking, passenger, and current `contract_version`.
3. Classify:
   - `expire`: no passenger action, contract unchanged — call Stripe `sessions.expire` via TanStack server function.
   - `re_quote`: contract changed or unresolved — contact passenger, issue new review record, create new attempt.
   - `refund`: payment already completed but no accepted snapshot — refund via Stripe and record audit.
   - `grandfather`: already completed or in final state — leave untouched.
4. Record every decision in `_audit_write`.
5. Only after zero unresolved open sessions remain, set `cutover_at` and flip gate to `enforce`.

## O. Rollback Plan

- 2D: `mode = 'paused'` (never silently back to open). Tables retained.
- 2C: stop calling `accept_booking_policies` from UI; snapshots and review records retained.
- 2B: deactivate bundles; policies and bundles retained.
- 2A: leave columns; revert classifier if needed. Never drop populated columns.

## P. Business/Legal Decisions Required

1. Final wording of 4 policies (standard/airport × cancel/no-show).
2. Fee structure per policy.
3. Authoritative airport/FBO/private-airfield registry list + classification rule.
4. Legacy pre-gate booking policy (retro-accept / grandfathered / exempt).
5. Currency scope (USD-only at go-live?).
6. Approval authority (two-person rule?).
7. Pre-gate open-session treatment (expire vs re-quote vs refund).
8. IP/UA retention policy for snapshot acceptance.

## Q. Safe Before Legal Approval

- 2A migration + classifier + registry seed + admin resolution UI.
- 2B migration + bundle CRUD + approval workflow (bundles stay `draft`/`approved`, never `active`).
- 2C migration + shadow review UI recording shadow-mode records only.
- 2D migration + webhook lease + gate rows with `mode = 'shadow'`.

Blocked until legal approval: bundle `active` state, `mode = 'enforce'`, and any pre-gate session expiry.

## R. Tests & Acceptance Gates

Database:
- Composite-FK rejects mismatched `service_type`.
- Snapshot `UPDATE`/`DELETE` denied for every role.
- Contract-version bump revokes issued reviews.
- Concurrent bundle activation → exactly one winner.
- Webhook lease → single claimer under contention.
- Classifier defaults to `unresolved` for ambiguity.

Stripe sandbox:
- Idempotent attempt replay = one Session.
- Amount tampering → `failed`.
- Redelivery on `processed` = no-op.
- `sessions.expire` only touches open sessions.

UI:
- Shadow review renders server-provided bundle only.
- Checkbox default unchecked.
- Pay disabled until consent + non-expired non-revoked review in enforce mode.
- In shadow mode, Pay is never blocked by review state.

Gate:
- Unknown gate row → treated as `paused`.
- Enforce transition requires readiness RPC to return `ready = true`.

## S. Remaining Ambiguities

- Exact `priced_amenities` schema and field names that count as contract-relevant.
- Whether dropoff-airport bookings need distinct fee treatment vs pickup-airport.
- Retention window for `booking_review_records` beyond consumed snapshots.
- Whether admin-triggered `contract_version` bump should notify passenger with a re-review link automatically.
- IP/UA retention policy (deferred from 2C).

---

PLAN STATUS: REVISION 2.1 — CODEX CONDITIONS INCORPORATED
IMPLEMENTATION STATUS: BLOCKED — AWAITING BUSINESS AND LEGAL POLICY APPROVAL

No files changed. No migrations. No code changes. No policy activation. No deploy.