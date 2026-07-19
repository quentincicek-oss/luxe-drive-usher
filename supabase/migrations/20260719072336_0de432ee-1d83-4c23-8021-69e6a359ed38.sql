
CREATE TYPE public.employment_status AS ENUM ('active','inactive','vacation');
CREATE TYPE public.driver_availability AS ENUM ('available','assigned','on_trip','offline','vacation');
CREATE TYPE public.vehicle_status AS ENUM ('active','maintenance');
CREATE TYPE public.vehicle_category AS ENUM ('escalade','suburban','denali','other');
CREATE TYPE public.dispatch_status AS ENUM ('pending','assigned','accepted','en_route','arrived','in_progress','completed','cancelled');
CREATE TYPE public.unavailability_reason AS ENUM ('vacation','maintenance','personal');

-- VEHICLES (base policies only; driver read-own policy added after driver_profiles exists)
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category public.vehicle_category NOT NULL DEFAULT 'other',
  license_plate TEXT NOT NULL,
  vin TEXT,
  model_year INT,
  seats INT NOT NULL DEFAULT 6,
  status public.vehicle_status NOT NULL DEFAULT 'active',
  insurance_expires_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles admin all" ON public.vehicles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- DRIVER PROFILES
CREATE TABLE public.driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  license_number TEXT,
  license_expires_at DATE,
  employment_status public.employment_status NOT NULL DEFAULT 'active',
  availability_status public.driver_availability NOT NULL DEFAULT 'offline',
  assigned_vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_profiles_availability_idx ON public.driver_profiles(availability_status);
CREATE INDEX driver_profiles_employment_idx ON public.driver_profiles(employment_status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_profiles admin all" ON public.driver_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "driver_profiles read own" ON public.driver_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER driver_profiles_updated_at BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Vehicles: driver read-own (after driver_profiles exists)
CREATE POLICY "vehicles driver read own" ON public.vehicles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.assigned_vehicle_id = vehicles.id AND dp.user_id = auth.uid()));

-- DRIVER UNAVAILABILITY
CREATE TABLE public.driver_unavailability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason public.unavailability_reason NOT NULL DEFAULT 'personal',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_unavailability_driver_idx ON public.driver_unavailability(driver_id, starts_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_unavailability TO authenticated;
GRANT ALL ON public.driver_unavailability TO service_role;
ALTER TABLE public.driver_unavailability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_unavailability admin all" ON public.driver_unavailability FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "driver_unavailability read own" ON public.driver_unavailability FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.id = driver_unavailability.driver_id AND dp.user_id = auth.uid()));

-- BOOKING ASSIGNMENTS
CREATE TABLE public.booking_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.driver_profiles(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  dispatch_status public.dispatch_status NOT NULL DEFAULT 'pending',
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_assignments_booking_idx ON public.booking_assignments(booking_id, is_current);
CREATE INDEX booking_assignments_driver_idx ON public.booking_assignments(driver_id, is_current);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_assignments TO authenticated;
GRANT ALL ON public.booking_assignments TO service_role;
ALTER TABLE public.booking_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking_assignments admin all" ON public.booking_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "booking_assignments driver read own" ON public.booking_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.id = booking_assignments.driver_id AND dp.user_id = auth.uid()));
CREATE POLICY "booking_assignments passenger read own" ON public.booking_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_assignments.booking_id AND b.passenger_id = auth.uid()));

-- TRIGGER: current-flag + availability sync
CREATE OR REPLACE FUNCTION public.handle_booking_assignment_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.booking_assignments SET is_current = false
      WHERE booking_id = NEW.booking_id AND id <> NEW.id AND is_current = true;
  END IF;
  IF NEW.driver_id IS NOT NULL THEN
    UPDATE public.driver_profiles
      SET availability_status = CASE NEW.dispatch_status
        WHEN 'assigned' THEN 'assigned'::public.driver_availability
        WHEN 'accepted' THEN 'assigned'::public.driver_availability
        WHEN 'en_route' THEN 'on_trip'::public.driver_availability
        WHEN 'arrived' THEN 'on_trip'::public.driver_availability
        WHEN 'in_progress' THEN 'on_trip'::public.driver_availability
        WHEN 'completed' THEN 'available'::public.driver_availability
        WHEN 'cancelled' THEN 'available'::public.driver_availability
        ELSE availability_status
      END
      WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER booking_assignments_after_change
  AFTER INSERT OR UPDATE ON public.booking_assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_booking_assignment_change();

-- KPI FUNCTION
CREATE OR REPLACE FUNCTION public.admin_dispatch_kpis()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'todays_bookings',        (SELECT count(*) FROM bookings WHERE pickup_time::date = current_date),
    'upcoming_bookings',      (SELECT count(*) FROM bookings WHERE pickup_time > now() AND status NOT IN ('completed','cancelled')),
    'completed_trips_7d',     (SELECT count(*) FROM bookings WHERE status = 'completed' AND updated_at > now() - interval '7 days'),
    'drivers_available',      (SELECT count(*) FROM driver_profiles WHERE availability_status = 'available' AND employment_status = 'active'),
    'drivers_busy',           (SELECT count(*) FROM driver_profiles WHERE availability_status IN ('assigned','on_trip')),
    'drivers_offline',        (SELECT count(*) FROM driver_profiles WHERE availability_status = 'offline'),
    'upcoming_airport_pickups', (
      SELECT count(*) FROM bookings
      WHERE pickup_time > now() AND status NOT IN ('completed','cancelled')
        AND (pickup ILIKE '%airport%' OR pickup ILIKE '%JFK%' OR pickup ILIKE '%LGA%' OR pickup ILIKE '%EWR%')
    )
  ) INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.admin_dispatch_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_kpis() TO authenticated;
