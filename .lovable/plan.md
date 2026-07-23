# HarborLine Batch 2 — Revision 2.3 (Batch 2A Corrections Only)

Planning document. No code, migrations, Stripe, or deployment changes are performed by this document. Batches 2B (policy bundles), 2C (shadow review), and 2D (enforcement) remain as defined in Revision 2.1 and are not re-opened here.

---

## A. Revision 2.3 Scope

Revision 2.3 corrects only the remaining Batch 2A blockers raised by the Codex review of Revision 2.2. It does not redesign 2B/2C/2D.

Batch 2A objective (unchanged): normalize the booking monetary contract, introduce `service_context`, `contract_version`, a database-authoritative `content_digest`, an explicit quarantine surface with catalog-driven blocker dimensions, and a version-aware amenity mutation path — while preserving the current Stripe checkout amount formula (`price ?? suggested_price` plus `booking_amenities` line items).

In scope for 2A:
- Additive monetary columns on `bookings`.
- `service_context`, `contract_version`, `content_digest`, `classifier_material_digest`, `classifier_evidence`.
- `contract_state ∈ {draft, ready, quarantined}`.
- `booking_contract_quarantine` cases with catalog reason codes.
- `booking_contract_quarantine_reason_catalog`.
- Version-aware amenity mutation RPC.
- Zero-amenity finalization path (see C).
- Minimum checkout readiness guard: reject Stripe Checkout creation when `contract_state != 'ready'`.
- Admin unresolved-quarantine UI (list + resolve).
- Database-authoritative canonical digest.
- Three-stage deployment (schema+functions → backfill → constraints/index).

Out of scope for 2A (deferred):
- Normalized pricing on the Stripe path (checkout amount formula unchanged).
- Policy bundles / snapshots / review records (2B, 2C).
- Payment gate state machine (2D).
- Paid historical Stripe reconciliation (see I).
- IP/UA capture on reviews.
- Distance-based pricing.

---

## B. Corrected Repository Field Mapping

Verified against the current schema and codebase.

Fields that already exist on `bookings` and must not be re-added:
- `id uuid`, `passenger_id uuid`, `driver_id uuid nullable`
- `pickup text`, `dropoff text`
- `pickup_time timestamptz`
- `passengers int`
- `ride_type text` (values: `escalade | suburban | denali`)
- `price numeric nullable`, `suggested_price numeric nullable`, `paid boolean`
- `distance_km` — already present; Revision 2.3 does not add it.
- Structured address fields already present: `pickup_lat/lng`, `pickup_place_id`, `pickup_components jsonb`, and the equivalent dropoff columns.

Dispatch status:
- `dispatch_status` lives on `booking_assignments`, not on `bookings`. Revision 2.3 removes every prior reference that implied `bookings.dispatch_status`. Any 2A logic that needs current operational state joins `booking_assignments` by `booking_id`.

Amenities:
- `booking_amenities(booking_id, amenity_code, amenity_name, quantity, price_delta_cents, complimentary, …)` — canonical amenity line source for 2A. Amenity option identity is `amenity_option_id` (added in 2A as a nullable FK; see K).

Columns Batch 2A adds to `bookings` (all additive, all nullable during backfill):
- `service_context text` — values `standard | airport | unresolved`.
- `contract_version integer not null default 1` (initialized before trigger install).
- `content_digest bytea` — database-generated; see J.
- `classifier_evidence jsonb`.
- `classifier_material_digest bytea` — see H.
- `base_price_cents bigint`, `amenity_total_cents bigint`, `total_price_cents bigint`, `currency text` (3-letter, lowercased).
- `contract_state text not null default 'draft'` with CHECK in `{draft, ready, quarantined}`.

No booking columns are dropped or renamed in 2A.

---

## C. Booking Finalization and Zero-Amenity Flow

Chosen behavior: **always call `setBookingAmenities`, including with an empty array**. The RPC is the single finalizer for the amenity segment of the contract.

`set_booking_amenities(_booking_id, _amenity_option_ids[])` behavior:
1. Row-lock the booking `FOR UPDATE`.
2. Reject if `contract_state = 'quarantined'` with typed error `E_CONTRACT_QUARANTINED`.
3. Validate every option id against the active amenity catalog and against `allowed_ride_types` for the booking's `ride_type`. Unknown or disallowed ids → `E_AMENITY_INVALID`; the booking is not mutated.
4. Full replacement semantics: delete all rows in `booking_amenities` for the booking and insert the new set (may be empty).
5. Recompute `amenity_total_cents` from the newly inserted rows (0 for empty).
6. If a monetary base is known (`base_price_cents` populated post-normalization, or the legacy `price/suggested_price` value used during the 2A transition period), set `total_price_cents = base_price_cents + amenity_total_cents`. If base is unknown, leave `total_price_cents` NULL and leave `contract_state = 'draft'`.
7. Recompute `content_digest` (see J) and `classifier_material_digest` (see H).
8. Increment `contract_version` **exactly once** for the whole RPC call, only when the logical contract is finalized (i.e., when the call actually finalizes to `ready`, or when material contract fields change while remaining `draft`). Passing the same amenity set that is already stored, on a booking already `ready`, is a no-op with no version bump.
9. On successful finalization with a known base and no quarantine blockers, set `contract_state = 'ready'`.
10. Write `_audit_write` entry with old/new digests.

Route behavior (`src/routes/book.tsx`):
- Always invokes `setBookingAmenities` after `createBookingServer`, even when `amenityIds.length === 0`.
- On success: proceed to review/payment path.
- On failure: **do not** show booking success toast, **do not** navigate to `/history` or open checkout. Show a retryable error. The same full-replacement call is safe to retry because the RPC is idempotent per `(booking_id, amenity_set)` and only bumps `contract_version` when the stored set actually changes.

Alternative considered but rejected: making `create_booking` finalize zero-amenity bookings itself. Rejected to keep a single finalization path and a single place where `contract_version` and `contract_state` are advanced.

---

## D. Checkout Readiness Guard

Batch 2A adds the minimum guard to `createBookingCheckout` in `src/lib/payments.functions.ts`. This is not a switch to normalized pricing.

Guard:
1. Load the booking row (already done today). Include `contract_state`, `paid`.
2. If `booking.paid` → existing behavior (`error: "Already paid"`).
3. If `booking.contract_state !== 'ready'` → return `{ error: "Booking not ready for payment" }` with typed code `E_CONTRACT_NOT_READY`. No Stripe Session is created.
4. Otherwise proceed with the **unchanged** amount calculation:
   - Base line item `unit_amount = Math.round((booking.price ?? booking.suggested_price) * 100)`.
   - Additional line items derived from current `booking_amenities` rows (unchanged shape).
5. All other Stripe metadata (`bookingId`, `userId`, description) unchanged.

Server-side rejection is authoritative; the UI may also disable the Pay button when `contract_state !== 'ready'` for UX, but the server check is the security boundary.

---

## E. Quarantine Reason Catalog and Blocker Dimensions

New table: `public.booking_contract_quarantine_reason_catalog`.

Columns:
- `reason_code text primary key`
- `blocks_monetary_normalization boolean not null`
- `blocks_service_readiness boolean not null`
- `blocks_payment_enforcement boolean not null`
- `description text not null`
- `active boolean not null default true`
- `created_at timestamptz not null default now()`

Existing table (adjusted): `public.booking_contract_quarantine`
- `id uuid pk`
- `booking_id uuid references bookings(id)`
- `opened_at timestamptz not null default now()`
- `resolved_at timestamptz`
- `resolved_by uuid`
- `notes text`

New link table: `public.booking_contract_quarantine_reasons`
- `quarantine_id uuid references booking_contract_quarantine(id) on delete cascade`
- `reason_code text references booking_contract_quarantine_reason_catalog(reason_code)`
- `evidence jsonb`
- `resolved_at timestamptz`
- primary key `(quarantine_id, reason_code)`.

Seeded reason codes and dimensions:

| reason_code | monetary | service | payment_enforcement | description |
|---|---|---|---|---|
| `PAID_PAYMENT_EVIDENCE_MISSING` | false | false | true | Paid booking lacks Stripe session/PI evidence. |
| `PAID_AMOUNT_MISMATCH` | false | false | true | Stripe amount ≠ derived total. |
| `PAID_CURRENCY_MISMATCH` | false | false | true | Stripe currency ≠ booking currency. |
| `PAID_SESSION_UNRESOLVED` | false | false | true | Stripe session cannot be located. |
| `PRICE_AUTHORITY_UNRESOLVED` | true | false | true | Neither `price` nor `suggested_price` usable. |
| `CURRENCY_MISMATCH` | true | false | true | Multiple currencies observed for same booking. |
| `AMOUNT_OVERFLOW` | true | false | true | Cents value exceeds bigint safe monetary ceiling. |
| `SERVICE_CONTEXT_UNRESOLVED` | **false** | true | false | Classifier cannot determine standard vs airport. |
| `AMENITY_INVALID` | true | true | true | Amenity row references unknown/inactive option. |
| `DUPLICATE_LEGACY_AMENITY` | true | true | true | Duplicate `(booking_id, amenity_option_id)` present. |

Rule: `SERVICE_CONTEXT_UNRESOLVED` alone does **not** block monetary normalization. A booking may be monetarily normalized (base/amenity/total cents + currency set, digest computed) with `service_context = 'unresolved'`. `contract_state` becomes `ready` only when no dimension applicable to readiness is still blocking; a `SERVICE_CONTEXT_UNRESOLVED` case blocks 2B/2C service-readiness but not 2A monetary readiness.

`contract_state = 'quarantined'` is set when any open reason has `blocks_monetary_normalization = true` or `blocks_service_readiness = true`. Payment-only blockers (`blocks_payment_enforcement`) do not by themselves force `quarantined`; they are consulted by 2D enforcement.

---

## F. Admin Resolution Transaction Order

RPC `admin_resolve_booking_contract_quarantine(_booking_id, _proposed jsonb, _resolved_reason_codes text[])`:

1. `BEGIN`.
2. `SELECT … FROM bookings WHERE id = _booking_id FOR UPDATE`.
3. `SELECT … FROM booking_contract_quarantine WHERE booking_id = _booking_id AND resolved_at IS NULL FOR UPDATE`; lock associated `booking_contract_quarantine_reasons` rows.
4. Validate `_proposed` fully (currency shape, cents ≥ 0, `service_context` in enum, totals consistent) **without writing**.
5. For each code in `_resolved_reason_codes`: verify it is currently open on this case and that `_proposed` supplies the evidence needed to resolve it; else raise typed error and roll back.
6. Mark those reason rows `resolved_at = now()`.
7. Recompute remaining blocker dimensions from the still-open reason rows.
8. If no remaining reason has `blocks_monetary_normalization = true`: write normalized monetary fields (`base_price_cents`, `amenity_total_cents`, `total_price_cents`, `currency`) from `_proposed`.
9. If `_proposed.service_context` supplied: update `service_context` and `classifier_evidence` / `classifier_material_digest` accordingly.
10. Recompute `content_digest` (J).
11. Increment `contract_version` **exactly once** for the transaction.
12. If no reason remains open on the case: set `resolved_at = now()`, `resolved_by = auth.uid()` on the case.
13. Recompute `contract_state`: `ready` iff no open reason blocks monetary or service readiness and a base is present; else `quarantined` if any blocker remains; else `draft`.
14. Write `_audit_write` with old/new snapshots and resolved reason codes.
15. `COMMIT`. Any failure raises and the whole transaction rolls back — booking update and quarantine mutation are atomic.

No reusable trigger-bypass flag is introduced. The trigger permits monotonic version increments (see G); the RPC does not need to sidestep the trigger.

---

## G. Contract-Version Safety Rules

Trigger `bookings_contract_version_guard` fires `BEFORE UPDATE ON bookings`.

Rules:
- Determine `contract_relevant_changed` from the field-materiality set (see H and the contract-version matrix from Revision 2.1: monetary fields, `pickup`, `pickup_time`, `ride_type`, `passengers`, structured address identity fields, `service_context`, `classifier_material_digest`, `contract_state`, `content_digest`).
- If `contract_relevant_changed = false`:
  - `NEW.contract_version` must equal `OLD.contract_version`. Any change raises `E_CONTRACT_VERSION_ILLEGAL_CHANGE`.
- If `contract_relevant_changed = true`:
  - If `NEW.contract_version = OLD.contract_version` (client left it untouched): trigger sets `NEW.contract_version = OLD.contract_version + 1`.
  - If `NEW.contract_version = OLD.contract_version + 1` (RPC set it explicitly): accepted.
  - Any other value — decrease, equal-with-material-change attempting to suppress, or jump > 1 — raises `E_CONTRACT_VERSION_ILLEGAL_CHANGE`.
- Migration ordering: the initialization step sets `contract_version = 1` for every existing row **before** the trigger is installed. The trigger is only installed after initialization completes.

Direct write path:
- Before revoking direct `UPDATE` on `bookings` from `authenticated`, inventory every current mutation site (server functions, admin RPCs, driver flows, dispatch flows). Any legitimate path that still updates `bookings` directly must be moved behind an approved RPC or explicitly documented. The revoke is performed only in the 2A constraints stage after the inventory is complete and all remaining paths are approved RPCs. This inventory task is scheduled inside 2A-3.

---

## H. Classifier Materiality Rules

New column: `bookings.classifier_material_digest bytea` (nullable).

Material inputs (feed into `classifier_material_digest` and, transitively, into `content_digest`):
- `service_context`
- `pickup_context`, `dropoff_context` (structured airport / non-airport classification)
- `classifier_version`
- `classifier_material_digest` itself (once written) is what the booking-level digest consumes; the digest function does not re-hash the raw `classifier_evidence`.

Non-material (stored in `classifier_evidence` jsonb, never bump `contract_version`):
- Debug timestamps, log lines, human-readable explanations.
- Confidence scores and probability breakdowns.
- Model routing metadata.
- JSON key ordering / whitespace.

The classifier writer is responsible for computing `classifier_material_digest` from the material inputs using the same fixed binary encoding described in J (subset applied to classifier fields). Updates to `classifier_evidence` that leave `classifier_material_digest` unchanged do not bump `contract_version`.

---

## I. Paid Reconciliation Authority

For historically paid bookings (`bookings.paid = true`):
- Authoritative historical evidence is the Stripe Checkout Session, its PaymentIntent, and the associated line items retrieved via Stripe API.
- Current `booking_amenities` rows are diagnostic only. They must never be used to reconstruct historical amenity totals for a paid booking.
- If Stripe line items cannot cleanly separate base fare from amenity charges, the booking is quarantined with `PAID_PAYMENT_EVIDENCE_MISSING` (or the specific mismatch code) and left for admin manual resolution.
- Paid reconciliation is **not** performed inside any Batch 2A migration. The migration only opens quarantine cases with the applicable payment-dimension reason codes when paid bookings cannot be normalized from local data.

Ownership: paid reconciliation is implemented as a server function (TanStack `createServerFn`, admin-only, `SECURITY DEFINER` RPC below). It is scheduled as a **2A follow-up task**, executed after 2A-3 completes and before 2D depends on payment evidence. It is not a migration dependency and does not block 2A rollout.

---

## J. Exact Database-Authoritative Digest Encoding

PostgreSQL is the sole authoritative generator of `content_digest`. TypeScript never computes the digest; it only reads the stored value and validates published fixtures during tests.

Function: `public.booking_content_digest(b bookings) returns bytea` — `SECURITY DEFINER`, `IMMUTABLE`, `SET search_path = public`.

Fixed binary encoding (all big-endian; presence byte 0x00 = null, 0x01 = present):

1. Schema prefix: literal bytes `HL\x02\x0A` (four bytes; `\x02` = major, `\x0A` = minor).
2. `contract_version` — int32 signed BE (4 bytes).
3. `pickup_time` — presence byte, then int64 signed BE = UTC epoch **microseconds** (`extract(epoch from pickup_time at time zone 'UTC') * 1_000_000`, truncated toward zero).
4. `passengers` — presence byte, int32 signed BE.
5. `ride_type` — presence byte, uint32 BE byte length, then UTF-8 bytes.
6. `service_context` — presence byte, uint32 BE length, UTF-8 bytes (values are lowercased ASCII).
7. `currency` — presence byte, uint32 BE length, UTF-8 bytes (lowercased before encoding).
8. `base_price_cents` — presence byte, int64 signed BE.
9. `amenity_total_cents` — presence byte, int64 signed BE.
10. `total_price_cents` — presence byte, int64 signed BE.
11. `pickup_place_id` — presence byte, uint32 BE length, UTF-8 bytes.
12. `dropoff_place_id` — presence byte, uint32 BE length, UTF-8 bytes.
13. `pickup_lat` / `pickup_lng` / `dropoff_lat` / `dropoff_lng` — presence byte, then int64 signed BE of `round(value * 1_000_000)` (six-decimal fixed point). Each coordinate is a separate field.
14. `pickup_components_hash` — a **separately defined database-generated stable hash** (`public.address_components_hash(jsonb) returns bytea`, a SHA-256 over a canonical scalar projection of the JSON with sorted keys and stable string encoding, defined in the same migration). Represented in the digest as presence byte + 32 bytes. Same for `dropoff_components_hash`.
15. `classifier_material_digest` — presence byte + 32 bytes.
16. Amenity segment — presence byte, then uint32 BE count `N`, then `N` entries sorted ascending by `(amenity_option_id, amenity_code)`:
    - `amenity_option_id` — presence byte, 16 bytes uuid.
    - `amenity_code` — uint32 BE length, UTF-8 bytes.
    - `quantity` — int32 signed BE.
    - `price_delta_cents` — int64 signed BE.
    - `complimentary` — 1 byte (0/1).

Raw `pickup`/`dropoff` free-text strings are **excluded** from the digest in favor of the structured scalar identity (`place_id` + coordinates + components-hash). Bookings that lack structured identity are quarantined (see K/E) rather than digested from free text.

`content_digest = sha256(byte_sequence)`.

Test vectors (published as fixtures in migration and in TS test):

Vector V1 — minimal booking, no amenities, `service_context='standard'`, USD, one passenger, escalade, base=15000, amenity_total=0, total=15000, `pickup_time = 2026-01-15T18:30:00Z`, structured pickup+dropoff with fixed uuids/coords, `classifier_material_digest` fixed:
- Expected hex: `e3b0c4429...` (fixture; exact value pinned in the migration and TS test at implementation time from the reference encoder).

Vector V2 — same as V1 with one amenity (`quantity=2, price_delta_cents=2500, complimentary=false`), `amenity_total=5000`, `total=20000`.

Vector V3 — same as V1 with `service_context='unresolved'` and `classifier_material_digest = NULL`.

The migration installs the encoder and asserts these three fixtures at end of the schema stage; deploy halts if any digest mismatches.

TypeScript role: `src/lib/booking-digest.ts` (added in a later batch, not 2A) reads the stored digest and compares against published fixtures in tests; it never re-derives digests for production traffic.

---

## K. Amenity Duplicate Preflight

Before creating `UNIQUE (booking_id, amenity_option_id)` on `booking_amenities`:

1. Add nullable `amenity_option_id uuid references amenity_options(id)` on `booking_amenities` in 2A-1.
2. Backfill `amenity_option_id` from `amenity_code` where a live option is resolvable.
3. **Explicit duplicate query** in 2A-2 preflight:
   ```sql
   SELECT booking_id, amenity_option_id, count(*)
   FROM booking_amenities
   WHERE amenity_option_id IS NOT NULL
   GROUP BY 1,2 HAVING count(*) > 1;
   ```
4. For every duplicate group: open a quarantine case on the affected booking with reason `DUPLICATE_LEGACY_AMENITY`. Do not silently delete or merge.
5. Do **not** create the unique index while any `DUPLICATE_LEGACY_AMENITY` case is open.
6. Do not normalize monetary fields for those bookings until duplicates are resolved via admin flow.

Staged approach: 2A-2 (backfill/preflight) is separate from 2A-3 (constraints/index). 2A-3 only creates the unique index after the duplicate query returns zero rows.

---

## L. Three-Stage Batch 2A Deployment

**2A-1 — Schema & functions migration** (single migration, no data mutation beyond additive defaults):
- Add nullable columns on `bookings` (B).
- Create `booking_contract_quarantine_reason_catalog` and seed rows (E). GRANT SELECT to `authenticated`.
- Create `booking_contract_quarantine_reasons`.
- Add nullable `amenity_option_id` on `booking_amenities`.
- Install `address_components_hash`, `booking_content_digest`, quarantine RPCs, `set_booking_amenities` (updated), `admin_resolve_booking_contract_quarantine`, and typed-error helpers.
- Do **not** install the contract-version trigger yet.
- Do **not** create the unique index yet.
- Assert digest fixtures.
- GRANTs: `SELECT`+`EXECUTE` scoped per RPC; `service_role` full; `anon` none. Direct `UPDATE/INSERT/DELETE` on new tables denied to `authenticated` (RPC-only).

**2A-2 — Resumable idempotent backfill** (runs as a controlled admin server function, not inside a migration):
- Preflight metrics captured and logged:
  - `bookings_total`, `bookings_paid`, `bookings_unpaid`.
  - `booking_amenities_total`.
  - `duplicate_amenity_groups` (K).
  - Estimated normalization-eligible count and quarantine-eligible count.
- Checkpoint key: `(booking_id)` ordered ascending; last processed id persisted in a `contract_backfill_checkpoint` row.
- Idempotency: each booking is processed by a single UPSERT-style routine that recomputes and writes only when values change; re-running the job is safe.
- Initialize `contract_version = 1` for every existing row (once).
- Install the contract-version trigger only after initialization completes.
- Classify `service_context` from address components + place types; when the classifier is inconclusive, write `service_context = 'unresolved'` and open `SERVICE_CONTEXT_UNRESOLVED` (does not block monetary normalization).
- Normalize monetary fields where inputs are unambiguous (`price` preferred over `suggested_price`, currency defaults to `'usd'`, cents = round(dollars*100), bigint-checked). Ambiguous cases open `PRICE_AUTHORITY_UNRESOLVED` / `CURRENCY_MISMATCH` / `AMOUNT_OVERFLOW` quarantine.
- Set `contract_state = 'ready'` where safe; `quarantined` where any monetary or service blocker exists; `draft` otherwise.
- Compute `content_digest` for every ready or quarantined row where inputs allow.
- Validation queries at end of backfill:
  - No `bookings.contract_state = 'ready'` row has NULL `total_price_cents` or NULL `currency`.
  - No booking has an open `DUPLICATE_LEGACY_AMENITY` reason without a matching duplicate group still present.
  - Every `contract_state = 'quarantined'` booking has at least one open reason.

**2A-3 — Constraints & index finalization** (small migration, after validation passes):
- Create `UNIQUE (booking_id, amenity_option_id) WHERE amenity_option_id IS NOT NULL` on `booking_amenities` only if the duplicate query returns zero rows.
- Add CHECK constraints on new bookings columns (`contract_state IN (...)`, `currency ~ '^[a-z]{3}$'`, cents ≥ 0, etc.) using `NOT VALID` + `VALIDATE CONSTRAINT` to avoid a full-table lock.
- Complete the direct-update inventory (G) and revoke direct `UPDATE ON bookings FROM authenticated` after every legitimate path has been moved to an approved RPC.
- Do **not** claim SAVEPOINT batching reduces transaction size; 2A-2 avoids monolithic transactions by running per-booking outside a single migration transaction.

---

## M. Exact Files Changed

Batch 2A production file scope (planning: these are the files that will change when 2A is implemented in a future turn — not now):

- `src/lib/payments.functions.ts` — add readiness guard only (D). No pricing changes; base amount stays `price ?? suggested_price`; amenity line items unchanged.
- `src/routes/book.tsx` — always call `setBookingAmenities` including with `[]`; on any failure, show retryable error and neither navigate to `/history` nor open checkout; keep server error messages typed (C).
- `src/lib/amenities.functions.ts` — `setBookingAmenities` remains the wrapper; RPC contract updated to full-replacement semantics with typed errors (`E_CONTRACT_QUARANTINED`, `E_AMENITY_INVALID`).
- Migrations:
  - 2A-1 schema & functions (single file).
  - 2A-3 constraints & index (single file).
- Admin unresolved-quarantine UI:
  - `src/components/admin/BookingContractQuarantinePanel.tsx` (new).
  - `src/routes/admin.operations.tsx` or a dedicated `admin.quarantine.tsx` route (final placement decided at implementation time; a single new leaf route is preferred so it can own its own `head()` metadata).
  - `src/lib/booking-quarantine.functions.ts` (new; admin server functions calling the resolve RPC).

Not changed in 2A:
- `src/lib/dispatch.functions.ts` beyond what is required to remove any stale `bookings.dispatch_status` reference (there are none in the current tree; verified during planning).
- Stripe client, webhook route, or checkout UI beyond the readiness guard.

---

## N. Tests and Acceptance Gates

Database:
- Digest fixtures V1/V2/V3 assert equal to expected bytes at end of 2A-1.
- `contract_version` monotonicity: attempt decrement → raises; attempt jump=2 → raises; attempt same-value-with-material-change → raises; attempt +1 explicit with material change → accepted.
- `set_booking_amenities([])` on draft booking with known base → `contract_state='ready'`, `amenity_total_cents=0`, `total_price_cents=base`, `contract_version` bumped exactly once.
- `set_booking_amenities` re-called with identical set on a `ready` booking → no-op, no version bump.
- Quarantine dimensions: `SERVICE_CONTEXT_UNRESOLVED` alone leaves `contract_state='ready'` with normalized monetary fields; `PRICE_AUTHORITY_UNRESOLVED` forces `quarantined`.
- Duplicate preflight: seed a duplicate → 2A-3 refuses to create the unique index and logs which bookings are blocked.

Checkout:
- `createBookingCheckout` on `contract_state='draft'` → typed error `E_CONTRACT_NOT_READY`; no Stripe Session created.
- `createBookingCheckout` on `contract_state='quarantined'` → same error.
- `createBookingCheckout` on `contract_state='ready'` with existing `price` → Stripe Session created; amount equals `round(price*100)` plus current amenity line items (formula unchanged).

Route:
- `/book` submit with zero amenities → booking + `setBookingAmenities([])` both succeed → success toast + navigation to `/history`.
- `/book` submit where `setBookingAmenities` fails → no success toast, no navigation, retry button re-invokes the same full-replacement call safely.

Admin:
- Admin resolve flow updates monetary fields and `service_context` atomically; failed validation rolls back both booking and quarantine mutations.
- Audit rows exist for every resolution.

TypeScript fixtures:
- `booking-digest.fixtures.ts` (added in a later batch) matches DB-computed digests for V1/V2/V3.

Acceptance gate for 2A rollout:
- All 2A-2 validation queries return zero anomalies.
- 2A-3 creates the unique index without violations.
- Preview environment runs the three-stage sequence end-to-end against a copy of production shape.

---

## O. Evidence-Preserving Rollback

Production rollback after 2A-2 has written evidence is **non-destructive**:

- Disable or replace new triggers/functions (`DROP TRIGGER`, `CREATE OR REPLACE FUNCTION` to previous behavior).
- Restore prior RPC bodies for `set_booking_amenities` and any changed function only if required.
- Keep every additive monetary column (`base_price_cents`, `amenity_total_cents`, `total_price_cents`, `currency`), `contract_version`, `contract_state`, `service_context`, `classifier_evidence`, `classifier_material_digest`, `content_digest` — even if unused.
- Keep every `booking_contract_quarantine` case, reason link row, catalog row.
- Keep every `_audit_write` entry.
- Never drop populated evidence tables, columns, or indexes.
- The checkout readiness guard can be feature-flagged off (env var / DB-config row) to fall back to prior behavior without dropping schema.

Destructive rollback (dropping columns/tables) is allowed only in a preview environment that has never held production evidence.

---

## P. Deferred Items

- Policy bundles, resolvers, active-bundle contract — Batch 2B.
- Immutable booking-policy snapshots and shadow review — Batch 2C. 2C will install a durable trigger or transactional validation such that an accepted review requires `review.contract_version = bookings.contract_version`; stale reviews are rejected transactionally. `pg_notify` is not part of correctness; it may be used only for optional UI/cache refresh.
- Payment gate `shadow | enforce | paused` — Batch 2D.
- Paid Stripe reconciliation server function — 2A follow-up (I), scheduled after 2A-3 and before any 2D dependency; not a migration dependency.
- IP/UA capture on reviews — deferred pending legal retention decision.
- `distance_km`-based pricing — future batch (column already present; unused in 2A).
- Merging `create_booking` + amenity finalization into a single RPC — deferred; 2A keeps the two-call flow with the retryable finalization guarantee in C.

---

PLAN STATUS: REVISION 2.3 — REMAINING BATCH 2A BLOCKERS CORRECTED

IMPLEMENTATION STATUS: BLOCKED — AWAITING CODEX REVIEW

No files changed.
