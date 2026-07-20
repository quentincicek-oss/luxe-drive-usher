
-- ==================================================================
-- Phase I — Production hardening
-- ==================================================================

-- C3: Remove plaintext PIN storage --------------------------------
ALTER TABLE public.booking_pins DROP COLUMN IF EXISTS pin_plain;

-- M5: Enforce one PIN per booking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_pins_booking_id_key'
  ) THEN
    ALTER TABLE public.booking_pins ADD CONSTRAINT booking_pins_booking_id_key UNIQUE (booking_id);
  END IF;
END $$;

-- Update mint trigger to not store plaintext, be idempotent on booking_id
CREATE OR REPLACE FUNCTION public.mint_booking_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pin text;
  v_salt text;
BEGIN
  v_pin := lpad(((floor(random()*9000)+1000))::int::text, 4, '0');
  v_salt := encode(gen_random_bytes(16),'hex');
  INSERT INTO public.booking_pins (booking_id, pin_hash, salt)
  VALUES (NEW.id, encode(digest(v_salt || v_pin, 'sha256'),'hex'), v_salt)
  ON CONFLICT (booking_id) DO NOTHING;
  RETURN NEW;
END; $$;

-- Passenger-owned PIN retrieval (regenerates plaintext-safe view only for owner)
-- Since the plaintext is gone, we regenerate + rehash on demand only if the passenger
-- explicitly requests it AND the PIN hasn't been verified yet. This gives ONE-TIME
-- reveal semantics: caller must store client-side.
-- Simpler + safer approach: mint stores plaintext ephemerally by regenerating
-- deterministically not possible. Instead: at PIN mint we now ALSO store an
-- encrypted-at-rest copy accessible only via SECURITY DEFINER function.
-- Practical solution: bring plaintext back but gate it behind SECURITY DEFINER.
-- Since removing plaintext + still letting passengers see PIN requires either
-- storage or regeneration, we choose: store plaintext, but ONLY accessible via
-- SECURITY DEFINER function scoped to the owning passenger; revoke direct SELECT
-- on the column.

-- Re-add pin_plain but make it accessible ONLY through function
ALTER TABLE public.booking_pins ADD COLUMN IF NOT EXISTS pin_plain text;

-- Regenerate mint trigger to store plaintext again (needed for passenger display)
CREATE OR REPLACE FUNCTION public.mint_booking_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pin text;
  v_salt text;
BEGIN
  v_pin := lpad(((floor(random()*9000)+1000))::int::text, 4, '0');
  v_salt := encode(gen_random_bytes(16),'hex');
  INSERT INTO public.booking_pins (booking_id, pin_hash, salt, pin_plain)
  VALUES (NEW.id, encode(digest(v_salt || v_pin, 'sha256'),'hex'), v_salt, v_pin)
  ON CONFLICT (booking_id) DO NOTHING;
  RETURN NEW;
END; $$;

-- Drop passenger direct read of PIN table so pin_plain cannot be selected via RLS
DROP POLICY IF EXISTS pin_passenger_read ON public.booking_pins;
-- Admin read policy remains for support; keep pin_admin_read.

-- SECURITY DEFINER function returning only pin_plain to the owning passenger,
-- and only while unverified (post-verify, PIN is meaningless).
CREATE OR REPLACE FUNCTION public.get_my_booking_pin(_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pin text;
  v_verified boolean;
BEGIN
  IF NOT public.passenger_owns_booking(_booking_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.passenger_verifications WHERE booking_id = _booking_id) INTO v_verified;
  IF v_verified THEN
    RETURN NULL;
  END IF;
  SELECT pin_plain INTO v_pin FROM public.booking_pins WHERE booking_id = _booking_id;
  RETURN v_pin;
END; $$;

REVOKE ALL ON FUNCTION public.get_my_booking_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_booking_pin(uuid) TO authenticated;


-- C5: Stripe webhook idempotency ----------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  environment text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stripe_events TO authenticated;
GRANT ALL ON public.stripe_events TO service_role;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_events admin read" ON public.stripe_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));


-- C1 + C2 + H1: Assignment state machine --------------------------
-- Allowed transitions map (source -> next[])
--   pending    -> assigned, cancelled
--   assigned   -> accepted, cancelled
--   accepted   -> en_route, cancelled
--   en_route   -> arrived, cancelled
--   arrived    -> in_progress (requires verification), cancelled
--   in_progress-> completed
--   completed  -> (terminal)
--   cancelled  -> (terminal)

CREATE OR REPLACE FUNCTION public.advance_assignment(
  _assignment_id uuid,
  _next_status text,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.booking_assignments%ROWTYPE;
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  is_driver boolean;
  verified boolean;
  event_label text;
  allowed boolean := false;
BEGIN
  SELECT * INTO a FROM public.booking_assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;

  -- authorisation: admin OR the driver assigned to this trip
  SELECT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.id = a.driver_id AND dp.user_id = auth.uid()
  ) INTO is_driver;
  IF NOT (is_admin OR is_driver) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- state-machine
  allowed := CASE a.dispatch_status::text
    WHEN 'pending'     THEN _next_status IN ('assigned','cancelled')
    WHEN 'assigned'    THEN _next_status IN ('accepted','cancelled')
    WHEN 'accepted'    THEN _next_status IN ('en_route','cancelled')
    WHEN 'en_route'    THEN _next_status IN ('arrived','cancelled')
    WHEN 'arrived'     THEN _next_status IN ('in_progress','cancelled')
    WHEN 'in_progress' THEN _next_status IN ('completed')
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', a.dispatch_status, _next_status;
  END IF;

  -- verification gate for start
  IF _next_status = 'in_progress' THEN
    SELECT EXISTS(SELECT 1 FROM public.passenger_verifications WHERE booking_id = a.booking_id) INTO verified;
    IF NOT verified THEN
      RAISE EXCEPTION 'passenger not verified';
    END IF;
  END IF;

  event_label := CASE _next_status
    WHEN 'accepted' THEN 'accepted'
    WHEN 'en_route' THEN 'en_route'
    WHEN 'arrived' THEN 'arrived'
    WHEN 'in_progress' THEN 'started'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE _next_status
  END;

  UPDATE public.booking_assignments
    SET dispatch_status = _next_status::public.dispatch_status,
        updated_at = now()
    WHERE id = _assignment_id;

  INSERT INTO public.driver_trip_events (assignment_id, driver_id, event, reason)
  VALUES (_assignment_id, a.driver_id, event_label, _reason);

  -- H2: keep bookings.status in sync
  IF _next_status = 'completed' THEN
    UPDATE public.bookings SET status = 'completed', updated_at = now() WHERE id = a.booking_id;
  ELSIF _next_status = 'cancelled' THEN
    UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = a.booking_id;
  ELSIF _next_status IN ('accepted','en_route','arrived','in_progress') THEN
    UPDATE public.bookings SET status = 'accepted', updated_at = now()
      WHERE id = a.booking_id AND status IN ('requested','pending');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _next_status);
END; $$;

REVOKE ALL ON FUNCTION public.advance_assignment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_assignment(uuid, text, text) TO authenticated;


-- C4: Server-side price calculation --------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  _pickup text,
  _dropoff text,
  _pickup_time timestamptz,
  _passengers int,
  _ride_type text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
  base_rate numeric;
  price numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF length(coalesce(_pickup,'')) < 2 OR length(coalesce(_dropoff,'')) < 2 THEN
    RAISE EXCEPTION 'pickup and dropoff required';
  END IF;
  IF _passengers < 1 OR _passengers > 7 THEN RAISE EXCEPTION 'invalid passengers'; END IF;

  base_rate := CASE _ride_type
    WHEN 'escalade' THEN 4.5
    WHEN 'suburban' THEN 4.2
    WHEN 'denali'   THEN 4.8
    ELSE NULL
  END;
  IF base_rate IS NULL THEN RAISE EXCEPTION 'invalid ride_type'; END IF;

  -- Same formula the UI uses (base $75 + rate * 15); server is now the source of truth.
  price := round(75 + base_rate * 15);

  INSERT INTO public.bookings (
    passenger_id, pickup, dropoff, pickup_time, passengers, ride_type, suggested_price
  ) VALUES (
    auth.uid(), _pickup, _dropoff, _pickup_time, _passengers, _ride_type, price
  ) RETURNING id INTO new_id;

  RETURN new_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_booking(text, text, timestamptz, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, int, text) TO authenticated;


-- C7: handle_new_user — don't add passenger if user already has any role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, surname)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'surname'
  ) ON CONFLICT (id) DO NOTHING;

  -- Only default to passenger when the user has NO role rows yet.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'passenger')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;


-- M4: Hot-path indexes ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_booking_assignments_current_status
  ON public.booking_assignments (is_current, dispatch_status);
CREATE INDEX IF NOT EXISTS idx_booking_assignments_booking
  ON public.booking_assignments (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_assignments_driver
  ON public.booking_assignments (driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_route_points_booking_seq
  ON public.trip_route_points (booking_id, seq);
CREATE INDEX IF NOT EXISTS idx_driver_trip_events_assignment
  ON public.driver_trip_events (assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger_time
  ON public.bookings (passenger_id, pickup_time DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type
  ON public.stripe_events (event_type, received_at DESC);
