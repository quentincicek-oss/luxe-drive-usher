-- =====================================================================
-- HarborLine Batch 2A — Stage M-1 (Additive Schema Only)
-- Revision 2.8 §C, §E, §F, §G, §J
-- Additive-only. No revokes. No behavior changes. No RPC bodies.
-- Fixture self-test aborts migration atomically on any hash mismatch.
-- =====================================================================

-- §C Additive nullable contract columns on public.bookings ------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS currency                   text        NULL,
  ADD COLUMN IF NOT EXISTS service_context            text        NULL,
  ADD COLUMN IF NOT EXISTS contract_state             text        NULL,
  ADD COLUMN IF NOT EXISTS contract_version           integer     NULL,
  ADD COLUMN IF NOT EXISTS content_digest             bytea       NULL,
  ADD COLUMN IF NOT EXISTS classifier_digest          bytea       NULL,
  ADD COLUMN IF NOT EXISTS pickup_addr_digest         bytea       NULL,
  ADD COLUMN IF NOT EXISTS dropoff_addr_digest        bytea       NULL,
  ADD COLUMN IF NOT EXISTS amenity_set_digest         bytea       NULL,
  ADD COLUMN IF NOT EXISTS base_price_cents           bigint      NULL,
  ADD COLUMN IF NOT EXISTS amenity_total_cents        bigint      NULL,
  ADD COLUMN IF NOT EXISTS total_price_cents          bigint      NULL,
  ADD COLUMN IF NOT EXISTS content_digest_updated_at  timestamptz NULL;

-- §J.1 Quarantine reason catalog --------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_contract_quarantine_reason_catalog (
  code               text         PRIMARY KEY,
  description        text         NOT NULL,
  blocks_checkout    boolean      NOT NULL,
  blocks_digest      boolean      NOT NULL,
  blocks_activation  boolean      NOT NULL,
  active             boolean      NOT NULL DEFAULT true,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_contract_quarantine_reason_catalog OWNER TO postgres;
GRANT ALL ON public.booking_contract_quarantine_reason_catalog TO service_role;
ALTER TABLE public.booking_contract_quarantine_reason_catalog ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: reads flow through SECURITY DEFINER RPCs (Turn 2).

-- §J.2 Quarantine cases -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_contract_quarantine_cases (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid         NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  state             text         NOT NULL CHECK (state IN ('open','resolved','dismissed')),
  opened_at         timestamptz  NOT NULL DEFAULT now(),
  resolved_at       timestamptz  NULL,
  resolved_by       uuid         NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resolution_notes  text         NULL
);
ALTER TABLE public.booking_contract_quarantine_cases OWNER TO postgres;
GRANT ALL ON public.booking_contract_quarantine_cases TO service_role;
ALTER TABLE public.booking_contract_quarantine_cases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS booking_contract_quarantine_cases_booking_idx
  ON public.booking_contract_quarantine_cases (booking_id);
-- §J: separate standalone partial unique index (NOT an inline constraint).
CREATE UNIQUE INDEX IF NOT EXISTS booking_contract_quarantine_one_open_case
  ON public.booking_contract_quarantine_cases (booking_id)
  WHERE state = 'open';

-- §J.3 Quarantine case reasons ----------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_contract_quarantine_case_reasons (
  case_id      uuid         NOT NULL REFERENCES public.booking_contract_quarantine_cases(id) ON DELETE RESTRICT,
  reason_code  text         NOT NULL REFERENCES public.booking_contract_quarantine_reason_catalog(code) ON DELETE RESTRICT,
  evidence     jsonb        NOT NULL,
  actor        uuid         NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, reason_code)
);
ALTER TABLE public.booking_contract_quarantine_case_reasons OWNER TO postgres;
GRANT ALL ON public.booking_contract_quarantine_case_reasons TO service_role;
ALTER TABLE public.booking_contract_quarantine_case_reasons ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS booking_contract_quarantine_case_reasons_case_idx
  ON public.booking_contract_quarantine_case_reasons (case_id);
CREATE INDEX IF NOT EXISTS booking_contract_quarantine_case_reasons_code_idx
  ON public.booking_contract_quarantine_case_reasons (reason_code);

-- Duplicate consolidation evidence (referenced in Turn 2 admin RPC). --
CREATE TABLE IF NOT EXISTS public.booking_amenity_duplicate_evidence (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid         NULL REFERENCES public.booking_contract_quarantine_cases(id) ON DELETE RESTRICT,
  booking_id          uuid         NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  original_row_id     uuid         NOT NULL,
  amenity_option_id   uuid         NOT NULL,
  amenity_code        text         NULL,
  amenity_name        text         NULL,
  quantity            integer      NULL,
  price_delta_cents   bigint       NULL,
  currency            text         NULL,
  complimentary       boolean      NULL,
  snapshot            jsonb        NOT NULL,
  archived_at         timestamptz  NOT NULL DEFAULT now(),
  archived_by         uuid         NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
ALTER TABLE public.booking_amenity_duplicate_evidence OWNER TO postgres;
GRANT ALL ON public.booking_amenity_duplicate_evidence TO service_role;
ALTER TABLE public.booking_amenity_duplicate_evidence ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS booking_amenity_duplicate_evidence_booking_idx
  ON public.booking_amenity_duplicate_evidence (booking_id);
CREATE INDEX IF NOT EXISTS booking_amenity_duplicate_evidence_case_idx
  ON public.booking_amenity_duplicate_evidence (case_id);

-- =====================================================================
-- §E Canonical encoder — pure IMMUTABLE builders. No SELECT, no now(),
-- no session state. Byte format: "HLBC2A-1" 0x1F <domain> 0x1E, then
-- repeated (<key> 0x1F <value> 0x1E).
-- =====================================================================
CREATE OR REPLACE FUNCTION public._hlbc2a_v_text(v text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v IS NULL THEN convert_to('N:', 'UTF8')
              ELSE convert_to('T:' || normalize(v, NFC), 'UTF8') END
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_v_int(v bigint)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v IS NULL THEN convert_to('N:', 'UTF8')
              ELSE convert_to('I:' || v::text, 'UTF8') END
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_v_uuid(v uuid)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v IS NULL THEN convert_to('N:', 'UTF8')
              ELSE convert_to('U:' || replace(lower(v::text), '-', ''), 'UTF8') END
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_v_hex(v bytea)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v IS NULL THEN convert_to('N:', 'UTF8')
              ELSE convert_to('H:' || encode(v, 'hex'), 'UTF8') END
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_v_bool(v boolean)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v IS NULL THEN convert_to('N:', 'UTF8')
              WHEN v         THEN convert_to('B:1', 'UTF8')
              ELSE                convert_to('B:0', 'UTF8') END
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_field(k text, v bytea)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT convert_to(k, 'UTF8') || '\x1f'::bytea || v || '\x1e'::bytea
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_header(domain text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT convert_to('HLBC2A-1', 'UTF8') || '\x1f'::bytea
      || convert_to(domain, 'UTF8')     || '\x1e'::bytea
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_addr_digest(
  label text, place_id text, lat_e7 bigint, lon_e7 bigint
) RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT sha256(
       public._hlbc2a_header('addr.v1')
    || public._hlbc2a_field('label',    public._hlbc2a_v_text(label))
    || public._hlbc2a_field('place_id', public._hlbc2a_v_text(place_id))
    || public._hlbc2a_field('lat_e7',   public._hlbc2a_v_int(lat_e7))
    || public._hlbc2a_field('lon_e7',   public._hlbc2a_v_int(lon_e7))
  )
$$;

CREATE OR REPLACE FUNCTION public._hlbc2a_classifier_digest(
  pickup_h bytea, dropoff_h bytea, pickup_airport boolean, dropoff_airport boolean
) RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT sha256(
       public._hlbc2a_header('classifier.v1')
    || public._hlbc2a_field('pickup',          public._hlbc2a_v_hex(pickup_h))
    || public._hlbc2a_field('dropoff',         public._hlbc2a_v_hex(dropoff_h))
    || public._hlbc2a_field('pickup_airport',  public._hlbc2a_v_bool(pickup_airport))
    || public._hlbc2a_field('dropoff_airport', public._hlbc2a_v_bool(dropoff_airport))
  )
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '_hlbc2a_amenity_item') THEN
    CREATE TYPE public._hlbc2a_amenity_item AS (
      amenity_option_id  uuid,
      amenity_code       text,
      amenity_name       text,
      quantity           integer,
      price_delta_cents  bigint,
      currency           text,
      complimentary      boolean
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._hlbc2a_amenity_set_digest(items public._hlbc2a_amenity_item[])
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  sorted public._hlbc2a_amenity_item[];
  buf    bytea;
  it     public._hlbc2a_amenity_item;
  i      integer := 0;
  p      text;
  cnt    integer;
BEGIN
  IF items IS NULL THEN
    sorted := ARRAY[]::public._hlbc2a_amenity_item[];
  ELSE
    SELECT COALESCE(array_agg(x ORDER BY x.amenity_option_id),
                    ARRAY[]::public._hlbc2a_amenity_item[])
      INTO sorted FROM unnest(items) AS x;
  END IF;
  cnt := COALESCE(array_length(sorted, 1), 0);
  buf := public._hlbc2a_header('amenity_set.v1')
      || public._hlbc2a_field('count', public._hlbc2a_v_int(cnt));
  IF cnt > 0 THEN
    FOREACH it IN ARRAY sorted LOOP
      p := 'i' || i::text || '.';
      buf := buf
        || public._hlbc2a_field(p || 'amenity_option_id', public._hlbc2a_v_uuid(it.amenity_option_id))
        || public._hlbc2a_field(p || 'amenity_code',      public._hlbc2a_v_text(it.amenity_code))
        || public._hlbc2a_field(p || 'amenity_name',      public._hlbc2a_v_text(it.amenity_name))
        || public._hlbc2a_field(p || 'quantity',          public._hlbc2a_v_int(it.quantity))
        || public._hlbc2a_field(p || 'price_delta_cents', public._hlbc2a_v_int(it.price_delta_cents))
        || public._hlbc2a_field(p || 'currency',          public._hlbc2a_v_text(it.currency))
        || public._hlbc2a_field(p || 'complimentary',     public._hlbc2a_v_bool(it.complimentary));
      i := i + 1;
    END LOOP;
  END IF;
  RETURN sha256(buf);
END;
$$;

-- Booking digest excludes contract_version per §E/§F.
CREATE OR REPLACE FUNCTION public._hlbc2a_booking_digest(
  booking_id uuid, passenger_id uuid, ride_type text, service_context text,
  pickup_time timestamptz, pickup_addr_digest bytea, dropoff_addr_digest bytea,
  classifier_digest bytea, distance_km numeric,
  base_price_cents bigint, amenity_total_cents bigint, total_price_cents bigint,
  currency text, amenity_set_digest bytea
) RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT sha256(
       public._hlbc2a_header('booking.v1')
    || public._hlbc2a_field('booking_id',          public._hlbc2a_v_uuid(booking_id))
    || public._hlbc2a_field('passenger_id',        public._hlbc2a_v_uuid(passenger_id))
    || public._hlbc2a_field('ride_type',           public._hlbc2a_v_text(ride_type))
    || public._hlbc2a_field('service_context',     public._hlbc2a_v_text(service_context))
    || public._hlbc2a_field('pickup_time',
         public._hlbc2a_v_text(to_char(pickup_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    || public._hlbc2a_field('pickup_addr',         public._hlbc2a_v_hex(pickup_addr_digest))
    || public._hlbc2a_field('dropoff_addr',        public._hlbc2a_v_hex(dropoff_addr_digest))
    || public._hlbc2a_field('classifier',          public._hlbc2a_v_hex(classifier_digest))
    || public._hlbc2a_field('distance_km_e3',      public._hlbc2a_v_int(round(distance_km * 1000)::bigint))
    || public._hlbc2a_field('base_price_cents',    public._hlbc2a_v_int(base_price_cents))
    || public._hlbc2a_field('amenity_total_cents', public._hlbc2a_v_int(amenity_total_cents))
    || public._hlbc2a_field('total_price_cents',   public._hlbc2a_v_int(total_price_cents))
    || public._hlbc2a_field('currency',            public._hlbc2a_v_text(currency))
    || public._hlbc2a_field('amenity_set',         public._hlbc2a_v_hex(amenity_set_digest))
  )
$$;

-- =====================================================================
-- §G Full fixture inventory — 12 assertions.
-- Any mismatch RAISEs and aborts this migration atomically.
-- =====================================================================
DO $test$
DECLARE
  h_addr_A bytea; h_addr_B bytea; h_addr_Air bytea;
  h_cV1 bytea; h_cV2 bytea; h_cV3 bytea;
  h_asEmpty bytea; h_as1 bytea; h_as2 bytea;
  h_bV1 bytea; h_bV2 bytea; h_bV3 bytea;
  am1 public._hlbc2a_amenity_item;
  am2 public._hlbc2a_amenity_item;
  pax uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
BEGIN
  h_addr_A   := public._hlbc2a_addr_digest('123 Main St, Boston, MA 02116, USA',       'ChIJPTacEpBQwokRKwIlDXelxkA', 423550000, -710650000);
  h_addr_B   := public._hlbc2a_addr_digest('200 Clarendon St, Boston, MA 02116, USA', 'ChIJd8UDgpBQwokRuQlz2ZFhLLo', 423486000, -710756000);
  h_addr_Air := public._hlbc2a_addr_digest('Boston Logan Intl Airport (BOS), East Boston, MA, USA', 'ChIJN0nyneZw44kR8Ie6UeKm7Rw', 423656000, -710096000);

  IF encode(h_addr_A,'hex')   <> 'd945294931038a35f38ee980c19b6f6589284b1d153cd3700be1c7ed4656baa8' THEN RAISE EXCEPTION 'FIXTURE MISMATCH addr.A: %', encode(h_addr_A,'hex'); END IF;
  IF encode(h_addr_B,'hex')   <> '3efa6944f0415f6754eb267a3a9320c5692de1a32e14464df32472429e430a65' THEN RAISE EXCEPTION 'FIXTURE MISMATCH addr.B: %', encode(h_addr_B,'hex'); END IF;
  IF encode(h_addr_Air,'hex') <> 'd916af7b082e1a1197dfb6d4e2059c159f46c46935a24fc02b2a4008c07dd231' THEN RAISE EXCEPTION 'FIXTURE MISMATCH addr.Air: %', encode(h_addr_Air,'hex'); END IF;

  h_cV1 := public._hlbc2a_classifier_digest(h_addr_A, h_addr_B,   false, false);
  h_cV2 := public._hlbc2a_classifier_digest(h_addr_A, h_addr_Air, false, true);
  h_cV3 := public._hlbc2a_classifier_digest(h_addr_A, h_addr_B,   false, false);
  IF encode(h_cV1,'hex') <> 'ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4' THEN RAISE EXCEPTION 'FIXTURE MISMATCH classifier.V1: %', encode(h_cV1,'hex'); END IF;
  IF encode(h_cV2,'hex') <> 'd55cc348c9a74b1780b99fa6ad6594370d9c1a88dd7fb13fc37a7382c237a2b4' THEN RAISE EXCEPTION 'FIXTURE MISMATCH classifier.V2: %', encode(h_cV2,'hex'); END IF;
  IF encode(h_cV3,'hex') <> 'ffd87370fa35611e60279624ea91b8861d3a55c49dabc92d17e210d93fefd1d4' THEN RAISE EXCEPTION 'FIXTURE MISMATCH classifier.V3: %', encode(h_cV3,'hex'); END IF;
  IF h_cV3 IS DISTINCT FROM h_cV1 THEN RAISE EXCEPTION 'FIXTURE MISMATCH classifier.V3 identity vs V1'; END IF;

  am1 := ROW('11111111-1111-4111-8111-111111111111'::uuid, 'still_water',    'Still Water Service',           1, 500::bigint, 'USD', false)::public._hlbc2a_amenity_item;
  am2 := ROW('22222222-2222-4222-8222-222222222222'::uuid, 'exec_newspaper', 'Executive Newspaper Selection', 1,   0::bigint, 'USD', true )::public._hlbc2a_amenity_item;
  h_asEmpty := public._hlbc2a_amenity_set_digest(ARRAY[]::public._hlbc2a_amenity_item[]);
  h_as1     := public._hlbc2a_amenity_set_digest(ARRAY[am1]);
  h_as2     := public._hlbc2a_amenity_set_digest(ARRAY[am1, am2]);
  IF encode(h_asEmpty,'hex') <> 'd4c892e792acf5307abf73a1dc4f3df9a25f093fd8299aaa44af2c44ca0c0150' THEN RAISE EXCEPTION 'FIXTURE MISMATCH amenity_set.empty: %', encode(h_asEmpty,'hex'); END IF;
  IF encode(h_as1,'hex')     <> '0fc3985eeb99cc20b177a06a423db34f6bd43d886575be388ff7c0895601e7a9' THEN RAISE EXCEPTION 'FIXTURE MISMATCH amenity_set.1: %',     encode(h_as1,'hex');     END IF;
  IF encode(h_as2,'hex')     <> 'fc49a75c44e35e0a1bef70381135c4388e7373b5fdec76308f2a0dd69473e70d' THEN RAISE EXCEPTION 'FIXTURE MISMATCH amenity_set.2: %',     encode(h_as2,'hex');     END IF;

  h_bV1 := public._hlbc2a_booking_digest('b0000001-0000-4000-8000-000000000001', pax, 'escalade', 'standard',
    '2026-08-01 14:00:00+00'::timestamptz, h_addr_A, h_addr_B, h_cV1, 12.5, 8500,   0,  8500, 'USD', h_asEmpty);
  IF encode(h_bV1,'hex') <> '41d5baa23ad42c2ad4df082fd089252a86e3525520ab30701772b2ab7667f633' THEN RAISE EXCEPTION 'FIXTURE MISMATCH booking.V1: %', encode(h_bV1,'hex'); END IF;

  h_bV2 := public._hlbc2a_booking_digest('b0000001-0000-4000-8000-000000000002', pax, 'suburban', 'airport',
    '2026-08-02 09:30:00+00'::timestamptz, h_addr_A, h_addr_Air, h_cV2, 14.2, 12000, 500, 12500, 'USD', h_as1);
  IF encode(h_bV2,'hex') <> 'bbf6dfce5e9bb01fb005d4be7d94f1e5319a55fe1f4f1d07336eda11eccb7cf0' THEN RAISE EXCEPTION 'FIXTURE MISMATCH booking.V2: %', encode(h_bV2,'hex'); END IF;

  h_bV3 := public._hlbc2a_booking_digest('b0000001-0000-4000-8000-000000000003', pax, 'denali', 'standard',
    '2026-08-03 18:15:00+00'::timestamptz, h_addr_A, h_addr_B, h_cV3, 12.5,  8500, 500,  9000, 'USD', h_as2);
  IF encode(h_bV3,'hex') <> 'a064f08a3410b1166b0a3423c988dc9a9abc0750359f92a1529073674281db37' THEN RAISE EXCEPTION 'FIXTURE MISMATCH booking.V3: %', encode(h_bV3,'hex'); END IF;

  RAISE NOTICE 'batch2a-m1: all 12 canonical-encoder fixtures verified OK';
END
$test$;
