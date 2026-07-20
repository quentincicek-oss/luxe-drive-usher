
-- 1. Add structured address columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng double precision,
  ADD COLUMN IF NOT EXISTS pickup_place_id text,
  ADD COLUMN IF NOT EXISTS pickup_components jsonb,
  ADD COLUMN IF NOT EXISTS dropoff_lat double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lng double precision,
  ADD COLUMN IF NOT EXISTS dropoff_place_id text,
  ADD COLUMN IF NOT EXISTS dropoff_components jsonb;

-- 2. Replace create_booking to accept optional structured fields.
--    Signature is additive — existing 5-arg callers keep working via defaults.
CREATE OR REPLACE FUNCTION public.create_booking(
  _pickup text,
  _dropoff text,
  _pickup_time timestamp with time zone,
  _passengers integer,
  _ride_type text,
  _pickup_lat double precision DEFAULT NULL,
  _pickup_lng double precision DEFAULT NULL,
  _pickup_place_id text DEFAULT NULL,
  _pickup_components jsonb DEFAULT NULL,
  _dropoff_lat double precision DEFAULT NULL,
  _dropoff_lng double precision DEFAULT NULL,
  _dropoff_place_id text DEFAULT NULL,
  _dropoff_components jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Bounds-check coordinates when provided (silently discard nonsense pairs).
  IF _pickup_lat IS NOT NULL AND (_pickup_lat < -90 OR _pickup_lat > 90) THEN _pickup_lat := NULL; END IF;
  IF _pickup_lng IS NOT NULL AND (_pickup_lng < -180 OR _pickup_lng > 180) THEN _pickup_lng := NULL; END IF;
  IF _dropoff_lat IS NOT NULL AND (_dropoff_lat < -90 OR _dropoff_lat > 90) THEN _dropoff_lat := NULL; END IF;
  IF _dropoff_lng IS NOT NULL AND (_dropoff_lng < -180 OR _dropoff_lng > 180) THEN _dropoff_lng := NULL; END IF;

  price := round(75 + base_rate * 15);

  INSERT INTO public.bookings (
    passenger_id, pickup, dropoff, pickup_time, passengers, ride_type, suggested_price,
    pickup_lat, pickup_lng, pickup_place_id, pickup_components,
    dropoff_lat, dropoff_lng, dropoff_place_id, dropoff_components
  ) VALUES (
    auth.uid(), _pickup, _dropoff, _pickup_time, _passengers, _ride_type, price,
    _pickup_lat, _pickup_lng, _pickup_place_id, _pickup_components,
    _dropoff_lat, _dropoff_lng, _dropoff_place_id, _dropoff_components
  ) RETURNING id INTO new_id;

  RETURN new_id;
END; $function$;
