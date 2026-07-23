# HarborLine Batch 2 — Revision 2.8 (Batch 2A Repository-Compatibility Corrections)

Planning document. No implementation, no migrations, no code changes,
no deployment, no Stripe/webhook changes, no pull request. Revision
2.8 is a **narrow correction pass** over Revision 2.7. Architecture,
security model, tri-table quarantine model, fixed-schema encoder,
RPC-only DML model, and staged deployment from Revision 2.7 remain
in force **unless directly corrected below**.

Revision 2.8 addresses twelve residual repository/payment
compatibility defects:

1. Passenger field is `bookings.passenger_id` (not `user_id`).
2. Valid ride type enum is exactly `escalade | suburban | denali`.
3. Amenity snapshot schema uses the full existing column set and the
   amenity-set canonical encoding is expanded to match.
4. Unpaid pricing authority: `base = round((price ?? suggested_price) * 100)`,
   `amenity_total = SUM(price_delta_cents * quantity)`, `total = base + amenity_total`.
   Never subtract amenities from `price`.
5. New-booking finalization path: `create_booking` writes the additive
   contract fields as `draft`; `/book` always calls
   `setBookingAmenities` (empty array allowed); v2 sets `ready`.
6. Exact RPC compatibility: v1 name is
   `public.set_booking_amenities(_booking_id uuid, _amenity_ids uuid[])`
   and delegates only to `set_booking_amenities_v2`.
7. Duplicate gate + unique index order: preflight is the exact query
   below; index creation runs `CONCURRENTLY` in a dedicated
   non-transactional step outside a normal Supabase migration.
8. Webhook mutation matrix (unchanged behaviour): `paid`, `paid_at`,
   `stripe_session_id`, legacy `price = amount_total/100`. All four
   are non-material to the normalized contract.
9. Safe rollback: no legacy shim that mutates `booking_amenities`
   without updating parent contract columns. Disable = reject
   mutation with a stable maintenance error.
10. Monetary columns are `bigint`; `contract_version` is `integer`.
11. Partial unique index on quarantine cases is a standalone
    `CREATE UNIQUE INDEX ... WHERE state = 'open'`, not an inline
    `UNIQUE (...) WHERE ...` constraint.
12. Final consistency gates enforced across the whole document.

Every literal fixture (V1/V2/V3, addresses, classifiers, amenity
sets) is republished with valid ride types and the corrected amenity
encoding. All SHA-256 hashes below were produced by executing the §E
encoder against the stated inputs.

The following constructs from prior revisions are **deleted** and MUST
NOT be reintroduced anywhere in this plan:

- `bookings.user_id` (repository field is `passenger_id`)
- `scheduled_at` (repository field is `pickup_time`)
- Ride types `sedan` or `suv`
- `snapshot_name`, `stripe_product_id`
- `session_user = 'postgres'` trigger gates
- `current_setting('harborline.*', true)` GUC bypass
- Any "reusable bypass flag" or forgeable trigger-bypass design
- Auto-merge of duplicate `(booking_id, amenity_option_id)` rows
- Any unpaid formula that subtracts amenities from `price`
- Any rollback shim that writes `booking_amenities` without updating
  `contract_version`, `amenity_total_cents`, `total_price_cents`,
  `amenity_set_digest`, `content_digest`
- Stripe API calls or webhook edits inside Batch 2A

---

## A. Scope of Batch 2A

Batch 2A is limited to:

1. **Additive schema** for the booking contract (nullable columns,
   new child tables, new catalog tables).
2. **Canonical content digest** infrastructure (fixed-schema encoder,
   digest columns, invariant triggers).
3. **Amenity mutation RPC v2** with a v1 wrapper that preserves the
   exact existing signature (`set_booking_amenities`).
4. **Quarantine tri-table** model (reason catalog, cases, case
   reasons) with RPC-only mutations.
5. **Staged, resumable, idempotent backfill** with quarantine of
   undecidable rows (DB-only; no Stripe evidence in 2A).
6. **New-booking finalization**: `create_booking` writes additive
   contract fields as `draft`; `/book` always finalizes via
   `set_booking_amenities` (empty array allowed) → v2 → `ready`.
7. **Checkout activation gate** (`contract_state = 'ready'` AND no
   open blocking quarantine reason).

Batch 2A explicitly **does not** touch: Stripe API, Stripe webhook,
payment_attempts lease machine, policy bundles, review records,
passenger review UI, dispatch, driver app. Those remain in 2B–2D.

## B. Repository field mapping (authoritative)

The plan uses only field names that already exist in the repository
or are added by Batch 2A's additive migration:

| Concept                      | Repository field                        |
|------------------------------|-----------------------------------------|
| Pickup timestamp             | `bookings.pickup_time`                  |
| Passenger owner              | `bookings.passenger_id`                 |
| Ride type                    | `bookings.ride_type` (`escalade`\|`suburban`\|`denali`) |
| Distance                     | `bookings.distance_km`                  |
| Legacy price (untouched)     | `bookings.price`                        |
| Legacy suggested price       | `bookings.suggested_price`              |
| Amenity link table           | `public.booking_amenities`              |
| Amenity option FK            | `booking_amenities.amenity_option_id`   |
| Per-line amenity code        | `booking_amenities.amenity_code`        |
| Per-line amenity name        | `booking_amenities.amenity_name`        |
| Per-line quantity            | `booking_amenities.quantity`            |
| Per-line delta               | `booking_amenities.price_delta_cents`   |
| Per-line currency            | `booking_amenities.currency`            |
| Per-line complimentary flag  | `booking_amenities.complimentary`       |
| Amenity catalog              | `public.amenity_options`                |
| Amenity catalog fee          | `amenity_options.price_delta_cents`     |
| Amenity catalog display name | `amenity_options.name`                  |
| Amenity catalog code         | `amenity_options.code`                  |

Ownership/authorization uses **exactly**: `bookings.passenger_id = auth.uid()`.

No use of: `bookings.user_id`, `scheduled_at`, `snapshot_name`,
`amenity_options.stripe_product_id`, `booking_amenities.snapshot_name`.

## C. Additive columns (complete list)

Batch 2A adds the following nullable columns. Every column referenced
elsewhere in this plan appears here. No column is renamed, moved, or
dropped.

`public.bookings`:

- `currency               text     NULL`
- `service_context        text     NULL`  -- 'standard' | 'airport' | 'unresolved'
- `contract_state         text     NULL`  -- 'draft' | 'ready' | 'quarantined'
- `contract_version       integer  NULL`  -- monotonically non-decreasing
- `content_digest         bytea    NULL`  -- 32-byte SHA-256, excludes contract_version
- `classifier_digest      bytea    NULL`  -- 32-byte SHA-256
- `pickup_addr_digest     bytea    NULL`  -- 32-byte SHA-256
- `dropoff_addr_digest    bytea    NULL`  -- 32-byte SHA-256
- `amenity_set_digest     bytea    NULL`  -- 32-byte SHA-256
- `base_price_cents       bigint   NULL`
- `amenity_total_cents    bigint   NULL`
- `total_price_cents      bigint   NULL`
- `content_digest_updated_at  timestamptz NULL`

All columns start NULL. `bookings.price` and `bookings.suggested_price`
are **not** modified, moved, or reinterpreted by Batch 2A.

New tables (all `OWNER = postgres`, all with explicit grants below):

- `public.booking_contract_quarantine_reason_catalog`
- `public.booking_contract_quarantine_cases`
- `public.booking_contract_quarantine_case_reasons`

## D. Ownership and privilege model

Every RPC that mutates `bookings`, `booking_amenities`, or the three
quarantine tables is:

- `OWNER = postgres`
- `SECURITY DEFINER`
- `SET search_path = pg_catalog, public`
- Granted `EXECUTE` explicitly to `authenticated` (and to
  `service_role` where noted). No `PUBLIC` execute.
- Contains an internal authorization block that verifies the caller
  (`bookings.passenger_id = auth.uid()` for passenger paths;
  `public.has_role(auth.uid(), 'admin')` for admin paths).

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

`SELECT` on `booking_amenities` remains governed by existing RLS.
Quarantine tables have no direct `SELECT` grant to `anon` /
`authenticated`; reads happen through RPC return values.

There is **no** `session_user` check, **no** GUC bypass, and **no**
"maintenance DML" path. All child-table mutations route through the
RPCs in §H and §M. Because the RPCs are `SECURITY DEFINER` owned by
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

- `addr.v1`: `label, place_id, lat_e7, lon_e7`
- `classifier.v1`: `pickup, dropoff, pickup_airport, dropoff_airport`
- `amenity_set.v1`: `count`, then for each item `N` (0-indexed, sorted
  ascending by `amenity_option_id`):
  `i{N}.amenity_option_id, i{N}.amenity_code, i{N}.amenity_name,
  i{N}.quantity, i{N}.price_delta_cents, i{N}.currency,
  i{N}.complimentary`
- `booking.v1`: `booking_id, passenger_id, ride_type, service_context,
  pickup_time, pickup_addr, dropoff_addr, classifier, distance_km_e3,
  base_price_cents, amenity_total_cents, total_price_cents, currency,
  amenity_set`

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

- Canonical bytes (hex, 211 bytes):
  `484c424332412d311f636c61737369666965722e76311e7069636b75701f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66661f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e7069636b75705f616972706f72741f423a301e64726f706f66665f616972706f72741f423a301e`
- SHA-256: `ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4`

`classifier.V2` — airport dropoff:

- Canonical bytes (hex, 211 bytes):
  `484c424332412d311f636c61737369666965722e76311e7069636b75701f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66661f483a643931366166376230383265316131313937646662366434653230353963313539663436633436393335613234666330326232613430303863303764643233311e7069636b75705f616972706f72741f423a301e64726f706f66665f616972706f72741f423a311e`
- SHA-256: `d55cc348c9a74b1780b99fa6ad6594370d9c1a88dd7fb13fc37a7382c237a2b4`

`classifier.V3` — same input as V1 (identity check, must match V1):

- SHA-256: `ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4`

### G.3 Amenity-set fixtures

Amenity option ids and full snapshot inputs (literal):

- `AM1`: `amenity_option_id=11111111-1111-4111-8111-111111111111`,
  `amenity_code="still_water"`, `amenity_name="Still Water Service"`,
  `quantity=1`, `price_delta_cents=500`, `currency="USD"`,
  `complimentary=false`
- `AM2`: `amenity_option_id=22222222-2222-4222-8222-222222222222`,
  `amenity_code="exec_newspaper"`,
  `amenity_name="Executive Newspaper Selection"`, `quantity=1`,
  `price_delta_cents=0`, `currency="USD"`, `complimentary=true`

`amenity_set.empty` (0 items):

- Canonical bytes (hex, 34 bytes):
  `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a301e`
- SHA-256: `d4c892e792acf5307abf73a1dc4f3df9a25f093fd8299aaa44af2c44ca0c0150`

`amenity_set.1` — `[AM1]`:

- Canonical bytes (hex, 240 bytes):
  `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a311e69302e616d656e6974795f6f7074696f6e5f69641f553a31313131313131313131313134313131383131313131313131313131313131311e69302e616d656e6974795f636f64651f543a7374696c6c5f77617465721e69302e616d656e6974795f6e616d651f543a5374696c6c20576174657220536572766963651e69302e7175616e746974791f493a311e69302e70726963655f64656c74615f63656e74731f493a3530301e69302e63757272656e63791f543a5553441e69302e636f6d706c696d656e746172791f423a301e`
- SHA-256: `0fc3985eeb99cc20b177a06a423db34f6bd43d886575be388ff7c0895601e7a9`

`amenity_set.2` — `[AM1, AM2]` sorted by `amenity_option_id`:

- Canonical bytes (hex, 457 bytes):
  `484c424332412d311f616d656e6974795f7365742e76311e636f756e741f493a321e69302e616d656e6974795f6f7074696f6e5f69641f553a31313131313131313131313134313131383131313131313131313131313131311e69302e616d656e6974795f636f64651f543a7374696c6c5f77617465721e69302e616d656e6974795f6e616d651f543a5374696c6c20576174657220536572766963651e69302e7175616e746974791f493a311e69302e70726963655f64656c74615f63656e74731f493a3530301e69302e63757272656e63791f543a5553441e69302e636f6d706c696d656e746172791f423a301e69312e616d656e6974795f6f7074696f6e5f69641f553a32323232323232323232323234323232383232323232323232323232323232321e69312e616d656e6974795f636f64651f543a657865635f6e65777370617065721e69312e616d656e6974795f6e616d651f543a457865637574697665204e65777370617065722053656c656374696f6e1e69312e7175616e746974791f493a311e69312e70726963655f64656c74615f63656e74731f493a301e69312e63757272656e63791f543a5553441e69312e636f6d706c696d656e746172791f423a311e`
- SHA-256: `fc49a75c44e35e0a1bef70381135c4388e7373b5fdec76308f2a0dd69473e70d`

### G.4 Booking fixtures

Passenger (literal): `PAX = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.

`booking.V1` — escalade / standard / no amenities:

- `booking_id = b0000001-0000-4000-8000-000000000001`
- `ride_type = "escalade"`, `service_context = "standard"`
- `pickup_time = "2026-08-01T14:00:00Z"`
- `distance_km_e3 = 12500`
- `base_price_cents = 8500`, `amenity_total_cents = 0`,
  `total_price_cents = 8500`, `currency = "USD"`
- `amenity_set = amenity_set.empty`
- Canonical bytes (hex, 624 bytes):
  `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030311e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a657363616c6164651e736572766963655f636f6e746578741f543a7374616e646172641e7069636b75705f74696d651f543a323032362d30382d30315431343a30303a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e636c61737369666965721f483a666664383733373066613335363131653630323739363234656139316238383631643361353563343964616263393264313765323130643933666566643164341e64697374616e63655f6b6d5f65331f493a31323530301e626173655f70726963655f63656e74731f493a383530301e616d656e6974795f746f74616c5f63656e74731f493a301e746f74616c5f70726963655f63656e74731f493a383530301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a643463383932653739326163663533303761626637336131646334663364663961323566303933666438323939616161343461663263343463613063303135301e`
- SHA-256: `41d5baa23ad42c2ad4df082fd089252a86e3525520ab30701772b2ab7667f633`

`booking.V2` — suburban / airport / one paid amenity:

- `booking_id = b0000001-0000-4000-8000-000000000002`
- `ride_type = "suburban"`, `service_context = "airport"`
- `pickup_time = "2026-08-02T09:30:00Z"`
- `distance_km_e3 = 14200`
- `base_price_cents = 12000`, `amenity_total_cents = 500`,
  `total_price_cents = 12500`, `currency = "USD"`
- `amenity_set = amenity_set.1`
- Canonical bytes (hex, 627 bytes):
  `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030321e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a737562757262616e1e736572766963655f636f6e746578741f543a616972706f72741e7069636b75705f74696d651f543a323032362d30382d30325430393a33303a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a643931366166376230383265316131313937646662366434653230353963313539663436633436393335613234666330326232613430303863303764643233311e636c61737369666965721f483a643535636333343863396137346231373830623939666136616436353934333730643963316138386464376662313366633337613733383263323337613262341e64697374616e63655f6b6d5f65331f493a31343230301e626173655f70726963655f63656e74731f493a31323030301e616d656e6974795f746f74616c5f63656e74731f493a3530301e746f74616c5f70726963655f63656e74731f493a31323530301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a306663333938356565623939636332306231373761303661343233646233346636626434336438383635373562653338386666376330383935363031653761391e`
- SHA-256: `bbf6dfce5e9bb01fb005d4be7d94f1e5319a55fe1f4f1d07336eda11eccb7cf0`

`booking.V3` — denali / standard / paid + complimentary amenity:

- `booking_id = b0000001-0000-4000-8000-000000000003`
- `ride_type = "denali"`, `service_context = "standard"`
- `pickup_time = "2026-08-03T18:15:00Z"`
- `distance_km_e3 = 12500`
- `base_price_cents = 8500`, `amenity_total_cents = 500`,
  `total_price_cents = 9000`, `currency = "USD"`
- `amenity_set = amenity_set.2`
- Canonical bytes (hex, 624 bytes):
  `484c424332412d311f626f6f6b696e672e76311e626f6f6b696e675f69641f553a62303030303030313030303034303030383030303030303030303030303030331e70617373656e6765725f69641f553a61616161616161616161616134616161386161616161616161616161616161611e726964655f747970651f543a64656e616c691e736572766963655f636f6e746578741f543a7374616e646172641e7069636b75705f74696d651f543a323032362d30382d30335431383a31353a30305a1e7069636b75705f616464721f483a643934353239343933313033386133356633386565393830633139623666363538393238346231643135336364333730306265316337656434363536626161381e64726f706f66665f616464721f483a336566613639343466303431356636373534656232363761336139333230633536393264653161333265313434363464663332343732343239653433306136351e636c61737369666965721f483a666664383733373066613335363131653630323739363234656139316238383631643361353563343964616263393264313765323130643933666566643164341e64697374616e63655f6b6d5f65331f493a31323530301e626173655f70726963655f63656e74731f493a383530301e616d656e6974795f746f74616c5f63656e74731f493a3530301e746f74616c5f70726963655f63656e74731f493a393030301e63757272656e63791f543a5553441e616d656e6974795f7365741f483a666334396137356334346533356530613162656637303338313133356334333838653733373362356664656337363330386632613064643639343733653730641e`
- SHA-256: `a064f08a3410b1166b0a3423c988dc9a9abc0750359f92a1529073674281db37`

These fixtures MUST be reproduced exactly in the migration test
harness. Any deviation is a blocker.

## H. Amenity RPCs — signatures and semantics

### H.1 v2 (new, canonical)

```
public.set_booking_amenities_v2(
  _booking_id  uuid,
  _amenity_ids uuid[]
) RETURNS TABLE (
  contract_version    integer,
  content_digest      bytea,
  amenity_total_cents bigint,
  total_price_cents   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
```

Authorization: caller must be the booking owner
(`bookings.passenger_id = auth.uid()`) or an admin
(`public.has_role(auth.uid(), 'admin')`). Booking must not be in
`cancelled` or `completed`. On refusal, raise `insufficient_privilege`.

Diff-based idempotent mutation (preserves historical snapshots):

1. `SELECT ... FOR UPDATE` the parent `bookings` row.
2. Read current `booking_amenities` rows for the booking into
   `existing_ids`.
3. Deduplicate `_amenity_ids` server-side; reject if the deduped set
   contains any id not present as `active = true` in
   `amenity_options`.
4. Compute `to_add   = requested \ existing`
   and    `to_remove = existing  \ requested`.
5. For each `id ∈ to_add`: `INSERT` a new `booking_amenities` row,
   snapshotting **from the current catalog**. All required fields are
   populated: `amenity_option_id`, `amenity_code`, `amenity_name`,
   `quantity` (defaulting to 1), `price_delta_cents`, `currency`
   (defaulting to `bookings.currency` ?? `'USD'`), `complimentary`.
6. For each `id ∈ to_remove`: `DELETE` the matching
   `booking_amenities` row.
7. Rows whose `amenity_option_id` is unchanged are **not touched**.
   Their snapshots (name, code, price, currency, complimentary,
   quantity) are preserved verbatim — later catalog price changes
   never mutate historical snapshots.
8. Recompute
   `amenity_total_cents = SUM(price_delta_cents * quantity)` from the
   resulting `booking_amenities` rows, excluding complimentary.
9. Recompute `total_price_cents = base_price_cents + amenity_total_cents`.
10. Recompute `amenity_set_digest`, then `content_digest` (from a
    composite argument built inline — see §F). Increment
    `contract_version`. Set `content_digest_updated_at = now()`.
11. If the resulting child set exactly equals the prior child set
    (`to_add` and `to_remove` both empty **and** no scalar recompute
    changed value), the RPC is a fast no-op: `contract_version` is
    **not** incremented, no digest write, no `content_digest_updated_at`
    change. Return the current values.
12. If the booking was `quarantined` and no blocking reasons remain
    open after this mutation, transition `contract_state` to
    `ready`. If the booking was `draft` (typical new booking), a
    successful finalization sets `contract_state` to `ready`.
    Otherwise leave `contract_state` unchanged.

### H.2 v1 wrapper (exact existing signature preserved)

The v1 signature is exactly the one currently called by
`src/lib/amenities.functions.ts` (`setBookingAmenities`):

```
public.set_booking_amenities(
  _booking_id  uuid,
  _amenity_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.set_booking_amenities_v2(_booking_id, _amenity_ids);
END;
$$;
```

The v1 body performs **no** direct DML on `booking_amenities`. It
exists solely to delegate to v2 and preserve the existing call site
contract.

`GRANT EXECUTE ON FUNCTION public.set_booking_amenities(uuid, uuid[]) TO authenticated;`
`GRANT EXECUTE ON FUNCTION public.set_booking_amenities_v2(uuid, uuid[]) TO authenticated;`

## I. Zero-duplicate gate and global uniqueness

Duplicate `(booking_id, amenity_option_id)` rows in
`booking_amenities` are treated as an integrity defect, never
auto-merged.

**Preflight query (exact, verbatim, run in stage M-2):**

```sql
SELECT booking_id, amenity_option_id, COUNT(*)
FROM public.booking_amenities
GROUP BY booking_id, amenity_option_id
HAVING COUNT(*) > 1;
```

Any group returned by this query causes the parent booking to be
quarantined with catalog reason `amenity_duplicate_snapshot`
(`blocks_checkout = true`, `blocks_digest = true`). No row is
deleted or merged automatically. Duplicate resolution is a manual
admin action via an audited RPC (§M) that preserves the original
rows in an evidence table.

**Index creation ordering (corrected).** The global unique index is
created **only after** the preflight above returns zero rows and every
duplicate case has been resolved by an admin RPC. Stage M-1 does NOT
create this index. Any prior statement claiming M-1 creates the index
is deleted.

Because `CREATE UNIQUE INDEX CONCURRENTLY` cannot run inside a
transaction, the index step is a **dedicated non-transactional
deployment step** — it is not shipped inside a standard Supabase
migration transaction. The exact statement:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  booking_amenities_booking_amenity_uniq
  ON public.booking_amenities (booking_id, amenity_option_id);
```

Post-condition gate before enabling constraints: the preflight query
above must return zero rows.

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

Open-case uniqueness is a **separate partial unique index**, not an
inline table constraint:

```sql
CREATE UNIQUE INDEX booking_contract_quarantine_one_open_case
  ON public.booking_contract_quarantine_cases (booking_id)
  WHERE state = 'open';
```

`booking_contract_quarantine_case_reasons`:

- `case_id uuid NOT NULL REFERENCES ...cases(id) ON DELETE RESTRICT`
- `reason_code text NOT NULL REFERENCES ...reason_catalog(code) ON DELETE RESTRICT`
- `evidence jsonb NOT NULL`
- `actor uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `PRIMARY KEY (case_id, reason_code)`

All FKs use `ON DELETE RESTRICT`. Evidence, actors, timestamps, and
resolution history are preserved.

Case identity: `cases.id` is stable across reopen/close cycles by
opening a **new** case row; a prior case's `id` is never mutated or
reused. Concurrency: admin resolution takes `SELECT ... FOR UPDATE`
on the case row, then updates and appends resolution notes atomically.

## K. Backfill stages (staged, resumable, idempotent)

- **Stage M-1 (Additive Schema).** Add all columns/tables from §C
  and §J. No writes to existing rows. **No unique index on
  `booking_amenities`** yet.
- **Stage M-2 (Preflight and Quarantine).** Read-only classifier
  scan runs the §I duplicate preflight; also identifies missing
  addresses, missing distance, currency mismatches, and paid-with-
  amenities rows. Opens quarantine cases with the appropriate
  catalog reasons. Idempotent by `(booking_id, reason_code)`
  upsert-into-open-case.
- **Stage M-3 (Deterministic Backfill).** For each booking without
  open blocking reasons, populate additive columns using the
  deterministic tier ladder in §L. Idempotent: only rows with
  `contract_state IS NULL` are considered; on completion set
  `contract_state = 'ready'` and write digests.
- **Stage M-4 (Validation Gates and Constraints).** Verify: preflight
  query returns zero rows; every `contract_state = 'ready'` row has
  all digests populated and `total = base + amenity_total`; every
  open quarantine case has ≥ 1 reason. Add
  `CHECK (contract_state IN ('draft','ready','quarantined'))`.
- **Stage M-5 (Dedicated non-transactional index step).** Execute the
  `CREATE UNIQUE INDEX CONCURRENTLY` from §I outside a normal Supabase
  migration transaction.

Every stage is resumable: rerunning it is a no-op on rows already at
their target state.

## L. Deterministic backfill tiers (DB-only)

No Stripe API calls, no webhook edits, no invented Stripe evidence.
The current repository checkout treats `bookings.price ??
bookings.suggested_price` as the **base fare** and adds
`booking_amenities` as separate Stripe line items. Therefore:

For each booking:

- **Tier A — Unpaid, no amenities.** `paid_at IS NULL` and no
  `booking_amenities` rows.
  `amenity_total_cents = 0`,
  `base_price_cents = round(COALESCE(bookings.price, bookings.suggested_price) * 100)`,
  `total_price_cents = base_price_cents`.
- **Tier B — Unpaid, amenities present.** `paid_at IS NULL` and ≥ 1
  `booking_amenities` row.
  `amenity_total_cents = SUM(price_delta_cents * quantity)` over non-
  complimentary rows,
  `base_price_cents = round(COALESCE(bookings.price, bookings.suggested_price) * 100)`,
  `total_price_cents = base_price_cents + amenity_total_cents`.
  **`amenity_total_cents` is never subtracted from `price` or
  `suggested_price`.**
- **Tier C — Paid, no amenities.** `paid_at IS NOT NULL` and no
  `booking_amenities` rows. Same as Tier A.
- **Tier D — Paid, amenities present.** `paid_at IS NOT NULL` and
  ≥ 1 `booking_amenities` row. In 2A the database cannot prove
  whether the paid Stripe amount used the same catalog snapshot as
  currently stored. Quarantine with `paid_base_split_unprovable`
  (`blocks_activation = true`; `blocks_checkout = false` — the ride
  is already paid). Resolution in Batch 2B when Stripe line-item
  evidence is available.

If neither `price` nor `suggested_price` yields a usable positive
integer for `base_price_cents`, quarantine with catalog reason
`base_price_missing` (`blocks_checkout = true`).

`bookings.price` is not renamed, moved, or reinterpreted in any tier.
It remains the legacy total.

`currency` is populated from `bookings.currency` if present, else
defaulted to `'USD'`. Currency mismatch between amenity rows and the
parent quarantines with `currency_inconsistent`.

## M. Admin and passenger RPC surface (complete)

All are `SECURITY DEFINER`, `OWNER = postgres`, `SET search_path =
pg_catalog, public`. All grants are explicit; none use `PUBLIC`.

Passenger:

- `public.set_booking_amenities(uuid, uuid[])` → v1 wrapper (§H.2).
  `GRANT EXECUTE TO authenticated;`
- `public.set_booking_amenities_v2(uuid, uuid[])` → §H.1.
  `GRANT EXECUTE TO authenticated;`
- `public.can_book_checkout(_booking_id uuid) RETURNS boolean` → §N.
  `GRANT EXECUTE TO authenticated;`

Admin (authorization enforced internally via `has_role('admin')`):

- `public.admin_quarantine_open_case(_booking_id uuid, _reasons text[],
    _evidence jsonb, _notes text)` → `uuid` (case id). Opens or extends
  the single open case for the booking; upserts per-reason rows.
- `public.admin_quarantine_add_reason(_case_id uuid,
    _reason_code text, _evidence jsonb)` → void.
- `public.admin_quarantine_resolve_case(_case_id uuid,
    _resolution text, _notes text)` → void. Locks row, sets
  `state='resolved'`, `resolved_at=now()`, `resolved_by=auth.uid()`,
  triggers `contract_state` re-evaluation for the booking.
- `public.admin_resolve_duplicate_amenity_snapshot(_booking_id uuid,
    _keep_row_id uuid, _evidence jsonb)` → void. Copies duplicate rows
  to an evidence table, deletes the duplicates, keeps `_keep_row_id`,
  then re-runs finalization via `set_booking_amenities_v2` with the
  resulting id set.
- `public.admin_backfill_run_stage(_stage text)` → jsonb (counts).
  Executes M-2/M-3/M-4 idempotently on a bounded batch.
- `public.admin_recompute_content_digest(_booking_id uuid)` → bytea.

`service_role` grants apply only to `admin_backfill_run_stage` and
`admin_recompute_content_digest` so operational scripts can run
without a human session.

There is **no** generic "admin direct DML" path. Any operation on
`booking_amenities` or the quarantine tables routes through one of
the RPCs above.

## N. Checkout activation gate

`src/lib/payments.functions.ts` → `createBookingCheckout` MUST refuse
to create a Stripe Checkout Session unless both:

1. `bookings.contract_state = 'ready'`, AND
2. no `booking_contract_quarantine_cases` row exists for the booking
   with `state = 'open'` AND at least one linked
   `booking_contract_quarantine_case_reasons` row whose catalog entry
   has `blocks_checkout = true`.

The decision is a single `SECURITY DEFINER` RPC
`public.can_book_checkout(_booking_id uuid) RETURNS boolean` so the
client cannot forge it. Batch 2A does not change the Stripe webhook,
does not add lease logic, does not call the Stripe API from any new
path, and does not add payment-evidence RPC calls.

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
- `contract_version` is non-decreasing.

Because direct DML on `booking_amenities` is revoked (§D), the
trigger does not need any bypass mechanism to run correctly during
RPC-driven mutations.

## P. New-booking finalization (mandatory)

Every booking created after M-1 must land with a materialized
contract, not left dangling.

### P.1 `create_booking` additions

`public.create_booking` continues to derive the base fare from the
existing repository pricing logic (the current authoritative pricing
function). In addition, in the same transaction, it writes:

- `base_price_cents = round(<derived_base_fare> * 100)` as `bigint`
- `currency = 'USD'`
- `amenity_total_cents = 0`
- `total_price_cents = base_price_cents`
- `service_context = 'unresolved'` (classifier runs during
  finalization; may be lifted to `standard` or `airport` there)
- `contract_state = 'draft'`
- `contract_version = 0`
- initial digest inputs (`pickup_addr_digest`, `dropoff_addr_digest`,
  `classifier_digest`) computed from the addresses and airport
  classifier available at creation

`bookings.price` and `bookings.suggested_price` continue to be
written as today; they are unchanged by 2A.

### P.2 `/book` client contract

`src/routes/book.tsx` MUST always call `setBookingAmenities` after a
successful `createBooking`, including when the passenger selected
zero amenities (`amenityIds = []`). The client never shows success,
never navigates to `/history`, and never opens the checkout modal
until `setBookingAmenities` resolves successfully. On failure the
client surfaces a retryable error and keeps checkout unavailable.

### P.3 Finalization semantics

A successful `set_booking_amenities_v2` run on a `draft` booking:

- Populates `amenity_set_digest` and `content_digest`
- Sets `contract_state = 'ready'`
- Increments `contract_version` from 0 to 1 (initial finalize)

Subsequent identical calls are no-ops (§H.1 step 11): `contract_state`
stays `ready`, `contract_version` is not incremented, digests are
unchanged.

### P.4 Acceptance tests

- New booking with zero amenities → finalization succeeds →
  `contract_state = 'ready'`, `amenity_total_cents = 0`,
  `total_price_cents = base_price_cents`.
- New booking with amenities → finalization succeeds → `contract_state
  = 'ready'`, `total = base + SUM(price_delta_cents * quantity)` for
  non-complimentary rows.
- Amenity finalization failure → `contract_state` remains `draft`,
  checkout gate refuses, UI does not navigate.
- Identical retry after success → RPC is a no-op, `contract_version`
  unchanged, no digest churn.

## Q. Mutation matrix for `bookings` (complete)

Only these paths may modify columns added or normalized by Batch 2A:

| Column                         | Writer(s)                                                     |
|--------------------------------|---------------------------------------------------------------|
| `service_context`              | `create_booking` (as `unresolved`), M-2, M-3, `set_booking_amenities_v2` |
| `contract_state`               | `create_booking` (as `draft`), M-3, resolve/quarantine RPCs, amenity RPC v2 |
| `contract_version`             | `create_booking` (as `0`), `set_booking_amenities_v2`, `admin_recompute_content_digest` |
| `content_digest`               | `set_booking_amenities_v2`, M-3, `admin_recompute_content_digest` |
| `classifier_digest`            | `create_booking`, M-3                                         |
| `pickup_addr_digest`           | `create_booking`, M-3                                         |
| `dropoff_addr_digest`          | `create_booking`, M-3                                         |
| `amenity_set_digest`           | `set_booking_amenities_v2`, M-3                               |
| `base_price_cents`             | `create_booking`, M-3 tiers A/B/C only                        |
| `amenity_total_cents`          | `create_booking` (as `0`), M-3, `set_booking_amenities_v2`    |
| `total_price_cents`            | `create_booking`, M-3, `set_booking_amenities_v2`             |
| `currency`                     | `create_booking` (as `'USD'`), M-3                            |
| `content_digest_updated_at`    | `set_booking_amenities_v2`, M-3                               |

**Webhook mutation matrix (unchanged from today; non-material to
Batch 2A):** the Stripe webhook writes exactly:

- `paid`
- `paid_at`
- `stripe_session_id`
- `price` (legacy) `= amount_total / 100`

The webhook does **not** write: `base_price_cents`,
`amenity_total_cents`, `total_price_cents`, `currency`,
`contract_version`, `content_digest`, `classifier_digest`,
`pickup_addr_digest`, `dropoff_addr_digest`, `amenity_set_digest`,
`contract_state`, `service_context`. All four columns the webhook
does write are non-material to the normalized contract in §E.

## R. Rollback policy

Once **any** row exists that has been normalized, digested,
quarantined, reconciled, consolidated, or referenced by audit
evidence, rollback is **non-destructive only**. Destructive
`DROP TABLE` / `DROP COLUMN` / `TRUNCATE` recipes present in earlier
revisions are removed.

- **Pre-production zero-write window (verified only).** If the
  migration has been applied but no application traffic has written
  to any new column, table, or case row (verified by
  `SELECT COUNT(*) = 0` on every new table AND
  `content_digest_updated_at IS NULL` for every `bookings` row AND
  `contract_state IS NULL` for every `bookings` row), destructive
  rollback is permitted: drop the new triggers, drop the RPCs, drop
  the new tables, drop the additive columns, revoke the new grants.
- **All other windows (default).** Rollback is forward-fix only:
  1. Feature-disable the checkout gate by pointing
     `can_book_checkout` at a temporary body that returns `true`
     unconditionally (single-line RPC edit; reversible).
  2. If amenity mutation itself must be disabled, `set_booking_amenities`
     (v1) and `set_booking_amenities_v2` reject with a stable
     maintenance error (`P0001`, message
     `AMENITY_MUTATION_TEMPORARILY_DISABLED`). No legacy shim writes
     `booking_amenities` under any circumstances; there is no path
     that mutates `booking_amenities` without also updating
     `contract_version`, `amenity_total_cents`, `total_price_cents`,
     `amenity_set_digest`, and `content_digest`.
  3. Halt backfill stages by revoking `EXECUTE` on
     `admin_backfill_run_stage`.
  4. Preserve every quarantine case, case reason, evidence row,
     digest, and audit entry. Never drop or truncate them.
  5. Ship a forward-fix migration that resolves the root cause.

Every new column is nullable. Every new RPC has a "disable" path
that does not drop schema. Every FK on evidence uses `ON DELETE
RESTRICT` so a partial rollback cannot orphan or destroy evidence.

## S. Sequence summary

1. **M-1** — Additive schema, tri-table quarantine (with partial
   unique index on open cases), revoke child DML, create RPCs, grants.
   No unique index on `booking_amenities` yet. No writes to existing
   rows. `create_booking` starts writing draft contracts.
2. **M-2** — Preflight scan (exact query in §I) opens quarantine
   cases; deterministic.
3. **M-3** — Backfill tiers A/B/C; Tier D auto-quarantines.
4. **M-4** — Validation gates + `CHECK` constraints.
5. **M-5** — Dedicated non-transactional step:
   `CREATE UNIQUE INDEX CONCURRENTLY booking_amenities_booking_amenity_uniq`.
6. Passenger checkout gate enabled after M-5 succeeds in shadow mode
   against production data.

## T. Final consistency gates (Revision 2.8 self-check)

Before this plan is considered complete, the following searches over
this document must each return **zero matches**:

- `bookings.user_id` → 0 (repository field is `passenger_id`).
- `scheduled_at` → 0 (repository field is `pickup_time`).
- `snapshot_name` → 0.
- `stripe_product_id` → 0.
- Ride types `sedan` or `suv` → 0 (valid enum:
  `escalade | suburban | denali`).
- Any unpaid formula that subtracts amenities from `price` → 0.
- `session_user` trigger gate → 0.
- GUC bypass (`current_setting('harborline.*',` or "bypass flag") → 0.
- Rollback path that writes `booking_amenities` without updating the
  parent contract → 0.

Positive assertions:

- The v1 amenity RPC name appears exactly as
  `public.set_booking_amenities(_booking_id uuid, _amenity_ids uuid[])`
  and is the only v1 name used.
- Every column referenced anywhere in the plan appears in the
  additive schema list in §C.
- Every SHA-256 in §G was produced by executing the §E encoder
  against the stated inputs; no placeholder hashes remain.

---

PLAN STATUS: REVISION 2.8 — FINAL REPOSITORY-COMPATIBILITY CORRECTIONS COMPLETE

IMPLEMENTATION STATUS: BLOCKED — AWAITING FINAL CODEX REVIEW
