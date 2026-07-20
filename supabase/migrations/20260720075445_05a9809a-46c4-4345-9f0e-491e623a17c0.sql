
-- ============ ENUMS ============
CREATE TYPE public.verification_method AS ENUM ('pin','qr','nfc');
CREATE TYPE public.trip_location_kind AS ENUM ('arrival','trip_start','trip_end');
CREATE TYPE public.no_show_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.comm_direction AS ENUM ('driver_to_passenger','passenger_to_driver');
CREATE TYPE public.comm_channel AS ENUM ('phone','inapp');
CREATE TYPE public.comm_status AS ENUM ('initiated','connected','missed','failed');
CREATE TYPE public.incident_category AS ENUM ('vehicle','passenger','traffic','road_closure','lost_property','emergency','other');
CREATE TYPE public.incident_severity AS ENUM ('low','medium','high','critical');
CREATE TYPE public.incident_status AS ENUM ('open','reviewing','resolved','dismissed');

-- ============ HELPER ============
CREATE OR REPLACE FUNCTION public.driver_owns_booking(_booking_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM booking_assignments a
    JOIN driver_profiles dp ON dp.id = a.driver_id
    WHERE a.booking_id = _booking_id
      AND a.is_current
      AND dp.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.passenger_owns_booking(_booking_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM bookings WHERE id=_booking_id AND passenger_id = auth.uid());
$$;

-- ============ verification_settings ============
CREATE TABLE public.verification_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pin_enabled boolean NOT NULL DEFAULT true,
  qr_enabled boolean NOT NULL DEFAULT false,
  nfc_enabled boolean NOT NULL DEFAULT false,
  min_waiting_seconds integer NOT NULL DEFAULT 300,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.verification_settings TO authenticated;
GRANT ALL ON public.verification_settings TO service_role;
ALTER TABLE public.verification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vs_read_all_auth" ON public.verification_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "vs_admin_update" ON public.verification_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.verification_settings (id) VALUES (1);

-- ============ booking_pins ============
CREATE TABLE public.booking_pins (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  salt text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  pin_plain text NOT NULL -- shown to passenger only; RLS restricts to passenger owner
);
GRANT SELECT ON public.booking_pins TO authenticated;
GRANT ALL ON public.booking_pins TO service_role;
ALTER TABLE public.booking_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pin_passenger_read" ON public.booking_pins FOR SELECT TO authenticated USING (public.passenger_owns_booking(booking_id));
CREATE POLICY "pin_admin_read" ON public.booking_pins FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
-- Drivers never SELECT the PIN; they submit a candidate via server fn (SECURITY DEFINER).

-- Trigger: mint pin on booking creation
CREATE OR REPLACE FUNCTION public.mint_booking_pin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pin text;
  v_salt text;
BEGIN
  v_pin := lpad(((floor(random()*9000)+1000))::int::text, 4, '0');
  v_salt := encode(gen_random_bytes(16),'hex');
  INSERT INTO public.booking_pins (booking_id, pin_hash, salt, pin_plain)
  VALUES (NEW.id, encode(digest(v_salt || v_pin, 'sha256'),'hex'), v_salt, v_pin);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_mint_booking_pin AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.mint_booking_pin();

-- ============ passenger_verifications ============
CREATE TABLE public.passenger_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  method public.verification_method NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by_driver_id uuid REFERENCES public.driver_profiles(id),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON public.passenger_verifications (booking_id);
GRANT SELECT, INSERT ON public.passenger_verifications TO authenticated;
GRANT ALL ON public.passenger_verifications TO service_role;
ALTER TABLE public.passenger_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pv_read_driver" ON public.passenger_verifications FOR SELECT TO authenticated USING (public.driver_owns_booking(booking_id));
CREATE POLICY "pv_read_passenger" ON public.passenger_verifications FOR SELECT TO authenticated USING (public.passenger_owns_booking(booking_id));
CREATE POLICY "pv_read_admin" ON public.passenger_verifications FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "pv_insert_driver" ON public.passenger_verifications FOR INSERT TO authenticated WITH CHECK (public.driver_owns_booking(booking_id));

-- ============ trip_locations ============
CREATE TABLE public.trip_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.driver_profiles(id),
  kind public.trip_location_kind NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m real,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.trip_locations (booking_id);
GRANT SELECT, INSERT ON public.trip_locations TO authenticated;
GRANT ALL ON public.trip_locations TO service_role;
ALTER TABLE public.trip_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tl_read_driver" ON public.trip_locations FOR SELECT TO authenticated USING (public.driver_owns_booking(booking_id));
CREATE POLICY "tl_read_admin" ON public.trip_locations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tl_insert_driver" ON public.trip_locations FOR INSERT TO authenticated WITH CHECK (public.driver_owns_booking(booking_id));

-- ============ trip_route_points ============
CREATE TABLE public.trip_route_points (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  driver_id uuid NOT NULL REFERENCES public.driver_profiles(id),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed_mps real,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, seq)
);
GRANT SELECT, INSERT ON public.trip_route_points TO authenticated;
GRANT ALL ON public.trip_route_points TO service_role;
ALTER TABLE public.trip_route_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trp_read_driver" ON public.trip_route_points FOR SELECT TO authenticated USING (public.driver_owns_booking(booking_id));
CREATE POLICY "trp_read_admin" ON public.trip_route_points FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "trp_insert_driver" ON public.trip_route_points FOR INSERT TO authenticated WITH CHECK (public.driver_owns_booking(booking_id));

-- ============ no_show_reports ============
CREATE TABLE public.no_show_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.driver_profiles(id),
  arrival_at timestamptz NOT NULL,
  waited_seconds integer NOT NULL,
  attempts_count integer NOT NULL DEFAULT 0,
  arrival_lat double precision,
  arrival_lng double precision,
  reason text,
  admin_status public.no_show_status NOT NULL DEFAULT 'pending',
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.no_show_reports (booking_id);
GRANT SELECT, INSERT ON public.no_show_reports TO authenticated;
GRANT ALL ON public.no_show_reports TO service_role;
ALTER TABLE public.no_show_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nsr_read_driver" ON public.no_show_reports FOR SELECT TO authenticated USING (public.driver_owns_booking(booking_id));
CREATE POLICY "nsr_read_admin" ON public.no_show_reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "nsr_insert_driver" ON public.no_show_reports FOR INSERT TO authenticated WITH CHECK (public.driver_owns_booking(booking_id));
CREATE POLICY "nsr_admin_update" ON public.no_show_reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ communication_events ============
CREATE TABLE public.communication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.driver_profiles(id),
  direction public.comm_direction NOT NULL,
  channel public.comm_channel NOT NULL DEFAULT 'phone',
  duration_sec integer NOT NULL DEFAULT 0,
  status public.comm_status NOT NULL DEFAULT 'initiated',
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.communication_events (booking_id);
GRANT SELECT, INSERT ON public.communication_events TO authenticated;
GRANT ALL ON public.communication_events TO service_role;
ALTER TABLE public.communication_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ce_read_driver" ON public.communication_events FOR SELECT TO authenticated USING (public.driver_owns_booking(booking_id));
CREATE POLICY "ce_read_passenger" ON public.communication_events FOR SELECT TO authenticated USING (public.passenger_owns_booking(booking_id));
CREATE POLICY "ce_read_admin" ON public.communication_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ce_insert_driver" ON public.communication_events FOR INSERT TO authenticated WITH CHECK (public.driver_owns_booking(booking_id));
CREATE POLICY "ce_insert_passenger" ON public.communication_events FOR INSERT TO authenticated WITH CHECK (public.passenger_owns_booking(booking_id));

-- ============ incidents ============
CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.driver_profiles(id),
  category public.incident_category NOT NULL,
  severity public.incident_severity NOT NULL DEFAULT 'medium',
  description text NOT NULL,
  photo_urls text[] NOT NULL DEFAULT '{}',
  status public.incident_status NOT NULL DEFAULT 'open',
  admin_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.incidents (booking_id);
CREATE INDEX ON public.incidents (status);
GRANT SELECT, INSERT ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inc_read_driver" ON public.incidents FOR SELECT TO authenticated USING (
  driver_id IN (SELECT id FROM driver_profiles WHERE user_id = auth.uid())
);
CREATE POLICY "inc_read_admin" ON public.incidents FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "inc_insert_driver" ON public.incidents FOR INSERT TO authenticated WITH CHECK (
  driver_id IN (SELECT id FROM driver_profiles WHERE user_id = auth.uid())
);
CREATE POLICY "inc_admin_update" ON public.incidents FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ Server-side helper: verify PIN atomically ============
CREATE OR REPLACE FUNCTION public.verify_booking_pin(_booking_id uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  rec public.booking_pins%ROWTYPE;
  candidate_hash text;
  drv_id uuid;
BEGIN
  IF NOT public.driver_owns_booking(_booking_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO rec FROM public.booking_pins WHERE booking_id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','no_pin'); END IF;
  IF rec.locked_until IS NOT NULL AND rec.locked_until > now() THEN
    RETURN jsonb_build_object('ok',false,'reason','locked','until',rec.locked_until);
  END IF;
  candidate_hash := encode(digest(rec.salt || _pin, 'sha256'),'hex');
  IF candidate_hash = rec.pin_hash THEN
    SELECT id INTO drv_id FROM driver_profiles WHERE user_id = auth.uid();
    INSERT INTO passenger_verifications (booking_id, method, verified_by_driver_id, evidence)
      VALUES (_booking_id, 'pin', drv_id, jsonb_build_object('attempts', rec.attempts + 1));
    INSERT INTO driver_trip_events (assignment_id, driver_id, event, reason)
      SELECT a.id, a.driver_id, 'verified', 'pin'
      FROM booking_assignments a WHERE a.booking_id=_booking_id AND a.is_current;
    RETURN jsonb_build_object('ok',true);
  ELSE
    UPDATE public.booking_pins
      SET attempts = attempts + 1,
          locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE booking_id = _booking_id;
    RETURN jsonb_build_object('ok',false,'reason','mismatch','attempts',rec.attempts+1);
  END IF;
END; $$;

-- ============ Evidence view ============
CREATE OR REPLACE VIEW public.trip_evidence_v AS
SELECT
  b.id AS booking_id,
  b.passenger_id,
  b.pickup, b.dropoff, b.pickup_time, b.status AS booking_status,
  a.driver_id,
  a.vehicle_id,
  a.dispatch_status,
  (SELECT jsonb_agg(row_to_json(e) ORDER BY e.created_at) FROM driver_trip_events e WHERE e.assignment_id=a.id) AS events,
  (SELECT jsonb_agg(row_to_json(v)) FROM passenger_verifications v WHERE v.booking_id=b.id) AS verifications,
  (SELECT jsonb_agg(row_to_json(l) ORDER BY l.recorded_at) FROM trip_locations l WHERE l.booking_id=b.id) AS key_locations,
  (SELECT count(*) FROM trip_route_points p WHERE p.booking_id=b.id) AS route_point_count,
  (SELECT row_to_json(n) FROM no_show_reports n WHERE n.booking_id=b.id ORDER BY n.created_at DESC LIMIT 1) AS no_show,
  (SELECT jsonb_agg(row_to_json(i) ORDER BY i.created_at) FROM incidents i WHERE i.booking_id=b.id) AS incidents,
  (SELECT jsonb_agg(row_to_json(c) ORDER BY c.started_at) FROM communication_events c WHERE c.booking_id=b.id) AS communications
FROM bookings b
LEFT JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current;
GRANT SELECT ON public.trip_evidence_v TO authenticated;

-- ============ Admin: fleet compliance summary ============
CREATE OR REPLACE FUNCTION public.admin_fleet_compliance_alerts(_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb) INTO result FROM (
    SELECT id, name, license_plate,
      insurance_expires_at, registration_expires_at, inspection_expires_at,
      LEAST(insurance_expires_at, registration_expires_at, inspection_expires_at) AS min_expiry
    FROM vehicles
    WHERE LEAST(insurance_expires_at, registration_expires_at, inspection_expires_at) IS NOT NULL
      AND LEAST(insurance_expires_at, registration_expires_at, inspection_expires_at) <= now() + (_days || ' days')::interval
    ORDER BY min_expiry ASC
  ) t;
  RETURN result;
END; $$;
