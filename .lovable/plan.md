# HarborLine Batch 2 — Revision 2.6 (Batch 2A Corrections Only)

Planning document. No implementation, no migrations, no code changes,
no deployment, no Stripe resource changes, no pull request. Revision
2.6 supersedes 2.5 and resolves the ten final Codex blockers listed
below. Scope remains restricted to Batch 2A (contract normalization,
amenity mutation, quarantine model, checkout eligibility gate).

Batches 2B / 2C / 2D remain out of scope until 2A ships.

---

## 0. Authoritative correction ledger (Revision 2.6 delta over 2.5)

| # | Codex blocker (2.5)                                              | Section |
|---|------------------------------------------------------------------|---------|
| 1 | GUC/session marker forgery, child-DML lockdown                   | G, H    |
| 2 | Paid `base_price_cents` must derive from Stripe line items       | K       |
| 3 | Checkout gate = `contract_state='ready'` AND no blocking reason  | L       |
| 4 | Preserve case identity + lifecycle across three tables           | J       |
| 5 | Split additive schema → backfill → validation → constraints      | M       |
| 6 | Correct `COUNT(*)` and other SQL syntax                          | all     |
| 7 | Canonical serializer must be fixed-schema, pure, side-effect free| E       |
| 8 | Complete UTF-8 material strings + full SHA-256 for every fixture | F       |
| 9 | v1 wrapper must delegate to v2, no independent child writes      | I       |
| 10| Preserve amenity snapshots for unchanged IDs (added/removed only)| I       |

---

## A. Scope, invariants, and non-goals

### A.1 Monetary invariant (unchanged from 2.5)

For every row in `public.bookings` with `contract_state = 'ready'`:

```
total_price_cents = base_price_cents + amenities_total_cents
amenities_total_cents = SUM(booking_amenities.price_delta_cents * quantity)  -- (see A.4)
```

All three columns are `bigint NOT NULL` **after** stage M-3 (`SET NOT NULL`
constraint stage). Currency is `currency CHAR(3) NOT NULL` (ISO 4217, uppercase).

### A.2 Column additions to `public.bookings`

Added nullable in stage M-1:

- `base_price_cents        bigint`
- `amenities_total_cents   bigint`
- `total_price_cents       bigint`
- `contract_version        integer`   -- monotonically increasing per booking
- `contract_state          public.booking_contract_state` (enum: `draft`, `ready`, `quarantined`)
- `content_digest          bytea`     -- 32 bytes, SHA-256 over canonical material
- `content_digest_algo     text`      -- literal `'HLBC2A-1'`
- `pricing_evidence        jsonb`     -- Stripe line items / rule engine trace, immutable

Deprecated but retained: `public.bookings.price` (numeric legacy column) —
read-only from application code after M-2; kept for backfill audit and never
overwritten. Section K defines the reconciliation strategy.

### A.3 Enum

```sql
CREATE TYPE public.booking_contract_state AS ENUM ('draft','ready','quarantined');
```

### A.4 Amenity totalization (repository-verified)

`public.booking_amenities` columns used:

- `booking_id           uuid NOT NULL`
- `amenity_option_id    uuid NOT NULL`
- `price_delta_cents    integer NOT NULL`   -- authoritative unit cost
- `quantity             integer NOT NULL DEFAULT 1`
- `snapshot_name        text`
- `snapshot_description text`
- `currency             char(3)`

`amenities_total_cents` is defined as
`SUM(price_delta_cents * GREATEST(quantity,1))` over the booking's rows.
`price_delta_cents` is the **only** monetary source for amenity totals;
no other column may be introduced or referenced.

### A.5 Non-goals

- No Stripe API mutations.
- No changes to `payment_attempts` (Batch 2D).
- No PII changes.
- No writes from application code to `public.bookings.price`.

---

## B. Repository-verified field mapping (unchanged from 2.5)

- `bookings.distance_km` (numeric, kilometers) exists. Scaled to
  `distance_km_x1000` = `ROUND(distance_km * 1000)::bigint` inside the
  canonical encoder.
- `bookings.scheduled_at` is `timestamptz`. Canonical encoding uses UTC
  ISO-8601 with `Z` suffix (`YYYY-MM-DDTHH:MM:SSZ`), truncated to whole
  seconds.
- `bookings.dispatch_status` lives on `booking_assignments`, not
  `bookings`. It is not part of the pricing contract and is excluded
  from `content_digest`.
- `bookings.currency` may be NULL in legacy rows; backfill sets it to
  `'USD'` when Stripe evidence agrees (K.2), otherwise quarantines.

Address JSON keys used by canonical encoder (whitelist, exact spelling):

```
formatted, street_number, route, locality,
admin_area_level_1, admin_area_level_2, postal_code, country_code,
lat_e7, lng_e7
```

`lat_e7` / `lng_e7` are `ROUND(lat * 1e7)::bigint` /
`ROUND(lng * 1e7)::bigint` computed from `pickup_lat/lng` and
`dropoff_lat/lng` before encoding. Unknown/missing keys are omitted;
unknown keys in stored JSON that are not on the whitelist are ignored
by the encoder (never appended). This eliminates any ambiguity from
Google Places field drift.

---

## C. Contract-version matrix (retained from 2.4)

| Trigger                              | Bumps `contract_version` |
|--------------------------------------|--------------------------|
| Any pricing field change on bookings | Yes                      |
| Amenity added or removed             | Yes                      |
| Amenity quantity changed             | Yes                      |
| Address change (pickup or dropoff)   | Yes                      |
| `scheduled_at` change                | Yes                      |
| `service_context` change             | Yes                      |
| Dispatch/assignment change           | No                       |
| Status transitions (accepted/etc.)   | No                       |

`content_digest` is recomputed on every version bump. `contract_version`
is a plain monotonically increasing integer per booking; it is **not**
mixed into the material fed to the canonical encoder (Blocker 8 in
Revision 2.4 already removed that circularity — Revision 2.6 preserves
it). The row-level `content_digest` is the tamper-evidence artifact;
`contract_version` is the human-readable revision counter.

---

## D. Booking mutation matrix (retained + hardened from 2.5)

Every write to `public.bookings` uses one of these paths. Direct
`UPDATE public.bookings` from application code is forbidden after
stage M-4 by trigger `bookings_material_guard`.

| Path (RPC)                           | Owner              | Purpose                                     |
|--------------------------------------|--------------------|---------------------------------------------|
| `create_booking`                     | passenger          | Insert draft; sets initial digest           |
| `update_booking_amenities_v2`        | passenger          | Amenity diff (see Section I)                |
| `admin_update_booking_pricing`       | admin              | Manual pricing override (audited)           |
| `admin_resolve_quarantine_case`      | admin              | Mark case resolved and (optionally) ready   |
| `webhook_apply_payment_evidence`     | postgres (webhook) | Applies Stripe evidence (Section K)         |
| `internal_backfill_apply_row`        | postgres           | Single-row backfill worker (Section M)      |

All RPCs are `SECURITY DEFINER`, `OWNER TO postgres`, `SET search_path
= public, pg_temp`, and audited via the existing `_audit_write`
helper. Every RPC bumps `contract_version` when it changes pricing
material, and recomputes `content_digest` from the canonical encoder
(Section E). No path writes to `booking_amenities` outside Section I.

---

## E. Canonical serializer (fixed-schema, pure, side-effect free)

### E.1 Choice

Revision 2.6 uses a **fixed-schema binary encoder** — not RFC 8785. The
encoder knows exactly which fields exist, in what order, and what
type each has. There is no JSON key sort at runtime, so UTF-16 order
edge cases and encoder drift are impossible.

### E.2 Purity requirements

The encoder is implemented as a single SQL function
`public.hlbc2a_canonical_material(...)` that:

- Is `IMMUTABLE`, `PARALLEL SAFE`, `LANGUAGE sql`.
- Takes only scalar arguments (no table lookups inside).
- Performs no `SELECT` on other tables.
- Returns `bytea`.

A companion function `public.hlbc2a_amenity_set_digest(uuid)` **is**
`STABLE` (not `IMMUTABLE`) because it aggregates `booking_amenities`.
It is the only encoder helper permitted to touch a table, and it
returns a `bytea(32)` digest that the pure encoder then consumes as
an opaque scalar. This preserves purity of the top-level encoder
while giving triggers a single call site to hash the amenity set.

### E.3 Encoding rules

- Schema prefix (ASCII, no NUL): `HLBC2A-1`
- Field separator: byte `0x1F` (ASCII Unit Separator, `<US>`)
- Record separator inside sub-lists: byte `0x1E` (ASCII Record Separator, `<RS>`)
- Field format: `key=value`, key is a predefined ASCII constant
  (never derived from user input, never from JSON keys).
- Integers: ASCII decimal, no leading zeros, `-` for negatives.
- UUIDs: 32-char lowercase hex, no dashes.
- Hashes: 64-char lowercase hex.
- Timestamps: `YYYY-MM-DDTHH:MM:SSZ` (UTC, whole seconds).
- Enums (`service_context`, `vehicle_class`, `distance_bucket`,
  `currency`, `country_code`): ASCII literals from a closed set.
- Strings from user input (`formatted`, `route`, etc.) inside address
  sub-encoder: NFC normalized, then UTF-8 encoded verbatim. No key
  is derived from the string; the string is only ever a value.

### E.4 Field order (booking material, V-record)

```
HLBC2A-1
booking_id
contract_version
base_price_cents
amenities_total_cents
total_price_cents
currency
pickup_digest
dropoff_digest
distance_km_x1000
scheduled_at_utc
service_context
amenity_set_digest
classifier_material_digest
```

`content_digest = sha256(canonical_material)` — SHA-256 output is
stored as `bytea(32)` (big-endian byte order; `encode(digest, 'hex')`
yields the lowercase hex used in fixtures).

### E.5 Sub-encoders

Address sub-encoder (`HLBC2A-ADDR-1`) fields in this exact order:

```
formatted, street_number, route, locality,
admin_area_level_1, admin_area_level_2,
postal_code, country_code, lat_e7, lng_e7
```

Amenity-set sub-encoder (`HLBC2A-AMSET-1`): items sorted ascending by
raw UUID bytes; each item encoded as
`<uuid_bytes>|<price_delta_cents>|<quantity>`; items joined by `0x1E`.

Classifier sub-encoder (`HLBC2A-CLS-1`) fields in this exact order:

```
service_context, vehicle_class, distance_bucket
```

---

## F. Complete literal fixtures (SHA-256, lowercase hex, 64 chars)

All UUIDs, timestamps, and amounts are fully specified. No ellipses,
no placeholders. These fixtures are the acceptance oracle for the
encoder implementation — any encoder that returns a different digest
for any listed input MUST fail CI.

### F.1 Constants

```
booking_id            = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
booking_id (hex,32)   = aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa
amenity_option_AM1    = 11111111-1111-4111-8111-111111111111
amenity_option_AM2    = 22222222-2222-4222-8222-222222222222
currency              = USD
```

### F.2 Address fixtures

Pickup canonical UTF-8 (with `<US>` marking byte `0x1F`):

```
HLBC2A-ADDR-1<US>formatted=100 Park Ave, New York, NY 10017, USA<US>street_number=100<US>route=Park Ave<US>locality=New York<US>admin_area_level_1=NY<US>admin_area_level_2=New York<US>postal_code=10017<US>country_code=US<US>lat_e7=407539000<US>lng_e7=-739750000
```

`pickup_digest_sha256 = e75437224fb6ad63eae5a1bcc25306d3821ea51289a126e0be0673891facb0ed`

Dropoff canonical UTF-8:

```
HLBC2A-ADDR-1<US>formatted=1 World Trade Center, New York, NY 10007, USA<US>street_number=1<US>route=World Trade Center<US>locality=New York<US>admin_area_level_1=NY<US>admin_area_level_2=New York<US>postal_code=10007<US>country_code=US<US>lat_e7=407127200<US>lng_e7=-740134400
```

`dropoff_digest_sha256 = c19ccc65bd93afc6ab559381c4f62c791c2a4d8eafd69413444da8f8845bc4fb`

### F.3 Amenity-set fixtures (with `<RS>` = 0x1E)

- V1 (empty): canonical bytes = `HLBC2A-AMSET-1`
  `amset_v1_sha256 = 0a274a3eeeab28a556f8f4bcaf79b955ae0e7fa6fa6d076e8d00293f89e0308d`
- V2 (AM1, 2500 cents, qty 1):
  `HLBC2A-AMSET-1<RS><AM1_bytes>|2500|1`
  `amset_v2_sha256 = c8b4dee05335b60f2d0f7f34f2bb7bd6ddce649860ba3bdbb169b02a40f9b092`
- V3 (AM1 2500 qty 1, AM2 1500 qty 2, sorted by raw uuid bytes → AM1 first):
  `HLBC2A-AMSET-1<RS><AM1_bytes>|2500|1<RS><AM2_bytes>|1500|2`
  `amset_v3_sha256 = 8e7a348fd0f0899f007db960b26877f30fc095b45cb8a1dc4acc05bd216a553d`

### F.4 Classifier fixtures

- V1 = (`standard`, `suburban`, `short`):
  `classifier_v1_sha256 = 78db460e0975a739aa0f18acc01f5a100e6f0a9590b11dc9a9f65e08f940845f`
- V2 = (`standard`, `suburban`, `short`) (unchanged):
  `classifier_v2_sha256 = 78db460e0975a739aa0f18acc01f5a100e6f0a9590b11dc9a9f65e08f940845f`
- V3 = (`airport`, `escalade`, `medium`):
  `classifier_v3_sha256 = 9654c48e3a4ad731a2cc85567eb7261615335a64c5aaaffb9a1c591893d313a8`

### F.5 Booking material V1 (canonical UTF-8, complete)

```
HLBC2A-1<US>booking_id=aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa<US>contract_version=1<US>base_price_cents=12000<US>amenities_total_cents=0<US>total_price_cents=12000<US>currency=USD<US>pickup_digest=e75437224fb6ad63eae5a1bcc25306d3821ea51289a126e0be0673891facb0ed<US>dropoff_digest=c19ccc65bd93afc6ab559381c4f62c791c2a4d8eafd69413444da8f8845bc4fb<US>distance_km_x1000=8500<US>scheduled_at_utc=2026-08-01T14:30:00Z<US>service_context=standard<US>amenity_set_digest=0a274a3eeeab28a556f8f4bcaf79b955ae0e7fa6fa6d076e8d00293f89e0308d<US>classifier_material_digest=78db460e0975a739aa0f18acc01f5a100e6f0a9590b11dc9a9f65e08f940845f
```

`V1_sha256 = 23917a9dfa494ea717f916a8a193d7c265b7de44f800af95d3779ce83b983da9`

### F.6 Booking material V2 (canonical UTF-8, complete)

Differences from V1: `contract_version=2`, one amenity added (AM1 @ 2500
qty 1) → `amenities_total_cents=2500`, `total_price_cents=14500`,
`amenity_set_digest` = V2 amset digest.

```
HLBC2A-1<US>booking_id=aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa<US>contract_version=2<US>base_price_cents=12000<US>amenities_total_cents=2500<US>total_price_cents=14500<US>currency=USD<US>pickup_digest=e75437224fb6ad63eae5a1bcc25306d3821ea51289a126e0be0673891facb0ed<US>dropoff_digest=c19ccc65bd93afc6ab559381c4f62c791c2a4d8eafd69413444da8f8845bc4fb<US>distance_km_x1000=8500<US>scheduled_at_utc=2026-08-01T14:30:00Z<US>service_context=standard<US>amenity_set_digest=c8b4dee05335b60f2d0f7f34f2bb7bd6ddce649860ba3bdbb169b02a40f9b092<US>classifier_material_digest=78db460e0975a739aa0f18acc01f5a100e6f0a9590b11dc9a9f65e08f940845f
```

`V2_sha256 = 40cb3e20ea43edee207d7b66dfe12e9541583519227662b9fd515d34f507c6cd`

### F.7 Booking material V3 (canonical UTF-8, complete)

Differences: airport ride, `base_price_cents=22000`,
`amenities_total_cents=5500` (AM1 2500 + AM2 1500×2),
`total_price_cents=27500`, `distance_km_x1000=26400`, new
`scheduled_at_utc=2026-09-15T09:00:00Z`, `service_context=airport`,
classifier V3.

```
HLBC2A-1<US>booking_id=aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa<US>contract_version=3<US>base_price_cents=22000<US>amenities_total_cents=5500<US>total_price_cents=27500<US>currency=USD<US>pickup_digest=e75437224fb6ad63eae5a1bcc25306d3821ea51289a126e0be0673891facb0ed<US>dropoff_digest=c19ccc65bd93afc6ab559381c4f62c791c2a4d8eafd69413444da8f8845bc4fb<US>distance_km_x1000=26400<US>scheduled_at_utc=2026-09-15T09:00:00Z<US>service_context=airport<US>amenity_set_digest=8e7a348fd0f0899f007db960b26877f30fc095b45cb8a1dc4acc05bd216a553d<US>classifier_material_digest=9654c48e3a4ad731a2cc85567eb7261615335a64c5aaaffb9a1c591893d313a8
```

`V3_sha256 = 9cb8bb825f6e5a7fe94c21c35019cf1925005e922dc6ea41a9f864d8fdcd2e7b`

---

## G. Non-forgeable authorization for child-table writes (no GUC marker)

Revision 2.5 used a GUC (`SET LOCAL harborline.amenity_mutation_source
= 'rpc'`) as a trigger-bypass signal. `set_config()` is callable from
any authenticated session with SQL access, so the marker is forgeable.
Revision 2.6 removes that mechanism entirely.

### G.1 Ownership boundary

- `public.booking_amenities` is `OWNER TO postgres`.
- All application roles (`anon`, `authenticated`, `service_role`, and
  any project-specific roles) have their DML privileges on
  `booking_amenities` **revoked** in stage M-2:
  `REVOKE INSERT, UPDATE, DELETE ON public.booking_amenities FROM
  anon, authenticated, service_role;` (`SELECT` remains for
  `authenticated` under RLS.)
- All child mutations flow through `SECURITY DEFINER` RPCs owned by
  `postgres` (Section I). Because the RPCs execute as `postgres` and
  application roles no longer hold DML on the child table, PostgREST
  cannot forge a direct write.

### G.2 Trigger enforcement uses `session_user`, not GUCs

The `booking_amenities_dml_guard` trigger (BEFORE INSERT/UPDATE/DELETE
FOR EACH ROW) rejects any write unless `session_user = 'postgres'`
(i.e. executed inside a `SECURITY DEFINER` function owned by
`postgres`). Trigger body:

```sql
IF session_user <> 'postgres' THEN
  RAISE EXCEPTION 'booking_amenities: direct DML forbidden; use RPC'
    USING ERRCODE = '42501';
END IF;
```

`session_user` is not settable from within a session (unlike
`current_user`, which changes under `SECURITY DEFINER`), so no
application-level `SET`, `SET LOCAL`, `set_config`, `SET ROLE`, or
`SET SESSION AUTHORIZATION` invoked by a non-superuser can subvert
it. Superuser bypass is intentional (operator escape hatch) and
covered by Postgres role management, not application code.

### G.3 No reusable bypass flag anywhere

- No GUC (`harborline.*`, `app.*`, etc.) is defined, read, or set.
- No boolean column such as `_bypass_guard` is added to any table.
- No temp table sentinel is used.
- The `bookings_material_guard` trigger (Section H) uses the same
  `session_user = 'postgres'` check for parity.

---

## H. `bookings_material_guard` (no GUC dependency)

BEFORE UPDATE trigger on `public.bookings` prevents application code
from mutating pricing/material columns directly:

```sql
CREATE OR REPLACE FUNCTION public.bookings_material_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user <> 'postgres' THEN
    IF NEW.base_price_cents      IS DISTINCT FROM OLD.base_price_cents
    OR NEW.amenities_total_cents IS DISTINCT FROM OLD.amenities_total_cents
    OR NEW.total_price_cents     IS DISTINCT FROM OLD.total_price_cents
    OR NEW.currency              IS DISTINCT FROM OLD.currency
    OR NEW.contract_version      IS DISTINCT FROM OLD.contract_version
    OR NEW.contract_state        IS DISTINCT FROM OLD.contract_state
    OR NEW.content_digest        IS DISTINCT FROM OLD.content_digest
    OR NEW.pricing_evidence      IS DISTINCT FROM OLD.pricing_evidence
    OR NEW.price                 IS DISTINCT FROM OLD.price
    THEN
      RAISE EXCEPTION
        'bookings: material columns are RPC-only'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

Application roles keep `UPDATE` on non-material columns (e.g. notes,
status, dispatch fields). Every attempt to mutate a material column
without going through a `postgres`-owned RPC fails with SQLSTATE
`42501`.

---

## I. Amenity mutation RPC (v2 = authoritative; v1 = compatibility wrapper)

### I.1 `update_booking_amenities_v2(_booking_id uuid, _desired jsonb)`

- Owner: `postgres`. `SECURITY DEFINER`. `SET search_path = public,
  pg_temp`. Runs in an implicit single transaction.
- Authorization: RLS-equivalent check that the caller is either the
  booking's passenger or a user with `has_role(auth.uid(),'admin')`.
- Takes a row-level advisory lock on the booking:
  `PERFORM pg_advisory_xact_lock(hashtextextended(_booking_id::text, 0));`
- `SELECT ... FOR UPDATE` on `public.bookings WHERE id = _booking_id`.
- Reads the existing amenity set into a CTE `existing`.
- Parses `_desired` into `desired(amenity_option_id uuid, quantity int)`.
- Computes three sets **by `amenity_option_id`**:
  - `to_add`     = `desired` LEFT ANTI JOIN `existing`
  - `to_remove`  = `existing` LEFT ANTI JOIN `desired`
  - `to_update`  = `desired INTERSECT existing WHERE quantity distinct`
- Executes exactly:
  - `INSERT INTO booking_amenities` for `to_add` (snapshots
    `snapshot_name`, `snapshot_description`, `price_delta_cents`,
    `currency` from `amenity_options` at insert time).
  - `DELETE FROM booking_amenities` for `to_remove`.
  - `UPDATE booking_amenities SET quantity = ...` for `to_update`
    only. `price_delta_cents`, `snapshot_*`, and `currency` on
    surviving rows are **never rewritten**. This satisfies Blocker
    10: preserved snapshots for unchanged amenity IDs.
- Recomputes `amenities_total_cents`, bumps `contract_version`,
  recomputes `content_digest`, updates `public.bookings` in the same
  transaction, and appends an audit row via `_audit_write`.
- Returns the new `content_digest` and `contract_version`.

### I.2 Idempotency (Blocker 7 from earlier revisions, re-affirmed)

The client sends the full desired amenity set. Replays of the same
desired set produce empty `to_add`/`to_remove`/`to_update` and the
RPC exits early **without** bumping `contract_version` or writing an
audit row. Concurrent calls serialize on the advisory lock.

### I.3 `update_booking_amenities` v1 wrapper (delegates to v2)

- Owner: `postgres`. `SECURITY DEFINER`.
- Body is exactly:
  ```sql
  SELECT public.update_booking_amenities_v2(_booking_id,
    public.hlbc2a_v1_to_desired(_booking_id, _amenity_ids));
  ```
- The wrapper performs **no** `INSERT`, `UPDATE`, or `DELETE` on
  `booking_amenities`. It has no other side effect. It exists only
  to preserve the pre-2A call signature for any lingering caller.
- `hlbc2a_v1_to_desired` is `STABLE` and turns the legacy
  `uuid[]` argument into `jsonb` with `quantity = 1` per id,
  preserving quantities for ids that already exist on the booking.
- The v1 wrapper cannot mutate `booking_amenities` independently
  because the `booking_amenities_dml_guard` trigger and the
  child-table `REVOKE` block it from doing so directly, and the
  wrapper body contains only the `SELECT` above.

### I.4 Amenity mutations bump parent version

Enforced inside v2 (single transaction). Direct child writes are
impossible per Section G, so the "child write bypassing parent bump"
path is closed at the DML boundary, not merely by convention.

---

## J. Quarantine model — three tables, preserved case identity

### J.1 Rationale

Revision 2.5 collapsed reasons and cases into a single catalog +
`quarantine_reason` string. Revision 2.6 restores case identity and
lifecycle by splitting into three tables while keeping the catalog
introduced in 2.3.

### J.2 `public.booking_quarantine_reason_catalog`

```sql
CREATE TABLE public.booking_quarantine_reason_catalog (
  reason_code       text PRIMARY KEY,
  title             text NOT NULL,
  description       text NOT NULL,
  blocks_checkout   boolean NOT NULL,
  blocker_dimension text NOT NULL,      -- 'pricing'|'address'|'amenity'|'evidence'|'other'
  created_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.booking_quarantine_reason_catalog TO authenticated;
GRANT ALL    ON public.booking_quarantine_reason_catalog TO service_role;
ALTER TABLE public.booking_quarantine_reason_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog readable by authenticated"
  ON public.booking_quarantine_reason_catalog
  FOR SELECT TO authenticated USING (true);
```

Seeded reason codes (initial set):

- `pricing_missing`         (blocks_checkout=true,  dimension=pricing)
- `pricing_evidence_missing`(blocks_checkout=true,  dimension=evidence)
- `pricing_mismatch`        (blocks_checkout=true,  dimension=pricing)
- `amenity_orphan`          (blocks_checkout=true,  dimension=amenity)
- `amenity_duplicate`       (blocks_checkout=true,  dimension=amenity)
- `address_incomplete`      (blocks_checkout=true,  dimension=address)
- `distance_unresolved`     (blocks_checkout=true,  dimension=address)
- `currency_ambiguous`      (blocks_checkout=true,  dimension=evidence)
- `stripe_lineitems_missing`(blocks_checkout=true,  dimension=evidence)
- `manual_review`           (blocks_checkout=false, dimension=other)

### J.3 `public.booking_quarantine_cases`

```sql
CREATE TABLE public.booking_quarantine_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opened_by       uuid,                             -- auth.uid() or NULL for system
  opened_source   text NOT NULL,                    -- 'backfill'|'webhook'|'rpc'|'admin'
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution      text,                             -- 'fixed'|'accepted'|'closed_wontfix'
  notes           text,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_version    integer NOT NULL DEFAULT 0        -- optimistic concurrency
);
CREATE UNIQUE INDEX booking_quarantine_cases_open_one
  ON public.booking_quarantine_cases (booking_id)
  WHERE resolved_at IS NULL;
```

At most one open case per booking. Row-lock concurrency via
`SELECT ... FOR UPDATE` inside admin resolution RPC; `lock_version`
supports optimistic UI edits.

### J.4 `public.booking_quarantine_case_reasons`

```sql
CREATE TABLE public.booking_quarantine_case_reasons (
  case_id        uuid NOT NULL REFERENCES public.booking_quarantine_cases(id) ON DELETE CASCADE,
  reason_code    text NOT NULL REFERENCES public.booking_quarantine_reason_catalog(reason_code),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cleared_at     timestamptz,
  cleared_by     uuid,
  PRIMARY KEY (case_id, reason_code)
);
```

A single case can carry multiple reason codes; each reason has its
own lifecycle within the case. A case is eligible to close only when
every reason row has `cleared_at IS NOT NULL`.

### J.5 Grants + RLS

All three tables have the standard grant block:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_quarantine_cases         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_quarantine_case_reasons  TO authenticated;
GRANT ALL ON public.booking_quarantine_cases         TO service_role;
GRANT ALL ON public.booking_quarantine_case_reasons  TO service_role;
```

RLS: admins full access via `has_role(auth.uid(),'admin')`;
passengers read-only on their own booking's cases (title + `blocks_checkout`
projection only; evidence and notes hidden).

### J.6 Atomic resolution ordering

`admin_resolve_quarantine_case(_case_id, _resolution, _notes)`
executes in one transaction:

1. `SELECT ... FOR UPDATE` on the case.
2. Verify every reason row has `cleared_at IS NOT NULL` (or being
   cleared in this call via `_clear_reason_codes` array parameter).
3. Update case (`resolved_at = now()`, `resolved_by = auth.uid()`,
   `resolution`, `notes`, `lock_version = lock_version + 1`).
4. Take `SELECT ... FOR UPDATE` on `public.bookings`.
5. If resolution is `fixed`, recompute material via encoder; if
   digest matches Stripe evidence (K), set `contract_state = 'ready'`
   and bump `contract_version`.
6. Emit `_audit_write('quarantine_resolve', case_id, ...)`.

Rejection paths raise inside the same transaction so the case never
partially resolves.

---

## K. Legacy backfill and paid reconciliation (no double-count)

### K.1 Unpaid rows (rule A, deterministic)

For `paid = false`: recompute `base_price_cents` using the same
rule engine that `create_booking` uses today, derive
`amenities_total_cents` from `booking_amenities`, set
`total_price_cents = base + amenities`. If the rule engine cannot
resolve (missing distance, ambiguous currency), open a case with
`pricing_missing` or `distance_unresolved`.

### K.2 Paid rows (rule B, evidence-driven)

For `paid = true`, `bookings.price` is **not** used to derive
`base_price_cents`. The current webhook overwrites `price` with
Stripe `amount_total`, which includes amenities. Using `price` as
base would double-count amenities against `booking_amenities`.

The paid backfill:

1. Loads the Stripe Checkout Session line items for the booking
   (via existing `stripe_events` payload + `stripe.checkout.sessions.list_line_items`
   captured in `pricing_evidence`; if not captured yet, a one-time
   evidence fetch worker enqueues the fetch — no live Stripe write).
2. Categorizes line items:
   - Items whose metadata `type = 'base_fare'` (or Product ID matches
     the base fare product catalog) sum into `base_price_cents`.
   - Items whose metadata `type = 'amenity'` (or Product ID matches
     an `amenity_options.stripe_product_id`) sum into
     `amenities_total_cents_from_stripe`.
3. Validates:
   `amenities_total_cents_from_stripe == SUM(booking_amenities.price_delta_cents * quantity)`
   for the current amenity set. If they disagree, opens a case with
   `pricing_mismatch`.
4. Validates `base + amenities_stripe == stripe_amount_total`. If
   not, opens `pricing_mismatch`.
5. If categorization is impossible (no line item metadata, no product
   match), opens `stripe_lineitems_missing`. Booking stays
   `contract_state = 'quarantined'` until manually resolved by an
   admin who supplies evidence.
6. Only when all validations pass, the row is written with
   `base_price_cents`, `amenities_total_cents`, `total_price_cents`,
   `pricing_evidence = jsonb_build_object('source','stripe_line_items','line_items', <captured>)`,
   and `contract_state = 'ready'`.

At no point does the backfill read `bookings.price` as a source of
truth. `bookings.price` remains untouched (Section A.2).

### K.3 Webhook non-regression

`webhook_apply_payment_evidence` (postgres-owned RPC) writes
`pricing_evidence` and `paid_at` but never touches `base_price_cents`,
`amenities_total_cents`, `total_price_cents`, `currency`,
`contract_version`, or `content_digest`. If Stripe evidence disagrees
with the current contract, the RPC opens a `pricing_mismatch` case
and leaves the contract unchanged.

---

## L. Checkout eligibility gate (conjunctive)

`public.booking_is_checkout_eligible(_booking_id uuid) RETURNS boolean`
is `STABLE`, `SECURITY DEFINER`, and returns true iff **both**:

1. `bookings.contract_state = 'ready'`, AND
2. No row in `booking_quarantine_case_reasons` r joined to an open
   case for this booking exists where
   `r.cleared_at IS NULL` and the catalog row has
   `blocks_checkout = true`:

   ```sql
   SELECT NOT EXISTS (
     SELECT 1
       FROM public.booking_quarantine_cases c
       JOIN public.booking_quarantine_case_reasons r ON r.case_id = c.id
       JOIN public.booking_quarantine_reason_catalog k ON k.reason_code = r.reason_code
      WHERE c.booking_id = _booking_id
        AND c.resolved_at IS NULL
        AND r.cleared_at  IS NULL
        AND k.blocks_checkout = true
   );
   ```

Explicit consequences:

- A `draft` booking with no cases is **not** eligible (Blocker 3).
- A `ready` booking with an open non-blocking `manual_review` case
  **is** eligible.
- A `ready` booking with any open blocking reason is not eligible.

`createBookingCheckout` in `src/lib/payments.functions.ts` calls this
function inside the same transaction as the Stripe Checkout Session
creation lease and refuses to proceed on `false` with a stable
error code `HLBC2A_NOT_ELIGIBLE`.

---

## M. Staged deployment — additive → backfill → validate → constrain

Revision 2.5 collapsed schema changes and `SET NOT NULL` into a
single monolithic migration. Revision 2.6 splits into four disjoint
migrations. Each stage is idempotent, resumable, and reversible.

### M-1. Additive schema (nullable)

- `CREATE TYPE public.booking_contract_state`.
- Add nullable columns to `public.bookings` (A.2).
- Create `booking_quarantine_reason_catalog`, `booking_quarantine_cases`,
  `booking_quarantine_case_reasons` (J), seed catalog rows.
- Create encoder functions (E), amenity RPCs (I), guard triggers (G, H)
  **in disabled state** (`ALTER TABLE ... DISABLE TRIGGER`).
- Grants per project convention.

Reversible via `DROP` in reverse order.

### M-2. Resumable idempotent backfill

- Runs in a worker that processes bookings in `id`-ordered pages of
  1000, checkpointing progress in `public.booking_contract_backfill_progress`.
- For each row calls `internal_backfill_apply_row(booking_id)`,
  which is idempotent: if `contract_state` is already `ready` or
  `quarantined`, the row is skipped.
- Uses rules from K.1 / K.2. Never runs `SET NOT NULL`. Never runs
  `ALTER TABLE`. Never touches `bookings.price`.
- Quarantined rows remain `NULL` in the new pricing columns; this is
  the reason M-3 defers `NOT NULL`. Quarantined-unresolved rows are
  first-class and representable throughout M-2 and M-3.

Resumability: `SELECT count(*) FROM public.bookings` is exposed via
the progress table's `total`, and the worker's next-batch query is
`... WHERE id > :last_id ORDER BY id LIMIT 1000`.

### M-3. Validation

- Query `SELECT COUNT(*) FROM public.bookings WHERE contract_state
  IS NULL` — must be 0 for M-4 preconditions; otherwise M-2 is
  re-run.
- Query `SELECT COUNT(*) FROM public.bookings WHERE
  contract_state = 'ready' AND (base_price_cents IS NULL OR
  amenities_total_cents IS NULL OR total_price_cents IS NULL OR
  content_digest IS NULL OR currency IS NULL)` — must be 0.
- Query the invariant:
  `SELECT COUNT(*) FROM public.bookings WHERE contract_state =
  'ready' AND total_price_cents <> base_price_cents +
  amenities_total_cents` — must be 0.
- Duplicate consolidation (Section N) runs here and must report 0
  outstanding duplicates.

If any check fails, deployment halts. M-4 is not run.

### M-4. Constraints, enable guards, revoke child DML

- Enable `booking_amenities_dml_guard` and `bookings_material_guard`
  triggers (`ENABLE TRIGGER`).
- `REVOKE INSERT, UPDATE, DELETE ON public.booking_amenities FROM
  anon, authenticated, service_role;`.
- `ALTER TABLE public.bookings
     ADD CONSTRAINT bookings_contract_state_notnull
       CHECK (contract_state IS NOT NULL) NOT VALID;`
  then `VALIDATE CONSTRAINT` — matched-pair pattern avoids full-table
  rewrite lock. Equivalent staged NOT NULL is applied to the pricing
  columns **only for rows where `contract_state = 'ready'`** by using
  a partial CHECK:
  ```sql
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_ready_pricing_complete
    CHECK (
      contract_state <> 'ready' OR (
        base_price_cents IS NOT NULL
        AND amenities_total_cents IS NOT NULL
        AND total_price_cents IS NOT NULL
        AND currency IS NOT NULL
        AND content_digest IS NOT NULL
      )
    ) NOT VALID;
  ```
  Then `VALIDATE`. Quarantined rows are unaffected.
- Add partial unique index on open cases:
  `CREATE UNIQUE INDEX booking_quarantine_cases_open_one
     ON public.booking_quarantine_cases (booking_id)
     WHERE resolved_at IS NULL;`
- Publish checkout gate to `payments.functions.ts` (code change,
  Batch 2A cutover PR).

Rollback plan: `DISABLE TRIGGER`, drop constraints,
re-`GRANT` on `booking_amenities`, revert application code. Data
columns stay in place (safe forward-compat).

---

## N. Duplicate consolidation (physical, before unique index)

Before M-4 creates `booking_quarantine_cases_open_one`, run:

```sql
WITH ranked AS (
  SELECT id, booking_id,
         ROW_NUMBER() OVER (PARTITION BY booking_id
                            ORDER BY opened_at DESC, id DESC) rn
    FROM public.booking_quarantine_cases
   WHERE resolved_at IS NULL
)
UPDATE public.booking_quarantine_cases c
   SET resolved_at = now(),
       resolved_by = NULL,
       resolution  = 'closed_wontfix',
       notes       = COALESCE(notes,'') || ' [auto-consolidated superseded duplicate]'
  FROM ranked r
 WHERE c.id = r.id AND r.rn > 1;
```

Then re-run `SELECT COUNT(*) FROM public.booking_quarantine_cases
WHERE resolved_at IS NULL GROUP BY booking_id HAVING COUNT(*) > 1;`
— must return zero rows before the unique index is created.

---

## O. Grants summary (aligned with existing revoke posture)

- `booking_amenities`: application `SELECT` under RLS only; no DML
  after M-4 (Section G.1).
- `bookings`: application `SELECT/UPDATE/INSERT/DELETE` retained for
  non-material columns; material columns protected by trigger (H).
- New tables (`booking_quarantine_reason_catalog`,
  `booking_quarantine_cases`, `booking_quarantine_case_reasons`):
  grant block per Section J.5, RLS enforced.
- All new RPCs (`update_booking_amenities_v2`, `admin_resolve_quarantine_case`,
  `webhook_apply_payment_evidence`, `internal_backfill_apply_row`,
  `booking_is_checkout_eligible`): grants restricted to the roles
  that actually call them; `internal_backfill_apply_row` and
  `webhook_apply_payment_evidence` are `EXECUTE` to `postgres` only.

---

## P. Acceptance criteria (Revision 2.6 exit gate)

1. Encoder fixtures (F) reproduce exactly against a reference
   implementation and against the SQL implementation.
2. Direct DML on `booking_amenities` from any application role fails
   with SQLSTATE `42501` (test uses `SET ROLE authenticated;
   INSERT INTO booking_amenities ...`). Same test with a GUC
   spoof (`SELECT set_config('harborline.amenity_mutation_source','rpc',true);`
   before the INSERT) still fails — proves no forgeable bypass.
3. Direct `UPDATE public.bookings SET base_price_cents = ...` from
   `authenticated` fails with `42501`.
4. `update_booking_amenities` v1 wrapper called with an identical
   amenity id list does not touch `booking_amenities` (no rows
   inserted, no snapshot regenerated). Called with one added id,
   only `to_add` rows are inserted; existing rows are byte-identical
   before and after.
5. `booking_is_checkout_eligible` returns false for a `draft`
   booking with no cases, and false for a `ready` booking with any
   open blocking reason.
6. Paid backfill on a fixture whose Stripe line items omit metadata
   opens a `stripe_lineitems_missing` case and leaves
   `contract_state = 'quarantined'` — never derives base from
   `bookings.price`.
7. M-2 backfill is stopped mid-run and resumed; final row counts
   match a single-shot run.
8. M-4 constraints validate without table rewrite (verified with
   `EXPLAIN (ANALYZE, BUFFERS)` on a copy).

---

## Q. Out of scope reminders

- No Stripe API call is added in Batch 2A.
- No changes to `payment_attempts`.
- No SEO/UI changes.
- No i18n updates.

---

PLAN STATUS: REVISION 2.6 — FINAL BATCH 2A BLOCKERS CORRECTED

IMPLEMENTATION STATUS: BLOCKED — AWAITING CODEX REVIEW
