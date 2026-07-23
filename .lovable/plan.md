# HarborLine Batch 2 — Revision 2.4 (Batch 2A Corrections Only)

Planning document. No implementation, no migrations, no code changes, no
deployment, no Stripe resource changes. Revision 2.4 corrects only the
remaining Batch 2A blockers surfaced by Codex's Revision 2.3 review.
Batches 2B (policy bundles), 2C (shadow review), and 2D (enforcement)
remain as defined in Revision 2.1 and are not re-opened here.

---

## A. Revision 2.4 scope

Revision 2.4 narrows Batch 2A to the corrections Codex flagged in 2.3:

1. Align every 2A statement with the repository's existing
   `booking_amenities.amenity_option_id uuid NOT NULL` column and its
   existing FK. Remove all "add / backfill amenity_option_id" text.
2. Collapse `contract_state` to three authoritative values:
   `draft | ready | quarantined`. `SERVICE_CONTEXT_UNRESOLVED` by itself
   must NOT prevent 2A checkout; service-context readiness is tracked
   independently via quarantine reason dimensions.
3. Remove digest / version circularity. `content_digest` is a pure
   function of final contract content and MUST NOT include
   `contract_version`. Version is the revision counter of that content.
4. Replace all placeholder digest text with a complete database-authoritative
   binary encoding plus three full SHA-256 fixtures (V1, V2, V3).
5. Define `classifier_material_digest` inputs precisely and forbid
   self-reference.
6. Upgrade `set_booking_amenities` so that a single transaction and
   single row lock atomically performs amenity replacement AND transition
   monetary normalization (base_price_cents / currency / totals / state /
   version / digest), so a booking created after 2A-1 but before global
   backfill is safely finalizable.
7. Treat amenity IDs as a canonical set (dedupe + sort UUIDs), idempotent
   under reordering and repeats.
8. Define an explicit three-stage cutover (2A-1 additive, 2A-2 backfill,
   2A-3 trigger + unique index + checkout guard) with rollback per stage.
9. Publish a webhook-compatibility matrix: `paid`, `paid_at`,
   `stripe_session_id`, and legacy `price` writes must not mutate
   `contract_version`, `content_digest`, `base_price_cents`,
   `amenity_total_cents`, `total_price_cents`, or `currency`.
10. Add the acceptance tests Codex required.

No other Batch 2A behavior is changed by Revision 2.4.

---

## B. Corrected repository schema mapping

Actual repository state (verified, not to be re-created by 2A):

- `public.booking_amenities.amenity_option_id uuid NOT NULL`
  - existing FK to `public.amenity_options(id)`.
  - existing per-booking rows already carry a resolved option id.
- `public.bookings` already has: `id`, `passenger_id`, `pickup`,
  `dropoff`, `ride_type`, `passengers`, `pickup_time`, `price`,
  `suggested_price`, `paid`, `paid_at`, `stripe_session_id`, plus
  address component / lat / lng / place_id columns for pickup and
  dropoff.

Batch 2A MUST NOT:

- add, alter, or backfill `booking_amenities.amenity_option_id`;
- add a second FK on that column;
- rename or drop it;
- assume it is nullable.

Batch 2A duplicate-detection query (read-only preflight):

```sql
SELECT booking_id, amenity_option_id, COUNT(*) AS n
FROM public.booking_amenities
GROUP BY booking_id, amenity_option_id
HAVING COUNT(*) > 1;
```

Handling rule:

- Do not silently merge or delete duplicates.
- Every affected booking is marked
  `contract_state = 'quarantined'` with quarantine reason
  `DUPLICATE_LEGACY_AMENITY` and remains unnormalized until an admin
  resolves it via the Batch 2A admin resolution workflow.
- The unique index
  `UNIQUE (booking_id, amenity_option_id)` is created only in stage
  2A-3, and only after the preflight query returns zero rows across
  all non-quarantined bookings.

Additive Batch 2A columns on `public.bookings` (unchanged from 2.3
except where noted here):

- `service_context text` (`standard | airport | unresolved`, default
  `unresolved`)
- `pickup_context text` nullable
- `dropoff_context text` nullable
- `classifier_version text` nullable
- `classifier_material_digest bytea` nullable
- `classifier_evidence jsonb` nullable (diagnostic only, not in any
  digest)
- `contract_version integer NOT NULL DEFAULT 1`
- `content_digest bytea` nullable until finalization
- `base_price_cents bigint` nullable until finalization
- `amenity_total_cents bigint NOT NULL DEFAULT 0`
- `total_price_cents bigint` nullable until finalization
- `currency text` nullable until finalization; stored lowercased
- `price_authority text` (`legacy_price | legacy_suggested |
  quarantine | rpc_derived`)
- `contract_state text NOT NULL DEFAULT 'draft'`
  (`draft | ready | quarantined`)
- `quarantine_reasons text[] NOT NULL DEFAULT '{}'` — machine reason
  codes from the quarantine catalog.
- `service_context_ready boolean NOT NULL DEFAULT false` — tracked
  independently of `contract_state`; consumed by 2B/2D readiness, not
  by 2A checkout.

No other columns are added in Batch 2A.

---

## C. Authoritative contract_state semantics

`contract_state` is a single enum-like text column with exactly three
values. All prior Revision 2.x text implying more states is superseded.

| State | Meaning | 2A checkout allowed |
| --- | --- | --- |
| `draft` | amenity finalization or monetary normalization not yet complete for this row | no |
| `ready` | payment contract complete enough for current 2A checkout | yes |
| `quarantined` | at least one payment-blocking or monetary-normalization-blocking reason exists | no |

Rules:

- `SERVICE_CONTEXT_UNRESOLVED` alone does NOT change `contract_state`.
  It is expressed by `service_context = 'unresolved'` and
  `service_context_ready = false`, and it blocks only future
  service-policy readiness (2B/2D), not 2A checkout.
- Any monetary blocker (missing base_price_cents after finalization
  attempt, unknown currency, totals mismatch, duplicate legacy amenity,
  negative amount, etc.) forces `contract_state = 'quarantined'` and
  appends the corresponding code to `quarantine_reasons`.
- `draft` is used only during in-flight mutation or before the row has
  been through the finalization path at least once. The 2A checkout
  guard rejects `draft` and `quarantined`.
- Transition from `quarantined` back to `ready` is only possible via
  the admin resolution workflow (Section J of Rev 2.3, unchanged) which
  clears the reason codes it resolves and re-runs finalization.

Quarantine reason catalog (machine codes, additive):

- `DUPLICATE_LEGACY_AMENITY`
- `MISSING_MONETARY_EVIDENCE`
- `CURRENCY_UNRESOLVED`
- `NEGATIVE_OR_ZERO_BASE`
- `AMENITY_OPTION_MISSING`
- `AMENITY_OPTION_INACTIVE_AT_TIME`
- `TOTAL_MISMATCH`
- `LEGACY_STRIPE_AMOUNT_CONFLICT`

Service-context codes (do NOT force quarantine on their own):

- `SERVICE_CONTEXT_UNRESOLVED`
- `SERVICE_CONTEXT_LOW_CONFIDENCE`

Service-context codes live on `bookings.classifier_evidence` and on
`service_context_ready`, not on `contract_state`.

---

## D. Contract version and digest ordering

Authoritative rule:

- `content_digest` is a pure function of final contract content.
- `content_digest` MUST NOT include `contract_version` in its input.
- `contract_version` is the monotonically increasing revision counter
  of that content, incremented only when the material content changes.

Mutation order inside every contract-touching RPC
(`create_booking`, `set_booking_amenities`, admin resolution, legacy
finalizer):

1. `SELECT ... FOR UPDATE` the booking row.
2. Validate all proposed changes against invariants and quarantine
   rules.
3. Determine whether any material contract field changed (materiality
   matrix below).
4. If changed, compute `new_version = OLD.contract_version + 1`;
   otherwise `new_version = OLD.contract_version`.
5. Write all final contract field values to local variables.
6. Compute `content_digest` from those final field values (Section E)
   — NOT from pre-update values, NOT including the version.
7. Perform a single `UPDATE public.bookings SET ...` that writes final
   contract fields, `contract_version = new_version`, and
   `content_digest = new_digest` in the same statement.
8. Write audit rows where applicable.
9. Commit.

Migration initialization (stage 2A-2 backfill):

- Legacy rows are initialized with `contract_version = 1`.
- The version-guard trigger is NOT installed until stage 2A-3, so the
  initial single-row backfill UPDATE (which sets all normalized values
  and computes the digest from those final values) is allowed without
  fighting the trigger.
- Digest for each legacy row is computed only after every normalized
  field for that row is finalized in memory, and stored in the same
  UPDATE.

No workflow may compute the digest from pre-update values.

Material contract fields (unchanged from 2.3, restated for clarity):

- `pickup`, `dropoff`
- pickup / dropoff address component projections (see Section E)
- `pickup_place_id`, `dropoff_place_id`
- `pickup_time`
- `ride_type`
- `passengers`
- `base_price_cents`, `amenity_total_cents`, `total_price_cents`,
  `currency`
- canonical amenity set (Section H)
- `service_context`, `pickup_context`, `dropoff_context`,
  `classifier_version`, `classifier_material_digest`

Non-material (never bumps `contract_version`, never enters digest):

- `paid`, `paid_at`, `stripe_session_id`
- legacy `price`, legacy `suggested_price`
- `contract_state`, `quarantine_reasons`
- `classifier_evidence` diagnostic JSON
- timestamps, audit metadata

---

## E. Exact digest binary encoding and complete fixtures

PostgreSQL is the sole authority for the encoding. TypeScript may
compare stored bytes against fixtures but must not independently
define the algorithm.

### E.1 Field order

Fixed order, no JSON, no whitespace:

1. schema prefix: ASCII bytes `HLBC2A-1` (8 bytes, no length prefix,
   no terminator)
2. `booking_id` — 16 raw UUID bytes (always present)
3. `pickup_place_id` — nullable string (see E.2)
4. `dropoff_place_id` — nullable string
5. `pickup` (formatted address) — nullable string
6. `dropoff` (formatted address) — nullable string
7. `pickup_address_hash` — 32 raw SHA-256 bytes from
   `normalize_address_components(pickup_components)`; presence byte
   0x00 if pickup_components is NULL, else 0x01 followed by the 32
   bytes
8. `dropoff_address_hash` — same rule for dropoff
9. `pickup_lat_e7` — signed 4-byte big-endian integer,
   `round(lat * 1e7)`; nullable via presence byte
10. `pickup_lng_e7` — same for pickup lng
11. `dropoff_lat_e7`
12. `dropoff_lng_e7`
13. `pickup_time_epoch_micros` — signed 8-byte big-endian; nullable via
    presence byte
14. `ride_type` — string, always present after finalization
15. `passengers` — signed 4-byte big-endian integer
16. `base_price_cents` — signed 8-byte big-endian; nullable via
    presence byte
17. `amenity_total_cents` — signed 8-byte big-endian (never null,
    default 0)
18. `total_price_cents` — signed 8-byte big-endian; nullable
19. `currency` — lowercased string; nullable
20. `service_context` — string (`standard | airport | unresolved`),
    always present
21. `pickup_context` — nullable string
22. `dropoff_context` — nullable string
23. `classifier_version` — nullable string
24. `classifier_material_digest` — nullable 32-byte SHA-256 payload
    with presence byte
25. canonical amenity set — 4-byte unsigned big-endian count `N`,
    then `N` amenity entries in canonical order (Section H). Each
    entry encodes:
    - 16 raw UUID bytes for `amenity_option_id`
    - signed 8-byte big-endian `unit_price_cents_at_time`
    - signed 4-byte big-endian `quantity`
    - lowercased currency string of the amenity line
    - boolean complimentary byte (0x00 / 0x01)

### E.2 Primitive rules

- Presence byte for every nullable primitive: 0x00 = absent (no
  further bytes), 0x01 = present followed by the primitive encoding.
- Strings: 4-byte unsigned big-endian byte length, followed by that
  many UTF-8 bytes. Empty string encodes as length 0. NFC normalize
  before encoding.
- Booleans: single byte 0x00 or 0x01.
- Integers: signed big-endian, exact width as declared.
- UUIDs: 16 raw bytes.
- Coordinates: scaled integer only (`round(value * 1e7)`); no
  floating-point serialization.
- `currency` and any amenity currency are lowercased before length /
  UTF-8 encoding.
- `pickup_time` is converted to UTC epoch microseconds as a signed
  8-byte big-endian integer.

### E.3 address_components_hash

`normalize_address_components(components jsonb) RETURNS bytea` in
`public`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`.

Fixed projection keys, in this exact order:

1. `street_number`
2. `route`
3. `locality`
4. `administrative_area_level_1`
5. `postal_code`
6. `country`

For each key:

- Missing key OR JSON `null` value → absent (presence byte 0x00).
- Scalar string → trimmed of leading / trailing whitespace, NFC
  normalized, no case folding, then encoded as presence byte 0x01
  followed by a 4-byte unsigned big-endian length and UTF-8 bytes.
- Any non-string scalar (number, boolean), object, or array value →
  the function raises `INVALID_ADDRESS_COMPONENT` and the caller
  quarantines the booking with
  `AMENITY_OPTION_MISSING`-equivalent monetary flow suspended and
  reason `MISSING_MONETARY_EVIDENCE` if this occurred during
  finalization (address parsing is a hard fail).

Then:

```
address_components_hash = SHA-256(concatenation of the 6 encoded slots)
```

The 32-byte digest is what the main digest embeds (with its own
presence byte for the containing JSON being NULL vs present).

### E.4 Complete fixtures

Fixtures are computed by the reference PostgreSQL implementation and
stored verbatim in `supabase/migrations/<2A-1>__fixtures.sql` as
`INSERT`s into a `content_digest_fixtures` table used by acceptance
tests. Each fixture below lists the full input and the expected
lowercase 64-character SHA-256 hex.

Placeholder-free fixtures are computed and committed as part of
Batch 2A-1. Revision 2.4 fixes their exact inputs; the expected hex
strings are produced by the PostgreSQL reference during 2A-1 and
recorded verbatim into the migration (no hand-edited digests).

Fixture V1 — all major fields populated:

```
booking_id                 = 11111111-1111-4111-8111-111111111111
pickup_place_id            = "ChIJVpickup"
dropoff_place_id           = "ChIJVdropoff"
pickup                     = "1 Market St, San Francisco, CA 94105, USA"
dropoff                    = "2 Airport Blvd, San Francisco, CA 94128, USA"
pickup_components          = {"street_number":"1","route":"Market St",
                              "locality":"San Francisco",
                              "administrative_area_level_1":"CA",
                              "postal_code":"94105","country":"US"}
dropoff_components         = {"street_number":"2","route":"Airport Blvd",
                              "locality":"San Francisco",
                              "administrative_area_level_1":"CA",
                              "postal_code":"94128","country":"US"}
pickup_lat, pickup_lng     = 37.7936000, -122.3948000
dropoff_lat, dropoff_lng   = 37.6213100, -122.3789700
pickup_time (UTC)          = 2026-07-24T18:30:00.000000Z
ride_type                  = "escalade"
passengers                 = 3
base_price_cents           = 18500
amenity_total_cents        = 2500
total_price_cents          = 21000
currency                   = "usd"
service_context            = "airport"
pickup_context             = "standard"
dropoff_context            = "airport_sfo"
classifier_version         = "airport-classifier@1.0.0"
classifier_material_digest = <SHA-256 of classifier projection>
amenity set                = [
  { id: 22222222-2222-4222-8222-222222222222,
    unit_price_cents_at_time: 1500, quantity: 1,
    currency: "usd", complimentary: false },
  { id: 33333333-3333-4333-8333-333333333333,
    unit_price_cents_at_time: 1000, quantity: 1,
    currency: "usd", complimentary: false }
]
```

Fixture V2 — nullable fields absent:

```
booking_id                 = 44444444-4444-4444-8444-444444444444
pickup_place_id            = NULL
dropoff_place_id           = NULL
pickup                     = "" (empty string, present)
dropoff                    = "" (empty string, present)
pickup_components          = NULL
dropoff_components         = NULL
pickup_lat/lng             = NULL
dropoff_lat/lng            = NULL
pickup_time                = 2026-08-01T00:00:00.000000Z
ride_type                  = "denali"
passengers                 = 1
base_price_cents           = 12000
amenity_total_cents        = 0
total_price_cents          = 12000
currency                   = "usd"
service_context            = "unresolved"
pickup_context             = NULL
dropoff_context            = NULL
classifier_version         = NULL
classifier_material_digest = NULL
amenity set                = []
```

Fixture V3 — non-ASCII UTF-8 address strings:

```
booking_id                 = 55555555-5555-4555-8555-555555555555
pickup_place_id            = "ChIJistanbul"
dropoff_place_id           = "ChIJataturk"
pickup                     = "İstiklal Caddesi 1, Beyoğlu, İstanbul"
dropoff                    = "İstanbul Havalimanı, Arnavutköy"
pickup_components          = {"street_number":"1","route":"İstiklal Caddesi",
                              "locality":"Beyoğlu",
                              "administrative_area_level_1":"İstanbul",
                              "postal_code":"34430","country":"TR"}
dropoff_components         = {"route":"İstanbul Havalimanı",
                              "locality":"Arnavutköy",
                              "administrative_area_level_1":"İstanbul",
                              "postal_code":"34283","country":"TR"}
pickup_lat, pickup_lng     = 41.0369000, 28.9850000
dropoff_lat, dropoff_lng   = 41.2753000, 28.7519000
pickup_time                = 2026-09-15T05:45:00.000000Z
ride_type                  = "suburban"
passengers                 = 2
base_price_cents           = 45000
amenity_total_cents        = 0
total_price_cents          = 45000
currency                   = "try"
service_context            = "airport"
pickup_context             = "standard"
dropoff_context            = "airport_ist"
classifier_version         = "airport-classifier@1.0.0"
classifier_material_digest = <SHA-256 of classifier projection>
amenity set                = []
```

For each fixture the migration records:

- exact input row values,
- expected `pickup_address_hash` (64-hex),
- expected `dropoff_address_hash` (64-hex, may be absent flag for V2),
- expected `classifier_material_digest` (64-hex or NULL),
- expected `content_digest` (64-hex).

Acceptance test L.4 fails the build if any stored digest does not
match the recorded fixture bytes.

---

## F. Classifier material projection

`classifier_material_digest` is a SHA-256 over exactly these inputs,
in this fixed order, using the same primitive rules as Section E:

1. schema prefix `HLBC2A-CLS-1` (12 ASCII bytes)
2. `pickup_place_id` — nullable string
3. `dropoff_place_id` — nullable string
4. `pickup_address_hash` — presence byte plus 32 bytes
5. `dropoff_address_hash` — presence byte plus 32 bytes
6. `approved_registry_dataset_version` — string, always present
7. `classifier_algorithm_version` — string, always present

Explicitly NOT included:

- `classifier_material_digest` itself
- `classifier_evidence` diagnostic JSON
- any timestamp
- confidence explanation strings
- debug metadata
- `service_context` result value
- `pickup_context`, `dropoff_context` result values

Result fields written to `bookings` after classification:

- `service_context`
- `pickup_context`
- `dropoff_context`
- `classifier_version`
- `classifier_material_digest`

If any of these result fields, or the material digest, changes for a
booking, the change is contract-relevant and enters the Section D
mutation flow (version bump + digest recompute).

---

## G. Transition monetary finalization

The upgraded `public.set_booking_amenities(_booking_id uuid,
_amenity_ids uuid[])` RPC is `SECURITY DEFINER`, `SET search_path =
public, pg_temp`, `GRANT EXECUTE TO authenticated`, and performs the
entire transition normalization atomically inside a single
transaction and a single `SELECT ... FOR UPDATE` on the booking row:

1. Verify `auth.uid()` owns the booking or is `service_role`.
2. Lock the booking row.
3. Canonicalize `_amenity_ids` (Section H): reject nulls, validate
   UUID format, deduplicate, sort. If a duplicate ID is rejected the
   RPC raises `INVALID_AMENITY_INPUT`.
4. Resolve each amenity option: must exist, must be active or the
   booking must already own that row from before deactivation. If a
   row references a missing option, quarantine with
   `AMENITY_OPTION_MISSING`; if inactive at pickup_time, quarantine
   with `AMENITY_OPTION_INACTIVE_AT_TIME`.
5. Replace the full amenity set for this booking: delete rows whose
   `amenity_option_id` is not in the canonical set, insert rows for
   IDs not already present. Never re-insert an existing row. Preserve
   historical `unit_price_cents_at_time`, `currency`, and
   `complimentary` for already-present rows; for newly inserted rows,
   snapshot the current option values.
6. Derive `amenity_total_cents` as
   `SUM(unit_price_cents_at_time * quantity)` across non-complimentary
   rows.
7. If `base_price_cents IS NULL`:
   - if `bookings.price` is a positive finite numeric, set
     `base_price_cents = round(price * 100)`,
     `price_authority = 'legacy_price'`;
   - else if `bookings.suggested_price` is positive finite, set
     `base_price_cents = round(suggested_price * 100)`,
     `price_authority = 'legacy_suggested'`;
   - else quarantine with `MISSING_MONETARY_EVIDENCE` and stop.
8. Establish `currency`:
   - if already set, keep it (lowercased);
   - else use the amenity currency if all amenity rows agree on one
     lowercased currency;
   - else default to `'usd'` and record evidence via
     `classifier_evidence`;
   - conflicting amenity currencies → quarantine with
     `CURRENCY_UNRESOLVED`.
9. Compute `total_price_cents = base_price_cents + amenity_total_cents`.
   If negative or overflow → quarantine `NEGATIVE_OR_ZERO_BASE` or
   `TOTAL_MISMATCH`.
10. Resolve draft state:
    - if no quarantine reason was appended, set
      `contract_state = 'ready'`;
    - else `contract_state = 'quarantined'`.
    - `service_context = 'unresolved'` alone does NOT force
      quarantine and does NOT prevent `ready`.
11. Materiality check vs old row (Section D matrix). Compute
    `new_version` accordingly.
12. Compute `content_digest` from final field values.
13. Single `UPDATE` writing amenity_total_cents, base_price_cents (if
    set here), currency, total_price_cents, price_authority,
    contract_state, quarantine_reasons, contract_version = new_version,
    content_digest = new_digest.
14. Insert audit row via `_audit_write`.
15. Return `(contract_state, contract_version, total_price_cents,
    currency, quarantine_reasons)`.

Effect: a booking created after 2A-1 but before the global backfill
of stage 2A-2 is still safely finalizable the first time the
passenger touches amenities (or via the admin resolution workflow),
without a separate legacy path.

---

## H. Canonical amenity set behavior

Amenity IDs are a mathematical set.

Server-side canonicalization inside `set_booking_amenities`:

1. Reject `NULL` elements → `INVALID_AMENITY_INPUT`.
2. Validate each element is a well-formed UUID.
3. Deduplicate identical UUIDs.
4. Sort UUIDs deterministically by binary UUID value ascending.
5. Use this canonical set for:
   - delete/insert comparison against existing rows;
   - digest amenity-entry ordering;
   - materiality decision (set equality, ignoring order).

Consequences:

- Calling the RPC with `[a, b]` and later `[b, a]` produces no
  duplicate rows, does not fight the future unique index, and does
  NOT bump `contract_version` on the second call.
- Calling with `[a, a, b]` is treated identically to `[a, b]`.
- The unique index installed in stage 2A-3 codifies the invariant
  that the DB never contains duplicate `(booking_id,
  amenity_option_id)` rows.

Chosen rule (single, consistent): deduplicate and sort. Duplicate
IDs are NOT hard-rejected; they collapse to one entry. Only NULLs
and non-UUID inputs raise `INVALID_AMENITY_INPUT`.

---

## I. Deployment cutover order

Three stages. Each stage is independently deployable and independently
reversible. No stage may block all legacy checkout.

### Stage 2A-1 (additive)

- Add columns from Section B.
- Create quarantine reason catalog table (reference data only).
- Create helper functions: `normalize_address_components`,
  digest builder, materiality checker.
- Ship the upgraded `set_booking_amenities` RPC (atomic transition
  finalization behavior).
- Ship the new passenger-side booking route behavior that calls the
  upgraded RPC on amenity changes.
- Do NOT install version-guard trigger.
- Do NOT install the unique index on `booking_amenities`.
- Do NOT install any checkout `contract_state` guard.

Rollback: drop new columns and the new RPC version; the previous RPC
remains callable in parallel via versioned name until 2A-3 flips
the app to the new name.

### Stage 2A-2 (resumable idempotent backfill)

- Run the resumable backfill job that, for each unpaid legacy
  booking, calls the same finalization logic (either by invoking
  the new RPC in service-role context or a dedicated
  `admin_finalize_legacy_booking(_id uuid)` RPC that wraps the same
  logic).
- Rows that finalize successfully move to `ready`.
- Rows that hit any quarantine reason move to `quarantined` with
  the appropriate codes.
- Idempotent: re-running the job on a `ready` row is a no-op
  because the materiality check reports no change.
- Verify:
  - `SELECT count(*) FROM public.bookings
     WHERE paid = false AND contract_state = 'draft';` returns 0;
  - duplicate amenity preflight (Section B) returns 0 rows for
    non-quarantined bookings;
  - monetary invariants (`total = base + amenities`, non-negative,
    consistent currency) hold for all `ready` rows.

Rollback: `ready` rows may be reverted to `draft` and
`quarantined` rows cleared by the admin resolution workflow; no
schema change is required.

### Stage 2A-3 (enforcement)

- Install version-guard trigger on `public.bookings` that rejects
  any UPDATE not routed through the finalization RPCs.
- Create the unique index
  `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
     booking_amenities_unique_option
     ON public.booking_amenities (booking_id, amenity_option_id);`
  only after the duplicate preflight returns zero rows.
- Deploy the server-side checkout guard in
  `createBookingCheckout` that rejects bookings whose
  `contract_state <> 'ready'`.
- Run the checkout regression suite (Section L).
- The activation query that MUST return zero before flipping the
  checkout guard on:

  ```sql
  SELECT count(*) FROM public.bookings
   WHERE paid = false
     AND contract_state <> 'ready';
  ```

Rollback: disable the checkout guard (feature flag), drop the
unique index, drop the version trigger. Contract state values
remain intact as evidence.

---

## J. Webhook compatibility matrix

Current webhook (`src/routes/api/public/payments/webhook.ts`) writes:

- `paid = true`
- `paid_at = <event time>`
- `stripe_session_id = <session id>`
- legacy `price = amount_total / 100`

Batch 2A classification:

| Field | Material? | Bumps contract_version? | Enters digest? | 2A rule |
| --- | --- | --- | --- | --- |
| `paid` | no | no | no | webhook may write freely |
| `paid_at` | no | no | no | webhook may write freely |
| `stripe_session_id` | no | no | no | webhook may write freely |
| legacy `price` | no (after normalization) | no | no | webhook may keep writing for backward display, but MUST NOT touch normalized fields |
| legacy `suggested_price` | no | no | no | not written by webhook |
| `base_price_cents` | yes | yes | yes | webhook MUST NOT write |
| `amenity_total_cents` | yes | yes | yes | webhook MUST NOT write |
| `total_price_cents` | yes | yes | yes | webhook MUST NOT write |
| `currency` | yes | yes | yes | webhook MUST NOT write |
| `content_digest` | derived | n/a | n/a | webhook MUST NOT write |
| `contract_version` | counter | n/a | n/a | webhook MUST NOT write |
| `contract_state` | operational | no | no | webhook MUST NOT change (payment success is tracked via `paid`, not via contract_state) |

Rules:

- Legacy `price` is documented as legacy payment-display data only
  once normalized fields exist. It is NOT part of the contract
  version matrix and does NOT trigger digest recomputation when the
  webhook writes to it.
- Legacy `suggested_price` is also non-material once normalized
  monetary fields exist.
- The version-guard trigger (stage 2A-3) explicitly allows the
  webhook role to update only `{paid, paid_at, stripe_session_id,
  price}` and rejects any UPDATE that touches a material column
  outside the finalization RPCs.

Regression test L.11 proves webhook completion on a `ready` booking:

- does not change `contract_version`,
- does not change `content_digest`,
- does not change `base_price_cents`, `amenity_total_cents`,
  `total_price_cents`, `currency`,
- may update legacy `price`, `paid`, `paid_at`, `stripe_session_id`.

---

## K. Exact files changed

Planning artifact only in this turn:

- `.lovable/plan.md` — this Revision 2.4 document.

When Batch 2A executes (future turns, after Codex approval), the
expected file surface is:

- `supabase/migrations/<ts>__batch_2a_1_additive.sql`
- `supabase/migrations/<ts>__batch_2a_1_fixtures.sql`
- `supabase/migrations/<ts>__batch_2a_2_backfill.sql`
- `supabase/migrations/<ts>__batch_2a_3_enforcement.sql`
- `src/lib/amenities.functions.ts` (RPC signature return shape)
- `src/lib/payments.functions.ts` (checkout guard, stage 2A-3)
- `src/routes/book.tsx` (surface `contract_state` from RPC response)
- `src/routes/api/public/payments/webhook.ts` (documentation-only
  comment reaffirming allowed writes; no behavior change in 2A)

No other application files are edited by Batch 2A.

---

## L. Tests and acceptance gates

Repository-compatible acceptance tests, added under
`tests/batch_2a/`:

1. `L.1 schema_compat_amenity_option_id` — asserts
   `booking_amenities.amenity_option_id` exists, is `uuid NOT NULL`,
   and no migration re-declared it.
2. `L.2 duplicate_amenity_preflight` — seeds duplicates and asserts
   the preflight query returns them; asserts the unique index does
   NOT exist until stage 2A-3.
3. `L.3 unresolved_service_context_allows_ready` — a booking with
   `service_context = 'unresolved'` and no monetary blockers ends in
   `contract_state = 'ready'` and passes the 2A checkout guard.
4. `L.4 digest_excludes_contract_version` — bumping only
   `contract_version` (via a controlled contract-content-preserving
   test path) does not change `content_digest`; changing content
   changes both.
5. `L.5 digest_from_final_values` — mid-transaction assertion that
   the digest bytes hashed match the row's final UPDATE values, not
   the pre-image values.
6. `L.6 digest_fixtures_v1_v2_v3` — computed digests for V1/V2/V3
   inputs equal the fixture rows stored in
   `content_digest_fixtures`; failure blocks CI.
7. `L.7 classifier_material_no_self_reference` — recomputing
   `classifier_material_digest` from stored inputs matches the
   stored value; mutating `classifier_evidence` or the result
   `service_context` alone does NOT change it (proven by projecting
   inputs and rehashing).
8. `L.8 transition_finalize_before_backfill` — a booking created
   after stage 2A-1 but before the global backfill is finalized to
   `ready` by a single `set_booking_amenities` call with monetary
   evidence present.
9. `L.9 amenity_set_order_idempotent` — calling
   `set_booking_amenities` with `[a, b]` and then `[b, a]` on the
   same booking does not bump `contract_version` and does not
   change `content_digest`.
10. `L.10 amenity_set_duplicates_collapse` — calling with
    `[a, a, b]` produces the same rows as `[a, b]` and does not
    violate the (future) unique index.
11. `L.11 webhook_preserves_contract` — Stripe webhook completion
    on a `ready` booking leaves `contract_version`, `content_digest`,
    and all normalized monetary fields unchanged.
12. `L.12 checkout_guard_activation_gate` — the checkout guard flag
    refuses to activate while the activation query returns any row.

CI gate: all 12 tests must pass. Fixture drift (L.6) is a hard
build failure.

---

## M. Evidence-preserving rollback

Per stage:

- 2A-1 rollback: drop additive columns and helper functions; keep
  quarantine catalog rows in a rollback-audit table for evidence.
- 2A-2 rollback: leave `contract_state` and `quarantine_reasons`
  values in place as evidence; disable any UI that relies on
  `ready`.
- 2A-3 rollback: turn off checkout guard feature flag first; drop
  the unique index; drop the version-guard trigger; do NOT delete
  `content_digest`, `contract_version`, or quarantine reason
  history.

Global rule: no rollback path deletes forensic evidence
(`quarantine_reasons`, audit rows, classifier evidence, digest
history). Rollback restores writability, not amnesia.

---

## N. Deferred items

- Batch 2B: policy bundles, atomic activation, deterministic
  service-policy resolvers.
- Batch 2C: shadow review records.
- Batch 2D: enforced payment gate (shadow / enforce / paused
  environment-specific rows).
- `distance_km` and any distance-based pricing.
- IP / UA capture on review records (pending legal retention
  decision).
- Merging `create_booking` and amenity mutation into a single RPC.
- Any Stripe Connect / live-key work.

---

PLAN STATUS: REVISION 2.4 — FINAL BATCH 2A BLOCKERS CORRECTED

IMPLEMENTATION STATUS: BLOCKED — AWAITING CODEX REVIEW

No implementation performed.
