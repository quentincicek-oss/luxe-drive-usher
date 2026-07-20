-- Phase G: audit log + admin RPCs

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  previous JSONB,
  next JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON public.audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON public.audit_log(action, created_at DESC);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit records; no INSERT/UPDATE/DELETE policies (immutable via RPC).
CREATE POLICY "Admins can view audit log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Audit writer (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.admin_audit_log(
  _action TEXT,
  _entity_type TEXT,
  _entity_id UUID,
  _previous JSONB,
  _next JSONB,
  _reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
  actor_email_val TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT email INTO actor_email_val FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log (actor_id, actor_email, action, entity_type, entity_id, previous, next, reason)
  VALUES (auth.uid(), actor_email_val, _action, _entity_type, _entity_id, _previous, _next, _reason)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_audit_log(TEXT,TEXT,UUID,JSONB,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_audit_log(TEXT,TEXT,UUID,JSONB,JSONB,TEXT) TO authenticated;

-- Rich dispatch overview
CREATE OR REPLACE FUNCTION public.admin_dispatch_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'new_bookings',        (SELECT count(*) FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM booking_assignments a WHERE a.booking_id=b.id AND a.is_current) AND b.status NOT IN ('completed','cancelled')),
    'pending_dispatch',    (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status IN ('pending','assigned')),
    'assigned_trips',      (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status = 'accepted'),
    'en_route',            (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status = 'en_route'),
    'waiting',             (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status = 'arrived'),
    'in_progress',         (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status = 'in_progress'),
    'completed_today',     (SELECT count(*) FROM booking_assignments WHERE is_current AND dispatch_status = 'completed' AND updated_at::date = current_date),
    'cancelled_today',     (SELECT count(*) FROM bookings WHERE status = 'cancelled' AND updated_at::date = current_date),
    'drivers', jsonb_build_object(
      'available',   (SELECT count(*) FROM driver_profiles WHERE availability_status='available' AND employment_status='active'),
      'assigned',    (SELECT count(*) FROM driver_profiles WHERE availability_status='assigned'),
      'on_trip',     (SELECT count(*) FROM driver_profiles WHERE availability_status='on_trip'),
      'offline',    (SELECT count(*) FROM driver_profiles WHERE availability_status='offline'),
      'vacation',    (SELECT count(*) FROM driver_profiles WHERE availability_status='vacation')
    )
  ) INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_overview() TO authenticated;

-- Fleet expirations
CREATE OR REPLACE FUNCTION public.admin_fleet_expirations()
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY (t.min_expiry) NULLS LAST), '[]'::jsonb) INTO result
  FROM (
    SELECT v.*,
      LEAST(v.insurance_expires_at, v.registration_expires_at, v.inspection_expires_at) AS min_expiry
    FROM vehicles v
  ) t;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_fleet_expirations() TO authenticated;

-- Incident feed (union of no-show/incident events, cancellations, low ratings)
CREATE OR REPLACE FUNCTION public.admin_incident_feed(_limit INT DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO result FROM (
    SELECT 'trip_event'::text AS kind, e.id, e.event AS label, e.reason, e.assignment_id AS ref_id, e.created_at
      FROM driver_trip_events e WHERE e.event IN ('no_show','incident')
    UNION ALL
    SELECT 'cancellation'::text, b.id, 'cancelled'::text, NULL::text, b.id, b.updated_at
      FROM bookings b WHERE b.status = 'cancelled'
    UNION ALL
    SELECT 'low_rating'::text, r.id, ('rating_' || r.rating)::text, r.comment, r.booking_id, r.created_at
      FROM ride_reviews r WHERE r.rating <= 3
    ORDER BY 6 DESC
    LIMIT _limit
  ) x;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_incident_feed(INT) TO authenticated;
