-- =====================================================================
-- HarborLine Batch 2A — Stage M-1 (Additive Schema) ROLLBACK
--
-- SCOPE: Reverses supabase/migrations/20260723050000_batch2a_m1_additive.sql
--
-- SAFE-USE WINDOW (per Revision 2.8 §R "Pre-production zero-write window"):
--   This destructive rollback is permitted ONLY when ALL of the following
--   are simultaneously true:
--
--     SELECT COUNT(*) = 0 FROM public.booking_contract_quarantine_cases;
--     SELECT COUNT(*) = 0 FROM public.booking_contract_quarantine_case_reasons;
--     SELECT COUNT(*) = 0 FROM public.booking_contract_quarantine_reason_catalog;
--     SELECT COUNT(*) = 0 FROM public.booking_amenity_duplicate_evidence;
--     SELECT COUNT(*) = 0 FROM public.bookings WHERE contract_state IS NOT NULL;
--     SELECT COUNT(*) = 0 FROM public.bookings WHERE content_digest_updated_at IS NOT NULL;
--
--   If ANY row exists in any of the new tables, or ANY booking row has
--   contract_state / content_digest_updated_at set, rollback becomes
--   non-destructive per §R item 2 — do NOT run this script; ship a
--   forward-fix migration instead.
--
-- ORDER: reverse of the UP migration — self-test / fixtures require
-- nothing to undo (pure functions); helpers are dropped after tables that
-- reference them (none do in M-1); tables are dropped in FK-safe order;
-- additive columns on bookings dropped last.
-- =====================================================================

BEGIN;

-- 1) Quarantine linkage tables (children first)
DROP TABLE IF EXISTS public.booking_contract_quarantine_case_reasons;
DROP TABLE IF EXISTS public.booking_amenity_duplicate_evidence;
DROP TABLE IF EXISTS public.booking_contract_quarantine_cases;
DROP TABLE IF EXISTS public.booking_contract_quarantine_reason_catalog;

-- 2) Encoder helpers
DROP FUNCTION IF EXISTS public._hlbc2a_booking_digest(
  uuid, uuid, text, text, timestamptz, bytea, bytea, bytea, numeric,
  bigint, bigint, bigint, text, bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_amenity_set_digest(public._hlbc2a_amenity_item[]);
DROP FUNCTION IF EXISTS public._hlbc2a_classifier_digest(bytea, bytea, boolean, boolean);
DROP FUNCTION IF EXISTS public._hlbc2a_addr_digest(text, text, bigint, bigint);
DROP FUNCTION IF EXISTS public._hlbc2a_header(text);
DROP FUNCTION IF EXISTS public._hlbc2a_field(text, bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_v_bool(boolean);
DROP FUNCTION IF EXISTS public._hlbc2a_v_hex(bytea);
DROP FUNCTION IF EXISTS public._hlbc2a_v_uuid(uuid);
DROP FUNCTION IF EXISTS public._hlbc2a_v_int(bigint);
DROP FUNCTION IF EXISTS public._hlbc2a_v_text(text);

-- 3) Composite type
DROP TYPE IF EXISTS public._hlbc2a_amenity_item;

-- 4) Additive columns on public.bookings
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
