# HarborLine Batch 2 — Revision 2.7 (Batch 2A Corrections Only)

Planning document. No implementation, no migrations, no code changes,
no deployment, no Stripe resource changes, no pull request. Revision
2.7 supersedes 2.6 in full and resolves the eleven prior Codex
blockers plus the mandatory twelfth rollback correction.

Revision 2.7 has been re-scanned end-to-end for consistency. Every
statement from earlier revisions that conflicts with the rules below
has been removed. In particular the following older constructs are
**deleted** and MUST NOT be reintroduced anywhere in this plan:

- `session_user = 'postgres'` gate checks in triggers or RPCs
- `current_setting('harborline.bypass', true)` and any custom GUC
- Any "reusable bypass flag" or forgeable trigger-bypass design
- `snapshot_name` / `stripe_product_id` columns
- `scheduled_at` field references (repository uses `pickup_time`)
- Auto-merge of duplicate `(booking_id, amenity_option_id)` rows
- "Stripe lease", Stripe API calls, or webhook edits inside Batch 2A
- Blanket `DROP TABLE` / `DROP COLUMN` rollback recipes after data exists
- Any statement that `bookings.price` equals `base_price_cents` when
  amenities may be included

---

## A. Scope of Batch 2A

Batch 2A is limited to:

1. **Additive schema** for the booking contract (nullable columns,
   new child tables, new catalog tables).
2. **Canonical content digest** infrastructure (fixed-schema encoder,
   digest columns, invariant triggers).
3. **Amenity mutation RPC v2** with a v1 wrapper that preserves the
   exact existing signature.
4. **Quarantine tri-table** model (reason catalog, cases, case
   reasons) with RPC-only mutations.
5. **Staged, resumable, idempotent backfill** with quarantine of
   undecidable rows.
6. **Checkout activation gate** (`contract_state = 'ready'` AND no
   open blocking quarantine reason).

Batch 2A explicitly **does not** touch: Stripe API, Stripe webhook,
payment_attempts lease machine, policy bundles, review records,
passenger review UI, dispatch, driver app. Those remain in 2B–2D.

## B. Repository field mapping (authoritative)

The plan uses only field names that already exist in the
repository or are added by Batch 2A's additive migration:

| Concept                      | Repository field                    |
|------------------------------|-------------------------------------|
| Pickup timestamp             | `bookings.pickup_time`              |
| Passenger                    | `bookings.user_id`                  |
| Ride type                    | `bookings.ride_type`                |
| Distance                     | `bookings.distance_km`              |
| Legacy price (untouched)     | `bookings.price`                    |
| Amenity link table           | `public.booking_amenities`          |
| Per-line amenity name        | `booking_amenities.amenity_name`    |
| Per-line amenity fee         | `booking_amenities.price_delta_cents` |
| Amenity catalog              | `public.amenity_options`            |
| Amenity catalog fee          | `amenity_options.price_delta_cents` |
| Amenity catalog display name | `amenity_options.name`              |

No use of: `scheduled_at`, `snapshot_name`,
`amenity_options.stripe_product_id`, `booking_amenities.snapshot_name`.

## C. Additive columns (complete list)

Batch 2A adds the following nullable columns. Every column referenced
elsewhere in this plan appears here. No column is renamed, moved, or
dropped.

`public.bookings`:

- `currency               text            NULL`
- `service_context        text            NULL`  -- 'standard' | 'airport' | 'unresolved'
- `contract_state         text            NULL`  -- 'draft' | 'ready' | 'quarantined'
- `contract_version       smallint        NULL`  -- integer, monotonically non-decreasing
- `content_digest         bytea           NULL`  -- 32-byte SHA-256, excludes contract_version
- `classifier_digest      bytea           NULL`  -- 32-byte SHA-256 of address+airport classifier
- `pickup_addr_digest     bytea           NULL`  -- 32-byte SHA-256 of canonical pickup address
- `dropoff_addr_digest    bytea           NULL`  -- 32-byte SHA-256 of canonical dropoff address
- `amenity_set_digest     bytea           NULL`  -- 32-byte SHA-256 of canonical amenity set
- `base_price_cents       integer         NULL`
- `amenity_total_cents    integer         NULL`
- `total_price_cents      integer         NULL`
- `content_digest_updated_at  timestamptz NULL`

All columns start NULL. `bookings.price` is **not** modified, moved,
or reinterpreted by Batch 2A.

New tables (all `OWNER = postgres`, all with explicit grants below):

- `public.booking_contract_quarantine_reason_catalog`
- `public.booking_contract_quarantine_cases`
- `public.booking_contract_quarantine_case_reasons`

## D. Ownership and privilege model (replaces all bypass designs)

Every RPC that mutates `bookings`, `booking_amenities`, or the three
quarantine tables is:

- `OWNER = postgres`
- `SECURITY DEFINER`
- `SET search_path = pg_catalog, public`
- Granted `EXECUTE` explicitly to `authenticated` (and to
  `service_role` where noted). No `PUBLIC` execute.
- Contains an internal authorization block that verifies the caller
  (`auth.uid()` for passenger paths; `public.has_role(auth.uid(),
  'admin')` for admin paths).

Direct table DML is revoked:

```sql
REVOKE INSERT, UPDATE, DELETE
  ON public.booking_amenities
  FROM anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE
  ON public.booking_contract_quarantine_reason_catalog,
     public.booking_contract_quarantine_cases,
     public.booking_contract_quarantine_case_reasons
  FROM anon, authenticated, service_role;
```

`SELECT` remains governed by existing RLS policies on
`booking_amenities`, and by RPC-return-only exposure for the
quarantine tables (no direct `SELECT` grant to `anon` /
`authenticated` on the quarantine tables).

There is **no** `session_user = 'postgres'` check, **no**
`current_setting('harborline.*', true)` GUC, and **no** "maintenance
DML" path. All child-table mutations route through the RPCs listed
in §H and §M. Because the RPCs are `SECURITY DEFINER` owned by
`postgres` and the underlying grants are revoked, no external caller
can bypass them.

## E. Canonical encoder (fixed-schema, pure, deterministic)

The encoder is implemented as an `IMMUTABLE` PL/pgSQL function that
takes a fixed record shape per domain and returns `bytea`. It has no
`SELECT`, no `now()`, no `random()`, no session state.

Byte-level format (identical across all domains):

```
HEADER  = "HLBC2A-1"  US(0x1F)  <domain-ascii>  RS(0x1E)
BODY    = for each fixed field in fixed order:
            <field-key-ascii>  US(0x1F)  <value-bytes>  RS(0x1E)

value-bytes:
  TEXT   -> "T:" + NFC(utf-8)
  INT    -> "I:" + ASCII decimal (no leading zeros, "-" for negatives)
  UUID   -> "U:" + 32 lowercase hex (no dashes)
  HEX    -> "H:" + lowercase hex of a child digest
  BOOL   -> "B:0" | "B:1"
  NULL   -> "N:"
```

Digest = `sha256(HEADER || BODY)` returning 32 bytes.

Domains and fixed field orders:

- `addr.v1`:  `label, place_id, lat_e7, lon_e7`
- `classifier.v1`: `pickup, dropoff, pickup_airport, dropoff_airport`
- `amenity_set.v1`: `count, i{N}.id, i{N}.name, i{N}.price, i{N}.currency`
  for each item sorted ascending by `amenity_option_id`.
- `booking.v1`: `booking_id, passenger_id, ride_type, service_context,
  pickup_time, pickup_addr, dropoff_addr, classifier, distance_km_e3,
  base_price_cents, amenity_total_cents, total_price_cents, currency,
  amenity_set`.

`contract_version` is **excluded** from every canonical material.

`pickup_time` is serialized as ISO-8601 UTC with second precision
(`YYYY-MM-DDTHH:MI:SSZ`). `distance_km` is serialized as
`round(distance_km * 1000)` (integer, `_e3` suffix). Coordinates use
`round(lat * 1e7)` / `round(lon * 1e7)` (integer, `_e7` suffix).

## F. Digest input contract (no read-your-writes race)

The booking digest helper accepts a fully-materialized composite
argument. It does not `SELECT` from `bookings`. All inputs are passed
by the caller (RPC handler), which has already assembled them inside
the same transaction. This eliminates any read-your-writes ordering
hazard and any dependence on trigger firing order.

## G. Complete fixtures (literal, reproducible)

All fixtures below were produced by the encoder in §E and hashed with
SHA-256. Canonical bytes are shown as complete lowercase hex; no
ellipses. UUIDs are literal, not placeholders.

### G.1 Address fixtures

`addr.A` — pickup used in V1/V2/V3:

- Inputs: `label="123 Main St, Boston, MA 02116, USA"`,
  `place_id="ChIJPTacEpBQwokRKwIlDXelxkA"`,
  `lat_e7=423550000`, `lon_e7=-710650000`
- Canonical bytes (hex, 138 bytes):
  `484c424332412d311f616464722e76311e6c6162656c1f543a313233204d61696e2053742c20426f73746f6e2c204d412030323131362c205553411e706c6163655f69641f543a4368494a5054616345704251776f6b524b77496c4458656c786b411e6c61745f65371f493a3432333535303030301e6c6f6e5f65371f493a2d3731303635303030301e`
- SHA-256: `d945294931038a35f38ee980c19b6f6589284b1d153cd3700be1c7ed4656baa8`

`addr.B` — dropoff used in V1/V3:

- Inputs: `label="200 Clarendon St, Boston, MA 02116, USA"`,
  `place_id="ChIJd8UDgpBQwokRuQlz2ZFhLLo"`,
  `lat_e7=423486000`, `lon_e7=-710756000`
- Canonical bytes (hex, 143 bytes):
  `484c424332412d311f616464722e76311e6c6162656c1f543a32303020436c6172656e646f6e2053742c20426f73746f6e2c204d412030323131362c205553411e706c6163655f69641f543a4368494a6438554467704251776f6b5275516c7a325a46684c4c6f1e6c61745f65371f493a3432333438363030301e6c6f6e5f65371f493a2d3731303735363030301e`
- SHA-256: `3efa6944f0415f6754eb267a3a9320c5692de1a32e14464df32472429e430a65`

`addr.Air` — dropoff used in V2:

- Inputs: `label="Boston Logan Intl Airport (BOS), East Boston, MA, USA"`,
  `place_id="ChIJN0nyneZw44kR8Ie6UeKm7Rw"`,
  `lat_e7=423656000`, `lon_e7=-710096000`
- Canonical bytes (hex, 157 bytes):
  `484c424332412d311f616464722e76311e6c6162656c1f543a426f73746f6e204c6f67616e20496e746c20416972706f72742028424f53292c204561737420426f73746f6e2c204d412c205553411e706c6163655f69641f543a4368494a4e306e796e655a7734346b523849653655654b6d3752771e6c61745f65371f493a3432333635363030301e6c6f6e5f65371f493a2d3731303039363030301e`
- SHA-256: `d916af7b082e1a1197dfb6d4e2059c159f46c46935a24fc02b2a4008c07dd231`

### G.2 Classifier fixtures

`classifier.V1` — standard (both non-airport):

- SHA-256: `ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4`

`classifier.V2` — airport dropoff:

- SHA-256: `d55cc348c9a74b1780b99fa6ad6594370d9c1a88dd7fb13fc37a7382c237a2b4`

`classifier.V3` — same input as V1 (identity check, must match V1):

- SHA-256: `ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4`

Full canonical bytes for V1/V2 (211 bytes each) are:

```
V1: 484c424332412d311f636c61737369666965722e76311e7069636b75701f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66661f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e7069636b75705f616972706f72741f423a301e64726f706f66665f616972706f72741f423a301e

V2: 484c424332412d311f636c61737369666965722e76311e7069636b75701f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66661f483a643931366166376230383265316131313937646662366434653230353963313539663436633436393335613234666330326232613430303863303764643233311e7069636b75705f616972706f72741f423a301e64726f706f66665f616972706f72741f423a311e
```

### G.3 Amenity-set fixtures

Amenity IDs (literal):

- `AM1 = 11111111-1111-4111-8111-111111111111`
- `AM2 = 22222222-2222-4222-8222-222222222222`

`amenity_set.empty` (0 items):

- Canonical bytes (34): `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a301e`
- SHA-256: `d4c892e792acf5307abf73a1dc4f3df9a25f093fd8299aaa44af2c44ca0c0150`

`amenity_set.1` — `[AM1 "Still Water Service" 500 USD]`:

- Canonical bytes (138): `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a311e69302e69641f553a31313131313131313131313134313131383131313131313131313131313131311e69302e6e616d651f543a5374696c6c20576174657220536572766963651e69302e70726963651f493a3530301e69302e63757272656e63791f543a5553441e`
- SHA-256: `f033d6adede866fc472b571f1fcaa2f06400d902cc24ea526cc95a562234dce1`

`amenity_set.2` — `[AM1 "Still Water Service" 500 USD, AM2 "Executive Newspaper Selection" 0 USD]`:

- Canonical bytes (250): `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a321e69302e69641f553a31313131313131313131313134313131383131313131313131313131313131311e69302e6e616d651f543a5374696c6c20576174657220536572766963651e69302e70726963651f493a3530301e69302e63757272656e63791f543a5553441e69312e69641f553a32323232323232323232323234323232383232323232323232323232323232321e69312e6e616d651f543a457865637574697665204e65777370617065722053656c656374696f6e1e69312e70726963651f493a301e69312e63757272656e63791f543a5553441e`
- SHA-256: `8fc00866ed452d25121ede2c61dee704063934fa65b707aa2f021907b41c35c2`

### G.4 Booking fixtures

Passenger (literal): `PAX = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.

`booking.V1` — sedan / standard / no amenities:

- `booking_id = b0000001-0000-4000-8000-000000000001`
- `ride_type = "sedan"`, `service_context = "standard"`
- `pickup_time = "2026-08-01T14:00:00Z"`
- `distance_km_e3 = 12500`
- `base_price_cents = 8500`, `amenity_total_cents = 0`,
  `total_price_cents = 8500`, `currency = "USD"`
- Canonical bytes (621): `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030311e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a736564616e1e736572766963655f636f6e746578741f543a7374616e646172641e7069636b75705f74696d651f543a323032362d30382d30315431343a30303a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e636c61737369666965721f483a666664383733373066613335363131653630323739363234656139316238383631643361353563343964616263393264313765323130643933666566643164341e64697374616e63655f6b6d5f65331f493a31323530301e626173655f70726963655f63656e74731f493a383530301e616d656e6974795f746f74616c5f63656e74731f493a301e746f74616c5f70726963655f63656e74731f493a383530301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a643463383932653739326163663533303761626637336131646334663364663961323566303933666438323939616161343461663263343463613063303135301e`
- SHA-256: `2c45504dcec2f6f60ce783bce8d9e3191e837d4b767c20805e644133110dfc49`

`booking.V2` — suv / airport / one paid amenity:

- `booking_id = b0000001-0000-4000-8000-000000000002`
- `ride_type = "suv"`, `service_context = "airport"`
- `pickup_time = "2026-08-02T09:30:00Z"`
- `distance_km_e3 = 14200`
- `base_price_cents = 12000`, `amenity_total_cents = 500`,
  `total_price_cents = 12500`, `currency = "USD"`
- Canonical bytes (622): `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030321e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a7375761e736572766963655f636f6e746578741f543a616972706f72741e7069636b75705f74696d651f543a323032362d30382d30325430393a33303a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a643931366166376230383265316131313937646662366434653230353963313539663436633436393335613234666330326232613430303863303764643233311e636c61737369666965721f483a643535636333343863396137346231373830623939666136616436353934333730643963316138386464376662313366633337613733383263323337613262341e64697374616e63655f6b6d5f65331f493a31343230301e626173655f70726963655f63656e74731f493a31323030301e616d656e6974795f746f74616c5f63656e74731f493a3530301e746f74616c5f70726963655f63656e74731f493a31323530301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a663033336436616465646538363666633437326235373166316663616132663036343030643930326363323465613532366363393561353632323334646365311e`
- SHA-256: `c1889215ddd360e32f181add2609693033a9ae5d02288c48b1f5860288344709`

`booking.V3` — sedan / standard / paid + complimentary amenity:

- `booking_id = b0000001-0000-4000-8000-000000000003`
- `ride_type = "sedan"`, `service_context = "standard"`
- `pickup_time = "2026-08-03T18:15:00Z"`
- `distance_km_e3 = 12500`
- `base_price_cents = 8500`, `amenity_total_cents = 500`,
  `total_price_cents = 9000`, `currency = "USD"`
- Canonical bytes (623): `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030331e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a736564616e1e736572766963655f636f6e746578741f543a7374616e646172641e7069636b75705f74696d651f543a323032362d30382d30335431383a31353a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e636c61737369666965721f483a666664383733373066613335363131653630323739363234656139316238383631643361353563343964616263393264313765323130643933666566643164341e64697374616e63655f6b6d5f65331f493a31323530301e626173655f70726963655f63656e74731f493a383530301e616d656e6974795f746f74616c5f63656e74731f493a3530301e746f74616c5f70726963655f63656e74731f493a393030301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a386663303038363665643435326432353132316564653263363164656537303430363339333466613635623730376161326630323139303762343163333563321e`
- SHA-256: `0da89bc9eb7ec9bd7a53aa4f2f6c503585cdf64dd9f9e2b3e673ebff7e5177c8`

These fixtures MUST be reproduced exactly in the migration test
harness. Any deviation is a blocker.

## H. Amenity RPCs — signatures and semantics

### H.1 v2 (new, canonical)

```
public.set_booking_amenities_v2(
  _booking_id  uuid,
  _amenity_ids uuid[]
) RETURNS TABLE (
  contract_version   smallint,
  content_digest     bytea,
  amenity_total_cents integer,
  total_price_cents  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
```

Authorization: caller must be the booking owner
(`bookings.user_id = auth.uid()`) or an admin
(`public.has_role(auth.uid(), 'admin')`). Booking must not be in
`cancelled` or `completed`. On refusal, raise
`insufficient_privilege`.

Diff-based idempotent mutation (preserves historical snapshots):

1. `SELECT ... FOR UPDATE` the parent `bookings` row.
2. Read current `booking_amenities` rows for the booking into
   `existing_ids`.
3. Deduplicate `_amenity_ids` (server-side); reject if the deduped
   set contains any id not present as `active = true` in
   `amenity_options`.
4. Compute `to_add   = requested \ existing`
   and    `to_remove = existing  \ requested`.
5. For each `id ∈ to_add`: `INSERT` a new `booking_amenities` row,
   snapshotting **from the current catalog** (`amenity_name`,
   `price_delta_cents`, `currency`, `complimentary`,
   `amenity_option_id`).
6. For each `id ∈ to_remove`: `DELETE` the matching
   `booking_amenities` row.
7. Rows whose `amenity_option_id` is unchanged are **not touched**.
   Their `amenity_name` and `price_delta_cents` snapshots are
   preserved verbatim — later catalog price changes never mutate
   historical snapshots.
8. Recompute `amenity_total_cents` from the resulting
   `booking_amenities` rows (excluding complimentary).
9. Recompute `total_price_cents = base_price_cents + amenity_total_cents`.
10. Recompute `amenity_set_digest`, then `content_digest` (from a
    composite argument built inline — see §F). Increment
    `contract_version`. Set `content_digest_updated_at = now()`.
11. If the booking was `quarantined` and no blocking reasons remain
    open after this mutation, transition `contract_state` to
    `ready`. Otherwise leave `contract_state` unchanged.

### H.2 v1 wrapper (exact existing signature preserved)

```
public.set_booking_amenities(
  _booking_id  uuid,
  _amenity_ids uuid[]
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 1
  FROM public.set_booking_amenities_v2(_booking_id, _amenity_ids);
  SELECT;  -- void return
$$;
```

The v1 body performs no direct DML on `booking_amenities`. It exists
solely to preserve the current call site contract used by
`src/lib/amenities.functions.ts` (`setBookingAmenities`).

`GRANT EXECUTE ON FUNCTION public.set_booking_amenities(uuid, uuid[])
TO authenticated;` and `... _v2(uuid, uuid[]) TO authenticated;`.

## I. Zero-duplicate gate and global uniqueness

Duplicate `(booking_id, amenity_option_id)` rows in
`booking_amenities` are treated as an integrity defect, never
auto-merged.

Stage M-1 (schema) adds the unique index conditionally, after M-2's
preflight has quarantined any duplicate-carrying booking:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  booking_amenities_booking_amenity_uniq
  ON public.booking_amenities (booking_id, amenity_option_id);
```

M-2 preflight: any booking whose `booking_amenities` group has
`COUNT(*) > COUNT(DISTINCT amenity_option_id)` for a given
`amenity_option_id` is quarantined with catalog reason
`amenity_duplicate_snapshot` (`blocks_checkout = true`,
`blocks_digest = true`). No row is deleted or merged automatically;
an admin RPC (§M.4) resolves.

Index creation in M-4 is gated on: `SELECT COUNT(*) = 0 FROM
duplicate_preflight_view`. If nonzero, migration fails fast.

## J. Quarantine tri-table model

`booking_contract_quarantine_reason_catalog` (RPC-mutable only):

- `code text PRIMARY KEY` (e.g. `amenity_duplicate_snapshot`)
- `description text NOT NULL`
- `blocks_checkout   boolean NOT NULL`
- `blocks_digest     boolean NOT NULL`
- `blocks_activation boolean NOT NULL`
- `active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`

`booking_contract_quarantine_cases`:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT`
- `state text NOT NULL CHECK (state IN ('open','resolved','dismissed'))`
- `opened_at   timestamptz NOT NULL DEFAULT now()`
- `resolved_at timestamptz NULL`
- `resolved_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT`
- `resolution_notes text NULL`
- `UNIQUE (booking_id) WHERE state = 'open'`  -- partial unique index

`booking_contract_quarantine_case_reasons`:

- `case_id uuid NOT NULL REFERENCES ...cases(id) ON DELETE RESTRICT`
- `reason_code text NOT NULL REFERENCES ...reason_catalog(code) ON DELETE RESTRICT`
- `evidence jsonb NOT NULL`
- `actor uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `PRIMARY KEY (case_id, reason_code)`

All FKs from case → booking, case_reason → case, case_reason → reason
catalog use `ON DELETE RESTRICT`. Evidence, actors, timestamps, and
resolution history are preserved.

Concurrency: admin resolution takes `SELECT ... FOR UPDATE` on the
case row, then updates and appends resolution notes atomically.

Case identity: `cases.id` is stable across reopen/close cycles by
opening a **new** case row; the prior case's `id` is never mutated
or reused. Passengers with recurring issues therefore have a full
case timeline.

## K. Backfill stages (staged, resumable, idempotent)

- **Stage M-1 (Additive Schema).** Add all columns/tables from §C
  and §J. No constraints beyond `NOT NULL` on already-safe values.
  Zero writes to existing rows.
- **Stage M-2 (Preflight and Quarantine).** Read-only classifier
  scan: identify duplicate amenity snapshots, missing addresses,
  missing distance, currency mismatches. Open quarantine cases for
  affected bookings with the appropriate catalog reasons. Idempotent
  by `(booking_id, reason_code)` upsert-into-open-case.
- **Stage M-3 (Deterministic Backfill).** For each booking without
  open blocking reasons, populate additive columns using the
  deterministic tier ladder in §L. Idempotent: only rows with
  `contract_state IS NULL` are considered; on completion set
  `contract_state = 'ready'` and write digests.
- **Stage M-4 (Validation Gates and Constraints).** Verify: zero
  duplicate snapshots; every `contract_state = 'ready'` row has all
  digests populated and `total = base + amenity_total`; every open
  quarantine case has ≥ 1 reason. Then create the unique index from
  §I and add `CHECK (contract_state IN ('draft','ready','quarantined'))`.

Every stage is resumable: rerunning it is a no-op on rows already at
their target state. Every stage is transactional per booking, not per
migration.

## L. Deterministic backfill tiers (DB-only)

No Stripe API calls, no webhook edits, no invented Stripe evidence.

For each booking:

- **Tier A — Unpaid contract-ready.** Booking has
  `paid_at IS NULL`, `booking_amenities` rows exist, and each row's
  `price_delta_cents` and `amenity_name` are non-null. Derive
  `amenity_total_cents` from `booking_amenities` (excl.
  complimentary). Derive `base_price_cents = COALESCE(bookings.price,
  bookings.suggested_price) - amenity_total_cents` **only if** that
  subtraction is `>= 0`. Otherwise quarantine with
  `base_price_derivation_impossible`.
- **Tier B — Unpaid, no amenities.** `paid_at IS NULL` and no
  `booking_amenities` rows. `amenity_total_cents = 0`;
  `base_price_cents = COALESCE(bookings.price, bookings.suggested_price)`;
  `total_price_cents = base_price_cents`.
- **Tier C — Paid, no amenities.** `paid_at IS NOT NULL` and no
  `booking_amenities` rows. Same as Tier B; the absence of amenity
  rows is authoritative evidence that no amenity fees are folded
  into `bookings.price`.
- **Tier D — Paid, amenities present.** `paid_at IS NOT NULL` and
  ≥ 1 `booking_amenities` row exists. The database cannot prove
  whether `bookings.price` already includes amenity fees. **Never**
  fabricate a base/amenity split. Quarantine with
  `paid_base_split_unprovable` (`blocks_checkout = true`,
  `blocks_activation = true`). Resolution is a manual admin task in
  Batch 2B when Stripe line-item evidence is available.

`bookings.price` is not renamed, moved, or reinterpreted in any tier.
It remains the legacy total.

`currency` is populated from `bookings.currency` if present, else
defaulted to `'USD'` (repository default). If a booking presents a
currency mismatch between amenity rows and the parent, quarantine
with `currency_inconsistent`.

## M. Admin and passenger RPC surface (complete)

All are `SECURITY DEFINER`, `OWNER = postgres`, `SET search_path =
pg_catalog, public`. All grants are explicit; none use `PUBLIC`.

Passenger:

- `public.set_booking_amenities(uuid, uuid[])` → v1 wrapper (§H.2).
  `GRANT EXECUTE TO authenticated;`
- `public.set_booking_amenities_v2(uuid, uuid[])` → §H.1.
  `GRANT EXECUTE TO authenticated;`

Admin:

- `public.admin_quarantine_open_case(_booking_id uuid,
    _reasons text[], _evidence jsonb, _notes text)` → uuid (case id).
  Opens or extends the single open case for the booking; upserts
  per-reason rows. `GRANT EXECUTE TO authenticated;` (authorization
  checks `has_role('admin')` internally.)
- `public.admin_quarantine_add_reason(_case_id uuid,
    _reason_code text, _evidence jsonb)` → void.
- `public.admin_quarantine_resolve_case(_case_id uuid,
    _resolution text, _notes text)` → void. Locks row, verifies no
  unresolved reasons that require further evidence, sets
  `state='resolved'`, `resolved_at=now()`, `resolved_by=auth.uid()`,
  triggers a `contract_state` re-evaluation for the booking.
- `public.admin_backfill_run_stage(_stage text)` → jsonb (counts).
  Executes M-2/M-3/M-4 idempotently on a bounded batch.
- `public.admin_recompute_content_digest(_booking_id uuid)` → bytea.

Grants to `service_role` are added only for
`admin_backfill_run_stage` and `admin_recompute_content_digest` so
that operational scripts can run without a human session.

There is **no** generic "admin direct DML" path. Any operation on
`booking_amenities` or the quarantine tables goes through one of the
RPCs above.

## N. Checkout activation gate

`src/lib/payments.functions.ts` → `createBookingCheckout` MUST refuse
to create a Stripe Checkout Session unless both:

1. `bookings.contract_state = 'ready'`, and
2. no `booking_contract_quarantine_cases` row exists for the booking
   with `state = 'open'` AND at least one linked
   `booking_contract_quarantine_case_reasons` row whose catalog entry
   has `blocks_checkout = true`.

The check runs as a single `SECURITY DEFINER` RPC
`public.can_book_checkout(_booking_id uuid) RETURNS boolean` so the
client cannot forge the decision. Batch 2A does not change the
Stripe webhook, does not add lease logic, does not call the Stripe
API from any new path, and does not add payment-evidence RPC calls
from the webhook.

## O. Invariants (enforced by trigger, not by "bypass")

A single `BEFORE INSERT OR UPDATE` trigger on `bookings`, owned by
`postgres`, enforces:

- `total_price_cents = base_price_cents + amenity_total_cents` when
  all three are non-null.
- `content_digest` length is 32 bytes when set.
- `contract_state IN ('draft','ready','quarantined')` when set.
- Transitions: `draft → ready`, `draft → quarantined`,
  `ready → quarantined`, `quarantined → ready`. `ready → draft` is
  forbidden.

Because direct DML on `booking_amenities` is revoked (§D), the
trigger does not need any bypass mechanism to run correctly during
RPC-driven mutations.

## P. Rollback policy (mandatory correction #12)

Once **any** row exists that has been normalized, digested,
quarantined, reconciled, consolidated, or referenced by audit
evidence, rollback is **non-destructive only**. Destructive
`DROP TABLE` / `DROP COLUMN` / `TRUNCATE` recipes present in earlier
revisions are **removed**.

- **Pre-production zero-write window (verified).** If the migration
  has been applied but no application traffic has written to any new
  column, table, or case row (verified by `SELECT COUNT(*) = 0` on
  every new table AND `content_digest_updated_at IS NULL FOR ALL
  bookings`), a destructive rollback is permitted: drop the new
  triggers, drop the RPCs, drop the new tables, drop the additive
  columns, revoke the new grants.
- **All other windows (default).** Rollback is forward-fix only:
  1. Feature-disable the checkout gate by having
     `can_book_checkout` return `true` unconditionally (single-line
     RPC edit; instantly reversible).
  2. Feature-disable amenity mutation invariants by pointing
     `set_booking_amenities` (v1) at a legacy shim that writes
     `booking_amenities` directly under a temporary `SECURITY
     DEFINER` grant, while leaving digests untouched. (Nullable
     digest columns tolerate this.)
  3. Halt backfill stages by revoking `EXECUTE` on
     `admin_backfill_run_stage`.
  4. Preserve every quarantine case, case reason, evidence row,
     digest, and audit entry. Never drop or truncate them.
  5. Ship a forward-fix migration that resolves the root cause.

Every new column is nullable. Every new RPC has a "disable" path
that does not drop schema. Every FK on evidence uses `ON DELETE
RESTRICT` so a partial rollback cannot orphan or destroy evidence.

## Q. Mutation matrix for `bookings` (complete)

Only these paths may modify columns added or normalized by Batch 2A:

| Column                         | Writer(s)                                        |
|--------------------------------|--------------------------------------------------|
| `service_context`              | M-2, M-3, `set_booking_amenities_v2`             |
| `contract_state`               | M-3, resolve/quarantine RPCs, amenity RPC v2     |
| `contract_version`             | `set_booking_amenities_v2`, `admin_recompute_content_digest` |
| `content_digest`               | same as above                                    |
| `classifier_digest`            | M-3, address-change RPC (not in 2A → NULL only)  |
| `pickup_addr_digest`           | M-3                                              |
| `dropoff_addr_digest`          | M-3                                              |
| `amenity_set_digest`           | `set_booking_amenities_v2`, M-3                  |
| `base_price_cents`             | M-3 tiers A/B/C only                             |
| `amenity_total_cents`          | M-3, `set_booking_amenities_v2`                  |
| `total_price_cents`            | M-3, `set_booking_amenities_v2`                  |
| `currency`                     | M-3 only                                         |
| `content_digest_updated_at`    | `set_booking_amenities_v2`, M-3                  |
| `bookings.price` (legacy)      | untouched by Batch 2A                            |

The Stripe webhook writes only `paid_at` and existing status fields,
exactly as today.

## R. Test harness (planning-only, executed in 2A implementation turn)

- Reproduce every fixture in §G byte-for-byte and hash-for-hash.
- Property test: for every booking, applying
  `set_booking_amenities_v2(existing_ids)` is a no-op on the child
  table (diff empty) and increments `contract_version` by exactly 0
  (no-op fast path) — this is asserted, not assumed.
- Property test: adding then removing the same amenity id restores
  `content_digest` and `amenity_set_digest` to the pre-mutation
  bytes.
- Property test: `set_booking_amenities` (v1) and
  `set_booking_amenities_v2` produce identical post-state for
  identical inputs.
- Direct DML negative test: as `authenticated`,
  `INSERT INTO booking_amenities …` must fail with
  `permission denied`.
- Checkout gate negative test: a booking with an open blocking
  quarantine reason must cause `createBookingCheckout` to raise.

## S. Sequence summary

1. **M-1** — Additive schema, tri-table quarantine, revoke child DML,
   create RPCs (empty bodies where safe), grants. No writes.
2. **M-2** — Preflight scan opens quarantine cases; deterministic.
3. **M-3** — Backfill tiers A/B/C; Tier D auto-quarantines.
4. **M-4** — Validation gates + unique index + CHECK constraints.
5. Passenger checkout gate enabled after M-4 succeeds in shadow
   mode against production data.

---

PLAN STATUS: REVISION 2.7 — FINAL BATCH 2A BLOCKERS CORRECTED

IMPLEMENTATION STATUS: BLOCKED — AWAITING CODEX REVIEW
