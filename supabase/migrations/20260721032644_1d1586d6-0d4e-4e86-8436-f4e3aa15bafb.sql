
-- ============ MONITORING EVENTS ============
CREATE TABLE public.monitoring_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('debug','info','warning','error','fatal')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX monitoring_events_created_at_idx ON public.monitoring_events (created_at DESC);
CREATE INDEX monitoring_events_severity_idx ON public.monitoring_events (severity, created_at DESC);
GRANT SELECT, INSERT ON public.monitoring_events TO authenticated;
GRANT ALL ON public.monitoring_events TO service_role;
ALTER TABLE public.monitoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read monitoring events" ON public.monitoring_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own monitoring events" ON public.monitoring_events
  FOR INSERT TO authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ============ INTEGRATION HEALTH ============
CREATE TABLE public.integration_health (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  integration TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy','degraded','down','unknown')),
  latency_ms INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX integration_health_integration_idx ON public.integration_health (integration, checked_at DESC);
GRANT SELECT ON public.integration_health TO authenticated;
GRANT ALL ON public.integration_health TO service_role;
ALTER TABLE public.integration_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read integration health" ON public.integration_health
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ RESTORE DRILLS ============
CREATE TABLE public.restore_drills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  dataset TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('passed','failed','partial')),
  notes TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX restore_drills_performed_at_idx ON public.restore_drills (performed_at DESC);
GRANT SELECT ON public.restore_drills TO authenticated;
GRANT ALL ON public.restore_drills TO service_role;
ALTER TABLE public.restore_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read restore drills" ON public.restore_drills
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ ANALYTICS EVENTS ============
CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_created_at_idx ON public.analytics_events (created_at DESC);
CREATE INDEX analytics_events_name_idx ON public.analytics_events (name, created_at DESC);
GRANT SELECT, INSERT ON public.analytics_events TO authenticated;
GRANT INSERT ON public.analytics_events TO anon;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read analytics events" ON public.analytics_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own analytics events" ON public.analytics_events
  FOR INSERT TO authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "Anon insert analytics events" ON public.analytics_events
  FOR INSERT TO anon WITH CHECK (user_id IS NULL);

-- ============ CAPTURE RPC (rate-limited) ============
CREATE OR REPLACE FUNCTION public.monitoring_capture(
  _severity TEXT,
  _source TEXT,
  _message TEXT,
  _context JSONB DEFAULT '{}'::jsonb,
  _request_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _id UUID;
  _bucket TEXT;
  _allowed BOOLEAN;
BEGIN
  IF _severity NOT IN ('debug','info','warning','error','fatal') THEN
    RAISE EXCEPTION 'invalid severity';
  END IF;
  IF _source IS NULL OR length(_source) = 0 OR length(_source) > 128 THEN
    RAISE EXCEPTION 'invalid source';
  END IF;
  IF _message IS NULL OR length(_message) = 0 THEN
    RAISE EXCEPTION 'invalid message';
  END IF;

  _bucket := COALESCE(_uid::text, 'anon');
  SELECT allowed INTO _allowed FROM public.check_and_bump_rate_limit(
    'monitoring_capture', _bucket, 60, 60
  );
  IF NOT COALESCE(_allowed, false) THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO public.monitoring_events (severity, source, message, context, user_id, request_id)
  VALUES (
    _severity,
    left(_source, 128),
    left(_message, 4000),
    COALESCE(_context, '{}'::jsonb),
    _uid,
    left(_request_id, 128)
  )
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.monitoring_capture(TEXT,TEXT,TEXT,JSONB,TEXT) TO authenticated, anon;

-- ============ ADMIN READ RPCs ============
CREATE OR REPLACE FUNCTION public.admin_recent_monitoring_events(_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID, severity TEXT, source TEXT, message TEXT,
  context JSONB, user_id UUID, request_id TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT e.id, e.severity, e.source, e.message, e.context, e.user_id, e.request_id, e.created_at
    FROM public.monitoring_events e
    ORDER BY e.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_recent_monitoring_events(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_integration_health()
RETURNS TABLE (
  integration TEXT, status TEXT, latency_ms INTEGER, details JSONB, checked_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT DISTINCT ON (h.integration)
      h.integration, h.status, h.latency_ms, h.details, h.checked_at
    FROM public.integration_health h
    ORDER BY h.integration, h.checked_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_list_integration_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_integration_health(
  _integration TEXT, _status TEXT, _latency_ms INT DEFAULT NULL, _details JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('healthy','degraded','down','unknown') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF _integration IS NULL OR length(_integration) = 0 OR length(_integration) > 64 THEN RAISE EXCEPTION 'invalid integration'; END IF;
  INSERT INTO public.integration_health (integration, status, latency_ms, details)
  VALUES (_integration, _status, _latency_ms, COALESCE(_details, '{}'::jsonb))
  RETURNING id INTO _id;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata)
  VALUES (auth.uid(), 'integration_health.record', 'integration_health', _id, jsonb_build_object('integration', _integration, 'status', _status));
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_record_integration_health(TEXT,TEXT,INT,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_restore_drills(_limit INT DEFAULT 50)
RETURNS TABLE (
  id UUID, performed_by UUID, method TEXT, dataset TEXT, result TEXT, notes TEXT, performed_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT d.id, d.performed_by, d.method, d.dataset, d.result, d.notes, d.performed_at
    FROM public.restore_drills d
    ORDER BY d.performed_at DESC
    LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_list_restore_drills(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_restore_drill(
  _method TEXT, _dataset TEXT, _result TEXT, _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _result NOT IN ('passed','failed','partial') THEN RAISE EXCEPTION 'invalid result'; END IF;
  IF _method IS NULL OR length(_method) = 0 OR length(_method) > 64 THEN RAISE EXCEPTION 'invalid method'; END IF;
  IF _dataset IS NULL OR length(_dataset) = 0 OR length(_dataset) > 128 THEN RAISE EXCEPTION 'invalid dataset'; END IF;
  INSERT INTO public.restore_drills (performed_by, method, dataset, result, notes)
  VALUES (auth.uid(), _method, _dataset, _result, left(_notes, 4000))
  RETURNING id INTO _id;
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, metadata)
  VALUES (auth.uid(), 'restore_drill.record', 'restore_drills', _id,
    jsonb_build_object('method', _method, 'dataset', _dataset, 'result', _result));
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_record_restore_drill(TEXT,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_system_health_snapshot()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _now TIMESTAMPTZ := now();
  _one_hour TIMESTAMPTZ := now() - interval '1 hour';
  _one_day TIMESTAMPTZ := now() - interval '24 hours';
  _last_drill TIMESTAMPTZ;
  _events_1h INT;
  _errors_1h INT;
  _fatal_1h INT;
  _bookings_24h INT;
  _failed_stripe_24h INT;
  _integrations JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO _events_1h FROM public.monitoring_events WHERE created_at >= _one_hour;
  SELECT count(*) INTO _errors_1h FROM public.monitoring_events WHERE created_at >= _one_hour AND severity = 'error';
  SELECT count(*) INTO _fatal_1h FROM public.monitoring_events WHERE created_at >= _one_hour AND severity = 'fatal';
  SELECT count(*) INTO _bookings_24h FROM public.bookings WHERE created_at >= _one_day;
  SELECT count(*) INTO _failed_stripe_24h FROM public.monitoring_events
    WHERE created_at >= _one_day AND source = 'stripe' AND severity IN ('error','fatal');
  SELECT performed_at INTO _last_drill FROM public.restore_drills ORDER BY performed_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(h)), '[]'::jsonb) INTO _integrations
  FROM (
    SELECT DISTINCT ON (integration) integration, status, latency_ms, checked_at
    FROM public.integration_health
    ORDER BY integration, checked_at DESC
  ) h;

  RETURN jsonb_build_object(
    'as_of', _now,
    'events_1h', _events_1h,
    'errors_1h', _errors_1h,
    'fatal_1h', _fatal_1h,
    'bookings_24h', _bookings_24h,
    'stripe_errors_24h', _failed_stripe_24h,
    'last_restore_drill', _last_drill,
    'integrations', _integrations
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_system_health_snapshot() TO authenticated;
