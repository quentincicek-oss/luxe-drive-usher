-- =====================================================================
-- HarborLine Batch 2A — Stage M-1 (Additive Schema) ROLLBACK
--
-- SCOPE: Reverses supabase/migrations/
--   20260723184317_c07fef2d-0c0a-4a0c-ad47-c809030d0083.sql
--
-- SAFE-USE WINDOW (per Revision 2.8 §R "Pre-production zero-write window"):
--   Executable fail-closed guard below atomically aborts the rollback (with
--   NO drops issued) if ANY of the following are non-empty at guard time:
--
--     * public.booking_contract_quarantine_cases
--     * public.booking_contract_quarantine_case_reasons
--     * public.booking_contract_quarantine_reason_catalog
--     * public.booking_amenity_duplicate_evidence
--     * public.bookings rows where any of the 13 additive contract columns
--       (contract_state, contract_version, service_context, currency,
--        content_digest, classifier_digest, pickup_addr_digest,
--        dropoff_addr_digest, amenity_set_digest, base_price_cents,
--        amenity_total_cents, total_price_cents, content_digest_updated_at)
--       IS NOT NULL
--
--   Guard runs INSIDE the same transaction as the drops, after taking
--   ACCESS EXCLUSIVE on the four new tables and SHARE ROW EXCLUSIVE on
--   public.bookings so no concurrent writer can race between the guard
--   and the drops.
--
--   External-dependency protection: this script issues every DROP with
--   default RESTRICT semantics (NO CASCADE anywhere). If any object
--   outside the M-1 additive set depends on the encoder/helper
--   functions or the _hlbc2a_amenity_item composite type, Postgres
--   raises "cannot drop ... because other objects depend on it" and
--   the whole transaction aborts atomically, leaving M-1 intact. We
--   deliberately do NOT hand-roll a pg_depend probe for the helpers /
--   composite type: M-1's own functions register pg_depend rows
--   against _hlbc2a_amenity_item (classid=pg_proc, refclassid=pg_type)
--   which such a probe would misread as external, causing every
--   rollback to abort even in a clean zero-write window.
--
-- DROP ORDER (dependency-safe reverse of UP; RESTRICT catches surprises):
--   1. case_reasons + duplicate_evidence (children of cases)
--   2. cases (child of reason_catalog)
--   3. reason_catalog
--   4. digest functions (booking / amenity_set / classifier / addr)
--      — drop these FIRST so the helpers + composite become leaf objects
--   5. header/field/value encoder helpers
--   6. composite type _hlbc2a_amenity_item
--   7. additive columns on public.bookings
-- =====================================================================

BEGIN;

-- Lock scope so guard + drops are atomic against concurrent writers.
LOCK TABLE
  public.booking_contract_quarantine_case_reasons,
  public.booking_amenity_duplicate_evidence,
  public.booking_contract_quarantine_cases,
  public.booking_contract_quarantine_reason_catalog
  IN ACCESS EXCLUSIVE MODE;

LOCK TABLE public.bookings IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------
-- Executable fail-closed guard. RAISE EXCEPTION aborts the transaction
-- BEFORE any DROP runs. Comments alone are not sufficient.
-- ---------------------------------------------------------------------
DO $guard$
DECLARE
  v_cases            bigint;
  v_case_reasons     bigint;
  v_reason_catalog   bigint;
  v_dup_evidence     bigint;
  v_bookings_dirty   bigint;
BEGIN
  SELECT count(*) INTO v_cases
    FROM public.booking_contract_quarantine_cases;
  SELECT count(*) INTO v_case_reasons
    FROM public.booking_contract_quarantine_case_reasons;
  SELECT count(*) INTO v_reason_catalog
    FROM public.booking_contract_quarantine_reason_catalog;
  SELECT count(*) INTO v_dup_evidence
    FROM public.booking_amenity_duplicate_evidence;

  IF v_cases > 0 OR v_case_reasons > 0
     OR v_reason_catalog > 0 OR v_dup_evidence > 0 THEN
    RAISE EXCEPTION
      'HLBC2A M-1 rollback aborted: quarantine tables non-empty '
      '(cases=%, case_reasons=%, reason_catalog=%, dup_evidence=%). '
      'Zero-write window violated — ship a forward-fix migration.',
      v_cases, v_case_reasons, v_reason_catalog, v_dup_evidence;
  END IF;

  SELECT count(*) INTO v_bookings_dirty
    FROM public.bookings
    WHERE contract_state              IS NOT NULL
       OR contract_version            IS NOT NULL
       OR service_context             IS NOT NULL
       OR currency                    IS NOT NULL
       OR content_digest              IS NOT NULL
       OR classifier_digest           IS NOT NULL
       OR pickup_addr_digest          IS NOT NULL
       OR dropoff_addr_digest         IS NOT NULL
       OR amenity_set_digest          IS NOT NULL
       OR base_price_cents            IS NOT NULL
       OR amenity_total_cents         IS NOT NULL
       OR total_price_cents           IS NOT NULL
       OR content_digest_updated_at   IS NOT NULL;

  IF v_bookings_dirty > 0 THEN
    RAISE EXCEPTION
      'HLBC2A M-1 rollback aborted: % public.bookings row(s) have at '
      'least one of the 13 additive contract columns populated. '
      'Zero-write window violated — ship a forward-fix migration.',
      v_bookings_dirty;
  END IF;

  -- Note: external-dependency detection for the encoder helper
  -- functions and the _hlbc2a_amenity_item composite type is handled
  -- by issuing every DROP below with default RESTRICT semantics.
  -- A hand-rolled pg_depend probe would misclassify M-1's own
  -- functions (which legitimately depend on the composite type via
  -- classid=pg_proc / refclassid=pg_type) as external, aborting
  -- every rollback even in a clean zero-write window.
END
$guard$;

-- ---------------------------------------------------------------------
-- Drops (dependency-safe reverse order of the UP migration).
-- ---------------------------------------------------------------------

-- 1) Quarantine linkage tables (children first)
DROP TABLE IF EXISTS public.booking_contract_quarantine_case_reasons;
DROP TABLE IF EXISTS public.booking_amenity_duplicate_evidence;
DROP TABLE IF EXISTS public.booking_contract_quarantine_cases;
DROP TABLE IF EXISTS public.booking_contract_quarantine_reason_catalog;

-- 2) Digest functions (depend on encoder helpers + composite type)
DROP FUNCTION IF EXISTS public._hlbc2a_booking_digest(
  uuid, uuid, text, text, timestamptz, bytea, bytea, bytea, numeric,
  bigint, bigint, bigint, text, bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_amenity_set_digest(public._hlbc2a_amenity_item[]);
DROP FUNCTION IF EXISTS public._hlbc2a_classifier_digest(bytea, bytea, boolean, boolean);
DROP FUNCTION IF EXISTS public._hlbc2a_addr_digest(text, text, bigint, bigint);

-- 3) Encoder helper functions
DROP FUNCTION IF EXISTS public._hlbc2a_header(text);
DROP FUNCTION IF EXISTS public._hlbc2a_field(text, bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_v_bool(boolean);
DROP FUNCTION IF EXISTS public._hlbc2a_v_hex(bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_v_uuid(uuid);
DROP FUNCTION IF EXISTS public._hlbc2a_v_int(bigint);
DROP FUNCTION IF EXISTS public._hlbc2a_v_text(text);

-- 4) Composite type used by amenity-set digest
DROP TYPE IF EXISTS public._hlbc2a_amenity_item;

-- 5) Additive columns on public.bookings
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS content_digest_updated_at,
  DROP COLUMN IF EXISTS total_price_cents,
  DROP COLUMN IF EXISTS amenity_total_cents,
  DROP COLUMN IF EXISTS base_price_cents,
  DROP COLUMN IF EXISTS amenity_set_digest,
  DROP COLUMN IF EXISTS dropoff_addr_digest,
  DROP COLUMN IF EXISTS pickup_addr_digest,
  DROP COLUMN IF EXISTS classifier_digest,
  DROP COLUMN IF EXISTS content_digest,
  DROP COLUMN IF EXISTS contract_version,
  DROP COLUMN IF EXISTS contract_state,
  DROP COLUMN IF EXISTS service_context,
  DROP COLUMN IF EXISTS currency;

COMMIT;
