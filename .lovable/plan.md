# HarborLine Batch 2 — Revision 2.5 (Batch 2A Corrections Only)

Planning document. No implementation, no migrations, no code changes,
no deployment, no Stripe resource changes, no pull request. Revision
2.5 corrects only the remaining Batch 2A blockers surfaced by Codex's
Revision 2.4 review. Batches 2B (policy bundles), 2C (shadow review),
and 2D (enforcement) remain as previously specified and are not
re-opened here.

---

## A. Exact repository compatibility verification

Verified against HEAD of the current branch prior to writing this plan.

### A.1 `public.bookings` — existing columns (authoritative)

`id uuid NOT NULL`, `passenger_id uuid NOT NULL`, `driver_id uuid`,
`pickup text NOT NULL`, `dropoff text NOT NULL`,
`pickup_time timestamptz NOT NULL`, `passengers int NOT NULL`,
`ride_type <enum> NOT NULL`, `status <enum> NOT NULL`,
`price numeric`, `suggested_price numeric`, `distance_km numeric`,
`notes text`, `created_at timestamptz NOT NULL`,
`updated_at timestamptz NOT NULL`, `paid bool NOT NULL`,
`paid_at timestamptz`, `stripe_session_id text`, `receipt_url text`,
`pickup_lat/lng double precision`, `pickup_place_id text`,
`pickup_components jsonb`, `dropoff_lat/lng double precision`,
`dropoff_place_id text`, `dropoff_components jsonb`.

Batch 2A adds columns; it never redefines or drops existing columns.

### A.2 `public.booking_amenities` — existing columns (authoritative)

`id uuid NOT NULL`, `booking_id uuid NOT NULL`,
`amenity_option_id uuid NOT NULL`, `amenity_code text NOT NULL`,
`amenity_name text NOT NULL`, `quantity int NOT NULL`,
`price_delta_cents int NOT NULL`, `currency text NOT NULL`,
`complimentary bool NOT NULL`, `created_at timestamptz NOT NULL`.

`price_delta_cents` and `currency` are already the booking-time
snapshot fields written by `set_booking_amenities`. Revision 2.5
uses them as-is. The nonexistent `unit_price_cents_at_time` from
prior revisions is REMOVED from every 2A statement, encoding rule,
RPC body, fixture and test. If a future batch ever needs a distinct
"unit price at booking time" separate from the total delta, that will
be its own additive proposal — not 2A.

### A.3 Existing repository writers to `public.bookings`

Enumerated by `rg` on HEAD; used as the mutation matrix in section D.

- `create_booking` RPC (single insert, initial contract).
- `set_booking_amenities` RPC (currently mutates only child rows via
  the current implementation; 2A extends it — see F).
- `advance_assignment` RPC (updates `status` on assignment transitions).
- `trust.functions.ts` cancellation path
  (`booking_assignments.dispatch_status = 'cancelled'`;
  updates `bookings.status` transitively via RPC).
- `integrations.functions.ts › adminRefundBooking` — writes
  `bookings.status = 'cancelled'` via `supabaseAdmin`.
- `api/public/payments/webhook.ts › handleCheckoutCompleted` — writes
  `paid`, `paid_at`, `stripe_session_id`, and legacy `price` via
  service role.
- Admin trip / customer / operations screens — read-only against
  `bookings`.
- Passenger `history.tsx`, `admin.trips.$id.tsx` — read-only.

No other repository path writes `public.bookings`. Any future writer
must be added to the matrix in section D before Stage 2A-3 executes.

---

## B. Corrected data model (Batch 2A)

### B.1 `public.bookings` — additive columns only

| Column                        | Type          | Null | Default | Notes |
|-------------------------------|---------------|------|---------|-------|
| `service_context`             | text          | NO   | `'unresolved'` | CHECK IN `('standard','airport','unresolved')` |
| `base_price_cents`            | bigint        | YES  | NULL    | Booking-time base fare (no amenities). |
| `amenities_total_cents`       | bigint        | YES  | NULL    | Sum of `price_delta_cents * quantity` where NOT complimentary. |
| `total_price_cents`           | bigint        | YES  | NULL    | `base_price_cents + amenities_total_cents`. |
| `currency`                    | text          | YES  | NULL    | Lowercased ISO-4217, three letters. Same across booking + amenities. |
| `contract_version`            | int           | NO   | `0`     | Monotonic. Incremented only by material writes (see D). |
| `content_digest`              | bytea         | YES  | NULL    | 32-byte SHA-256 of canonical content (see E). |
| `classifier_material_digest`  | bytea         | YES  | NULL    | 32-byte SHA-256 of classifier projection (see F). |
| `contract_state`              | text          | NO   | `'draft'` | CHECK IN `('draft','ready','quarantined')`. |
| `content_finalized_at`        | timestamptz   | YES  | NULL    | Set the first time `contract_state='ready'`. |
| `contract_notes`              | text          | YES  | NULL    | Free-text operator note (non-material). |

All new numeric monetary fields are `bigint` in cents. `numeric`
`price` and `suggested_price` remain untouched during 2A-1 and 2A-2
and are retired only after Batch 2D confirms zero readers (out of
scope for 2A).

### B.2 Authoritative quarantine model (single source of truth)

Two new tables. `bookings.quarantine_reasons text[]` is NEVER
introduced.

```
public.booking_quarantine_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  opened_by         uuid,                       -- auth.users.id or NULL for system
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolution_notes  text,
  UNIQUE (booking_id) WHERE resolved_at IS NULL -- at most one OPEN case per booking
);

public.booking_quarantine_reasons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES public.booking_quarantine_cases(id) ON DELETE RESTRICT,
  reason_code    text NOT NULL,   -- enum-like: 'legacy_no_currency','legacy_no_price',
                                  -- 'service_context_unresolved','digest_mismatch',
                                  -- 'amenity_duplicate','currency_mismatch','manual_hold'
  reason_detail  jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid,
  UNIQUE (case_id, reason_code) WHERE resolved_at IS NULL
);
```

Ownership: `postgres`. Grants: `authenticated` gets no direct DML;
all writes flow through SECURITY DEFINER RPCs listed in section C.
`service_role` gets `ALL`. `anon` gets nothing. RLS enabled with
policies that only permit `SELECT` to `authenticated` on rows tied
to their own `bookings.passenger_id`, and to `has_role(auth.uid(),
'admin')` for full visibility.

Concurrency: every quarantine mutation acquires
`SELECT ... FROM public.bookings WHERE id = _booking_id FOR UPDATE`
before touching cases/reasons. A case is closed only when every
attached reason has `resolved_at IS NOT NULL`, in the same
transaction, and simultaneously flips `bookings.contract_state`.

Derived summaries: no cached array is exposed on `bookings`. A view
`public.booking_quarantine_summary` (SECURITY INVOKER) exposes
`booking_id, open_reason_codes text[], opened_at, oldest_reason_at`
for admin UI; it is derived, not authoritative, and never written.

### B.3 Amenity global uniqueness

`CREATE UNIQUE INDEX CONCURRENTLY booking_amenities_booking_option_uniq
ON public.booking_amenities (booking_id, amenity_option_id);`

Executed in Stage 2A-3 only, from a non-transactional deployment
mechanism (see G.4). Creation is gated by section F.3's zero-duplicate
SQL check across ALL bookings — including quarantined ones.

---

## C. Authoritative quarantine lifecycle (RPCs)

All SECURITY DEFINER, `SET search_path = public, pg_temp`, owned by
`postgres`. `REVOKE ALL FROM public`. `GRANT EXECUTE TO` roles named.

1. `open_quarantine_case(_booking_id uuid, _reason text, _detail jsonb)`
   → `uuid` (case_id).
   Grants: `service_role`, `authenticated` restricted internally to
   admin via `has_role(auth.uid(),'admin')` OR called from other
   SECURITY DEFINER RPCs (system origin). Acquires row lock on
   `bookings`. Sets `contract_state='quarantined'`. Writes
   `audit_log`.

2. `add_quarantine_reason(_case_id uuid, _reason text, _detail jsonb)`
   → `uuid`. Same auth. Fails if case already resolved. Writes audit.

3. `resolve_quarantine_reason(_reason_id uuid, _notes text)` → `void`.
   Admin only. If it was the last open reason on the case,
   auto-closes the case AND recomputes `contract_state` (see D).

4. `admin_resolve_quarantine_case(_case_id uuid, _notes text)` → `void`.
   Admin only. Closes all remaining open reasons atomically with
   provided notes, closes case, recomputes state.

5. `system_open_quarantine(_booking_id uuid, _reasons jsonb[])` →
   `uuid`. Only callable from other SECURITY DEFINER RPCs
   (`REVOKE EXECUTE FROM authenticated`). Used by backfill and by
   `set_booking_amenities` when normalization refuses to finalize.

Every mutation writes an immutable row to `public.audit_log` via the
existing `_audit_write` helper, capturing `booking_id, case_id,
reason_code, action, actor, before, after`.

---

## D. Booking mutation and trigger matrix

`public.bookings_material_guard` is a `BEFORE UPDATE` trigger installed
in Stage 2A-3. It classifies each UPDATE by comparing OLD vs NEW.

Material fields (bump `contract_version` +1 and force recompute of
`content_digest` and `classifier_material_digest` in the same
statement):
`pickup, dropoff, pickup_time, passengers, ride_type,
pickup_lat, pickup_lng, pickup_place_id, pickup_components,
dropoff_lat, dropoff_lng, dropoff_place_id, dropoff_components,
service_context, base_price_cents, amenities_total_cents,
total_price_cents, currency`.

Non-material fields (never bump version, never touch digests):
`status, driver_id, paid, paid_at, stripe_session_id, receipt_url,
notes, contract_notes, updated_at, contract_state,
content_finalized_at`.

Rule set enforced by the trigger:

| Writer                                       | Fields touched                                    | Role                | Class        | Version bump? | Digest recomputed? | Trigger verdict |
|----------------------------------------------|---------------------------------------------------|---------------------|--------------|---------------|--------------------|-----------------|
| `create_booking` (INSERT)                    | all initial                                       | authenticated       | N/A          | starts at 0   | computed on insert | allowed         |
| `set_booking_amenities` (extended, F)        | `amenities_total_cents, total_price_cents, contract_version, content_digest, classifier_material_digest, base_price_cents?, currency?, contract_state, content_finalized_at` | authenticated | material via SECURITY DEFINER | +1 in RPC | recomputed in RPC | allowed (RPC computes both) |
| `advance_assignment`                         | `status`                                          | authenticated       | non-material | no            | no                 | allowed         |
| `trust.functions.ts` cancellation            | `status`                                          | authenticated       | non-material | no            | no                 | allowed         |
| `integrations.functions.ts › adminRefundBooking` | `status='cancelled'`                          | service_role        | non-material | no            | no                 | allowed         |
| `api/public/payments/webhook.ts`             | `paid, paid_at, stripe_session_id, price` (legacy numeric) | service_role | non-material (see D.1) | no | no | allowed |
| Any admin ops screen writing material fields | material                                          | admin (SECURITY DEFINER only) | material | RPC-driven | RPC-driven | RPC path only |
| Direct client UPDATE from browser            | anything                                          | authenticated       | any          | -             | -                  | REJECTED by RLS + trigger |

D.1 Webhook `price` compatibility: the webhook still writes the legacy
`numeric price` column. `bookings_material_guard` explicitly excludes
`price` and `suggested_price` from the material set for the duration
of 2A (they are legacy; retirement is out of 2A scope). Webhook writes
therefore pass without a version bump.

D.2 No bypass flag. The trigger's classification is purely
field-based. There is no `SET LOCAL app.bypass_material_guard`,
no session GUC, and no privileged escape. Material writes MUST arrive
already carrying the new `contract_version` and both digests computed
by the RPC (`set_booking_amenities` or a future explicit
`admin_amend_booking`); the trigger verifies that on material updates
`NEW.contract_version = OLD.contract_version + 1` AND
`NEW.content_digest = digest_expected_for(NEW)` AND
`NEW.classifier_material_digest = classifier_digest_expected_for(NEW)`.
If either check fails, the UPDATE is rejected with
`bookings_material_guard_violation`.

D.3 Recompute helper: `bookings_compute_digests(_booking_id uuid,
OUT content_digest bytea, OUT classifier_material_digest bytea)` —
SECURITY DEFINER, pure, deterministic; used by RPCs and by the
trigger's expected-value check. It reads the booking row + all
`booking_amenities` rows for that booking in a single snapshot and
emits both digests per section E.

---

## E. Exact digest encoding and literal fixtures

### E.1 Canonical binary encoding (database-authoritative)

The database function `bookings_canonical_content(_booking_id uuid)
RETURNS bytea` is the single authoritative encoder. It:

1. Reads the booking row + all `booking_amenities` for that booking.
2. Builds a JSONB object with keys, in JCS (RFC 8785) order,
   equivalent to:
   ```
   {
     "v": "harborline.booking.v1",
     "ride_type": <ride_type::text>,
     "passengers": <passengers::int>,
     "pickup_time": <pickup_time in RFC 3339 UTC ("Z"), millisecond precision stripped, seconds mandatory>,
     "pickup": {
       "text":         normalize_nfc(pickup),
       "place_id":     pickup_place_id or null,
       "lat":          round(pickup_lat * 1e6)::bigint or null,   -- micro-degrees, integer
       "lng":          round(pickup_lng * 1e6)::bigint or null,
       "components":   canonical_components(pickup_components)
     },
     "dropoff": { ... same shape ... },
     "service_context": <service_context::text>,
     "base_price_cents": <bigint or null>,
     "currency": lower(<currency>) or null,
     "amenities": [
       { "amenity_option_id": <uuid text>,
         "quantity":          <int>,
         "price_delta_cents": <int>,
         "complimentary":     <bool>,
         "currency":          lower(<currency>) }
       ...
     ]  -- deduplicated + sorted by amenity_option_id ascending
   }
   ```
3. `canonical_components(jsonb)` retains only these repository keys,
   in this order (JCS sorts alphabetically): `admin_area_level_1,
   admin_area_level_2, country, country_code, locality, postal_code,
   route, street_number, subpremise`. Missing keys are OMITTED (not
   nulled). Unknown keys are dropped and simultaneously logged to
   `audit_log` at INFO for observability; they never affect the
   digest. No existing repository component key is silently dropped —
   the whitelist above matches the exact keys the client currently
   submits (verified against `src/lib/dispatch.functions.ts` component
   schema and `src/components/booking/AddressAutocomplete.tsx`).
4. `normalize_nfc` applies Unicode NFC.
5. Output: UTF-8 bytes of the JCS-serialized JSON (sorted keys,
   no whitespace, minimal-JSON number encoding — integers only, no
   floats; monetary values are already integer cents; coordinates are
   integer micro-degrees).

`bookings_compute_digests` returns
`sha256(bookings_canonical_content(id))` for `content_digest` and
`sha256(bookings_canonical_classifier(id))` for
`classifier_material_digest`.

### E.2 Independent reference encoder (external fixture source)

The Python reference encoder used to generate the fixtures below is
pinned in `docs/batch-2a/reference_encoder.py` (added in the Batch 2A
implementation PR, NOT in this planning turn). It implements the same
JCS rules using only the Python standard library, and does NOT share
code with the PostgreSQL implementation. The Stage 2A-3 test suite
compares the PostgreSQL output byte-for-byte against pinned constants
below; PostgreSQL is NEVER used to generate its own expected values.

### E.3 Literal fixtures (SHA-256, lowercase hex, 64 chars)

Address hashes (input = canonical address projection JCS bytes,
`SHA-256`):

- `pickup_v1` canonical:
  `{"components":{},"lat":null,"lng":null,"place_id":null,"text":"JFK Terminal 4 Arrivals"}`
  → `6223caf0af6553fdf6b6df72036d8d7055cc0c233c3d3e96c6b36f447556112d`
- `dropoff_v1` canonical:
  `{"components":{},"lat":null,"lng":null,"place_id":null,"text":"The Ritz-Carlton New York, NoMad"}`
  → `a8cf44190af998a707d3d0767381ffbb6634f32a8f6e603e83bcff1f4d563569`
- `pickup_v3` canonical (place_id + full components):
  → `d12b01a617a2affc13eb993c56c745fd1e7e14164ce99cd30d336ae8529b98d7`
- `dropoff_v3` canonical (place_id + full components):
  → `e78bfd5c244464662aafa2dcf33719b8f0458ba26850018256444a636e018104`

Content digests (`content_digest`, SHA-256 of full canonical content):

- V1 — escalade, 2 pax, airport, base 25000 usd, no amenities,
  pickup_v1 → dropoff_v1, pickup_time `2026-08-01T14:00:00Z`:
  `3a5f2d536ca1a6d8fd5f97cb198ae25795718dffe595a6f5e19594ac79b87a7d`
- V2 — suburban, 4 pax, airport, base 22000 usd, two amenities
  (`11111111-…` qty 1 delta 1500 non-comp, `22222222-…` qty 2 delta 0
  complimentary), pickup_v1 → dropoff_v1,
  pickup_time `2026-09-15T09:30:00Z`:
  `d6ffd670fb2b578d3ca6f54e149ea60fddb6bdd97b2d4a4e37381edee298d02c`
- V3 — denali, 3 pax, standard, base 18000 usd, one amenity
  (`33333333-…` qty 1 delta 2500 non-comp), pickup_v3 → dropoff_v3,
  pickup_time `2026-10-05T18:45:00Z`:
  `9b58a80fda68350f590cdf4bef3ee68a64b1cd2588feb7fc303527455744302d`

Classifier material digests (`classifier_material_digest`):

Canonical projection:
```
{"v":"harborline.classifier.v1",
 "ride_type":..., "service_context":...,
 "pickup_place_id":..., "dropoff_place_id":...,
 "pickup_country_code":..., "dropoff_country_code":...}
```

- C1 (matches V1: escalade/airport, no place_ids/countries):
  `87881b7ae8fa319b3d55c4e8044c03d528a3f0472433ce0e71561b895ddeb04e`
- C2 (matches V2: suburban/airport, no place_ids/countries):
  `4326180d7cbfda1042101dd241d915aa2a168759967f6a02404a5bdb943cc855`
- C3 (matches V3: denali/standard, full place_ids + country US/US):
  `8709fb908cefcedd7dc19ddbdea26ca2c72d8fbc3de6c4d574455065baf2a517`

`classifier_material_digest` self-reference is FORBIDDEN: the
projection contains only classifier inputs; it never includes
`contract_version`, `content_digest`, monetary fields, or timestamps.

---

## F. Amenity normalization and duplicate resolution

### F.1 Field usage

Encoding, RPC logic, fixtures and tests all use the existing
`booking_amenities.price_delta_cents`, `quantity`, `currency`, and
`complimentary` columns. No new amenity column is added in Batch 2A.

### F.2 Extended `set_booking_amenities`

Replacement semantics (idempotent under repeat calls with the same
canonical set):

1. `SELECT ... FROM public.bookings WHERE id = _booking_id FOR UPDATE`.
2. Reject if `contract_state = 'quarantined'` unless reason is
   `amenity_duplicate` and the new set resolves it.
3. Canonicalize `_amenity_option_ids uuid[]`: dedupe and sort ascending.
4. `DELETE FROM booking_amenities WHERE booking_id = _booking_id`.
5. `INSERT` one row per canonical id, snapshotting name/code/price/
   currency/complimentary from `amenity_options` at now().
6. If `bookings.base_price_cents` or `bookings.currency` are NULL and
   the booking has a resolvable base fare (from `ride_type` and 2A
   pricing table, unchanged from Batch 1) — populate them in this
   transaction. Otherwise leave the booking `draft` and system-open
   quarantine reason `legacy_no_price` or `legacy_no_currency`.
7. Recompute `amenities_total_cents` and `total_price_cents`.
8. Recompute both digests via `bookings_compute_digests`.
9. `UPDATE bookings SET contract_version = contract_version + 1,
    content_digest = ..., classifier_material_digest = ...,
    amenities_total_cents = ..., total_price_cents = ...,
    base_price_cents = COALESCE(base_price_cents, resolved_base),
    currency = COALESCE(currency, 'usd'),
    contract_state = CASE WHEN eligible THEN 'ready' ELSE 'draft' END,
    content_finalized_at = COALESCE(content_finalized_at,
      CASE WHEN eligible THEN now() END)
    WHERE id = _booking_id;`
10. Commit. All steps run in ONE transaction under ONE row lock.

Currency mismatch (any amenity currency differs from booking currency
after step 6) opens quarantine reason `currency_mismatch` and forces
`contract_state='quarantined'` before commit.

### F.3 Duplicate resolution and zero-duplicate gate

Physical duplicates exist iff:
```
SELECT booking_id, amenity_option_id, COUNT(*)
FROM public.booking_amenities
GROUP BY 1, 2
HAVING COUNT(*) > 1;
```

Resolution policy (deterministic, admin-authorized):

- Stage 2A-2 backfill enumerates every duplicate group and opens a
  `booking_quarantine_cases` case per affected booking with reason
  `amenity_duplicate` and `reason_detail` recording every row id,
  quantity, price_delta_cents, currency, complimentary, created_at of
  the duplicate group. No row is deleted.
- Admin resolves via `admin_resolve_amenity_duplicates(_booking_id
  uuid, _keep jsonb, _merge_rule text)`:
  - `_merge_rule = 'keep_first'` retains the earliest `created_at`
    row and deletes the others.
  - `_merge_rule = 'sum_quantities'` retains one row whose `quantity`
    is the sum of the group, `price_delta_cents` is the group's
    `MIN(price_delta_cents)` (defensive floor), `complimentary` is
    `bool_and(complimentary)`, `currency` is required to match.
  - `_keep` is an explicit `{"amenity_option_id": "<retained id>"}`
    map; the RPC rejects if `_keep` is inconsistent with the group.
  - Every consolidation writes an `audit_log` entry with the full
    before/after snapshot, actor, and merge rule.
- After each resolution, the RPC re-runs the extended
  `set_booking_amenities` normalization for the booking.

Zero-duplicate SQL gate (executed IMMEDIATELY before Stage 2A-3
attempts the unique index):
```
SELECT NOT EXISTS (
  SELECT 1 FROM public.booking_amenities
  GROUP BY booking_id, amenity_option_id
  HAVING COUNT(*) > 1
);
```
If it returns `false`, Stage 2A-3 aborts and rolls back to Stage 2A-2.

---

## G. Deployment and RPC cutover sequence

### G.1 Stages

Stage 2A-1 (additive):
- Add columns from B.1 with defaults.
- Create tables from B.2 with RLS + grants.
- Deploy new SECURITY DEFINER RPCs (quarantine lifecycle in C, extended
  `set_booking_amenities` under new name — see G.3).
- Deploy `bookings_canonical_content`, `bookings_canonical_classifier`,
  `bookings_compute_digests`.
- Do NOT install `bookings_material_guard`.
- Do NOT create the unique index.
- Do NOT flip any application call site.

Stage 2A-2 (backfill):
- Batch job (SECURITY DEFINER function `backfill_bookings_2a(_limit int)`)
  fills `base_price_cents`, `currency`, `service_context`,
  `contract_version`, both digests, `contract_state` per booking:
  - Prefer `price` over `suggested_price`. If both null → open
    `legacy_no_price` and leave `contract_state='quarantined'`.
  - Currency defaults to `'usd'` and opens `legacy_no_currency` for
    audit if inferred by default.
  - `service_context` runs the classifier; if inputs are insufficient,
    leaves `'unresolved'` and opens
    `service_context_unresolved`.
  - Every duplicate group opens `amenity_duplicate` per F.3.
- Idempotent, resumable, respects a `_limit`; a monitoring RPC
  `backfill_bookings_2a_status()` reports counts by
  `contract_state`.

Stage 2A-3 (trigger + unique index + guard activation):
- Verify zero-duplicate gate (F.3).
- Verify no unpaid `draft` bookings remain (see H).
- `CREATE UNIQUE INDEX CONCURRENTLY` per G.4.
- Install `bookings_material_guard` BEFORE UPDATE trigger.
- Flip application call sites (G.3).
- Activate the checkout server guard.

### G.2 Explicit rollback per stage — see section I.

### G.3 RPC cutover — one strategy, unambiguous

Chosen strategy: **versioned parallel deployment during 2A-1/2A-2,
compatible replacement at Stage 2A-3**.

- Stage 2A-1 introduces `set_booking_amenities_v2(_booking_id uuid,
  _amenity_option_ids uuid[])`. The original
  `set_booking_amenities(_booking_id, _amenity_ids)` is UNCHANGED and
  keeps running. Both RPCs write the same child rows; v2 additionally
  performs contract normalization on the parent.
- No application call site is switched during 2A-1 or 2A-2.
- At Stage 2A-3, the application call site
  `src/lib/amenities.functions.ts › setBookingAmenities` is switched
  atomically to `set_booking_amenities_v2` in the same deployment as
  trigger install and checkout-guard activation.
- After 2A-3 has been stable for at least 7 days,
  `set_booking_amenities` (v1) is renamed to
  `set_booking_amenities_v1_deprecated` and `REVOKE EXECUTE FROM
  authenticated`. Removal is deferred to a later batch.
- There is NO period during which both call sites are live in the
  browser: the client always calls exactly one RPC name. The parallel
  deployment is DB-side only, so mid-deployment browser sessions on
  the previous JS bundle continue to call v1 and succeed.

Grants (v2): `REVOKE ALL FROM public`, `GRANT EXECUTE TO
authenticated`. Quarantine RPCs from section C: `GRANT EXECUTE TO
authenticated` gated internally by `has_role`. `system_open_quarantine`
and `backfill_bookings_2a`: `REVOKE EXECUTE FROM authenticated`,
`GRANT EXECUTE TO service_role`.

### G.4 Concurrent unique-index execution

`CREATE UNIQUE INDEX CONCURRENTLY booking_amenities_booking_option_uniq
ON public.booking_amenities (booking_id, amenity_option_id);` MUST NOT
be placed inside a normal Supabase transactional migration file.
Execution mechanism:

1. A dedicated non-transactional deployment step (Supabase SQL
   editor operator runbook, or `psql --single-transaction=off`
   invoked from the deployment runbook) executes the statement.
2. If the statement fails, Postgres marks the index `INVALID`. The
   runbook's failure handler runs `DROP INDEX CONCURRENTLY IF EXISTS
   booking_amenities_booking_option_uniq;` and re-runs the
   zero-duplicate gate before retrying. Max 3 retries; after that
   Stage 2A-3 aborts and the runbook falls back to Stage 2A-2.
3. Verification query after creation:
   ```
   SELECT indexrelid::regclass, indisvalid, indisunique
   FROM pg_index
   WHERE indexrelid = 'public.booking_amenities_booking_option_uniq'::regclass;
   ```
   Must return `indisvalid = true AND indisunique = true`.
4. Only after verification does the runbook install the material
   guard trigger and activate the checkout guard.

---

## H. Checkout activation gates

The Stage 2A-3 checkout server guard is activated only when ALL of
the following pass:

H.1 `SELECT count(*) FROM public.bookings
     WHERE paid = false AND contract_state = 'draft';`
returns `0`. Draft unpaid bookings are unexplained — they block
activation.

H.2 Quarantined unpaid bookings are ALLOWED to exist. They do NOT
block activation, because quarantine is an intentional non-ready
state.

H.3 Every quarantined booking has at least one open, authoritative
reason:
```
SELECT count(*) FROM public.bookings b
LEFT JOIN public.booking_quarantine_cases c
  ON c.booking_id = b.id AND c.resolved_at IS NULL
LEFT JOIN public.booking_quarantine_reasons r
  ON r.case_id = c.id AND r.resolved_at IS NULL
WHERE b.contract_state = 'quarantined'
GROUP BY b.id
HAVING count(r.id) = 0;
```
must return `0` rows. Any quarantined booking without an open reason
blocks activation and is treated as data corruption.

H.4 The unique index verification query from G.4 returns
`indisvalid = true`.

H.5 The material guard trigger is installed and `tgenabled='O'`.

Once activated, the checkout server guard in
`src/lib/payments.functions.ts › createBookingCheckout` rejects every
booking whose `contract_state` is NOT `'ready'`. Draft bookings and
quarantined bookings are rejected individually with distinct error
codes (`booking_not_ready_draft`, `booking_not_ready_quarantined`).
Quarantined bookings never checkout even after activation; the guard
returns actionable error text pointing at the open reason codes.

---

## I. Evidence-preserving rollback

I.1 Stage 2A-1 rollback:
- Before any production row has been written to the new columns or
  new tables: full DROP of new tables, columns, RPCs, and helper
  functions is permitted.
- Once any production row exists with a non-default value in
  `base_price_cents`, `amenities_total_cents`, `total_price_cents`,
  `contract_version > 0`, `content_digest`, `classifier_material_digest`,
  `contract_state <> 'draft'`, `content_finalized_at`, OR any row
  exists in `booking_quarantine_cases` /
  `booking_quarantine_reasons` / a Batch 2A `audit_log` action —
  Stage 2A-1 rollback is ADDITIVE ONLY:
  - Drop the new RPCs and helpers (application call sites already
    pinned to v1 during 2A-1/2A-2, so removal is safe).
  - Leave every new column and every new table in place with their
    stored values.
  - Leave `audit_log` entries in place.
  - Rollback is complete when the browser no longer references v2.
  Destructive drops of evidence columns or tables are permitted ONLY
  in a preview environment that has never held production evidence.

I.2 Stage 2A-2 rollback: pause the backfill job. Do NOT clear
`contract_version`, digests, or quarantine cases already written.
Restart is idempotent.

I.3 Stage 2A-3 rollback:
- `DROP TRIGGER bookings_material_guard ON public.bookings;`
- Flip the application call site back to `set_booking_amenities` (v1).
- Leave the unique index in place UNLESS a specific breakage
  attributable to it is observed; in that case `DROP INDEX
  CONCURRENTLY` and re-run the zero-duplicate gate before re-attempt.
- Never drop `contract_version`, digests, `contract_state`,
  quarantine tables, or audit rows.

I.4 Feature-flagged checkout guard: activation is behind a
per-environment gate row `payments.gate_state text` in a new
`system_flags` table (single row, admin only). `paused | shadow |
enforce`. Rollback flips to `paused`. Historical evidence is
preserved.

---

## J. Tests and acceptance criteria

J.1 Repository compatibility
- Assert `information_schema.columns` for `booking_amenities` matches
  section A.2 exactly.
- Assert no migration file references `unit_price_cents_at_time`.

J.2 Digest fixtures
- V1 / V2 / V3 canonical bytes match the JCS strings in E.
- SHA-256 of each equals the literal fixture in E.3.
- Address hashes for `pickup_v1, dropoff_v1, pickup_v3, dropoff_v3`
  match E.3.
- Classifier hashes C1 / C2 / C3 match E.3.
- Python reference encoder in `docs/batch-2a/reference_encoder.py`
  produces byte-identical output to `bookings_canonical_content` on
  the seeded fixtures — assertion runs in CI against pinned constants,
  not against the DB function's live output.

J.3 Address-key mapping
- A booking with `pickup_components` containing every current
  repository key (`street_number, route, subpremise, locality,
  admin_area_level_1, admin_area_level_2, country, country_code,
  postal_code`) round-trips through canonicalization with zero keys
  dropped, and its digest matches an externally precomputed fixture.

J.4 Duplicates block the index
- Seed a duplicate `(booking_id, amenity_option_id)` group and assert
  `CREATE UNIQUE INDEX CONCURRENTLY ...` fails; the failure handler
  drops the invalid index and the zero-duplicate gate returns `false`.

J.5 Quarantined rows do not block activation
- Seed a booking with `contract_state='quarantined'` and an open
  reason; the H.1 draft count is `0`; H.3 returns `0`; activation
  succeeds.

J.6 Draft rows block activation
- Seed one unpaid `contract_state='draft'` booking; assert activation
  runbook aborts with `unexplained_draft_bookings`.

J.7 Quarantined rows always have an open reason
- After Stage 2A-2, run H.3; must return `0`. A synthetic corrupted
  booking (quarantined with no open reason) must be caught by H.3
  and block activation.

J.8 Existing mutation paths keep working
- `advance_assignment`, `trust.functions.ts` cancellation,
  `adminRefundBooking`, and the Stripe webhook path all UPDATE
  `bookings` under the material guard without version bumps and
  without digest recomputation. Regression tests exercise each.

J.9 Material writes bump exactly once
- Calling `set_booking_amenities_v2` with the same canonical set is
  idempotent: it recomputes digests but rejects committing a
  no-op version bump (guard: if new digests == old digests, do NOT
  increment `contract_version`).
- Changing amenities increments version by exactly 1 and produces a
  new digest matching a precomputed fixture.

J.10 Non-material writes do neither
- Webhook writes to `paid, paid_at, stripe_session_id, price` leave
  `contract_version, content_digest, classifier_material_digest,
  base_price_cents, amenities_total_cents, total_price_cents,
  currency` unchanged. Trigger passes.

J.11 Webhook preserves normalized fields
- After a Stripe checkout completion event on a `ready` booking, the
  above invariant is asserted end-to-end in a Stripe sandbox test.

J.12 RPC cutover works under mixed-version deployment
- With v1 and v2 both callable, calls to either succeed. After the
  Stage 2A-3 flip, all client calls go to v2; a synthetic call to v1
  still succeeds (until 7-day deprecation window elapses).

J.13 Production rollback preserves evidence
- Simulated rollback of Stage 2A-3 leaves every new column, table,
  and audit row intact. Assert via row counts before/after.

---

## K. Exact future implementation file scope (Batch 2A)

Migrations (three files, one per stage):
- `supabase/migrations/<ts>_2a1_bookings_contract_additive.sql`
- `supabase/migrations/<ts>_2a2_bookings_contract_backfill.sql`
- `supabase/migrations/<ts>_2a3_bookings_contract_guard.sql` (calls
  out that the CREATE UNIQUE INDEX CONCURRENTLY step is executed
  OUT OF BAND per G.4; the file itself contains only the trigger
  install and guard activation)

Application code:
- `src/lib/amenities.functions.ts` — extend `setBookingAmenities` to
  call `set_booking_amenities_v2` at Stage 2A-3 flip.
- `src/lib/payments.functions.ts › createBookingCheckout` — add the
  `contract_state` guard behind the `system_flags.payments.gate_state`
  read.

Reference and docs (planning-adjacent, not executed this turn):
- `docs/batch-2a/reference_encoder.py`
- `docs/batch-2a/fixtures.json`
- `docs/batch-2a/runbook-stage-2a3.md`

No changes to Stripe resources, no changes to `create_booking`, no
changes to the webhook code path.

---

## L. Deferred items

- Policy bundle resolvers (Batch 2B).
- Immutable snapshot + shadow review (Batch 2C).
- Payment gate `enforce` state cutover (Batch 2D).
- Retirement of legacy `bookings.price` and `bookings.suggested_price`
  (post-2D).
- `distance_km` and distance-based pricing.
- IP / UA capture on review records (pending legal retention decision).
- Merging `create_booking` and amenity mutation into a single RPC.
- Any Stripe Connect / live-key work.

---

## M. Plan status

PLAN STATUS: REVISION 2.5 — REMAINING BATCH 2A BLOCKERS CORRECTED

IMPLEMENTATION STATUS: BLOCKED — AWAITING CODEX REVIEW

No code, migration, Stripe, pull request, or deployment changes.
