
CREATE TABLE IF NOT EXISTS public.email_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      text NOT NULL,
  template      text NOT NULL,
  subject       text,
  locale        text NOT NULL DEFAULT 'en',
  status        text NOT NULL DEFAULT 'queued',
  provider      text,
  provider_id   text,
  error         text,
  booking_id    uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
REVOKE ALL ON public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.email_deliveries TO authenticated;
GRANT  ALL    ON public.email_deliveries TO service_role;
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_deliveries: admins read"
  ON public.email_deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "email_deliveries: service role writes"
  ON public.email_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS email_deliveries_created_idx ON public.email_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS email_deliveries_booking_idx ON public.email_deliveries (booking_id);

CREATE TABLE IF NOT EXISTS public.sms_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone      text NOT NULL,
  template      text NOT NULL,
  locale        text NOT NULL DEFAULT 'en',
  status        text NOT NULL DEFAULT 'queued',
  provider      text,
  provider_id   text,
  error         text,
  booking_id    uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
REVOKE ALL ON public.sms_deliveries FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.sms_deliveries TO authenticated;
GRANT  ALL    ON public.sms_deliveries TO service_role;
ALTER TABLE public.sms_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms_deliveries: admins read"
  ON public.sms_deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sms_deliveries: service role writes"
  ON public.sms_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS sms_deliveries_created_idx ON public.sms_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_deliveries_booking_idx ON public.sms_deliveries (booking_id);

CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  phone       text PRIMARY KEY,
  reason      text NOT NULL DEFAULT 'user_request',
  created_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.sms_opt_outs FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.sms_opt_outs TO authenticated;
GRANT  ALL    ON public.sms_opt_outs TO service_role;
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms_opt_outs: admins read"
  ON public.sms_opt_outs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sms_opt_outs: service role writes"
  ON public.sms_opt_outs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.stripe_refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  stripe_refund_id      text NOT NULL UNIQUE,
  stripe_payment_intent text,
  amount_cents          int NOT NULL,
  currency              text NOT NULL DEFAULT 'usd',
  reason                text,
  status                text NOT NULL,
  environment           text NOT NULL DEFAULT 'sandbox',
  initiated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.stripe_refunds FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.stripe_refunds TO authenticated;
GRANT  ALL    ON public.stripe_refunds TO service_role;
ALTER TABLE public.stripe_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_refunds: admins read"
  ON public.stripe_refunds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "stripe_refunds: service role writes"
  ON public.stripe_refunds FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS stripe_refunds_booking_idx ON public.stripe_refunds (booking_id);

CREATE OR REPLACE FUNCTION public.admin_integration_health_summary()
RETURNS TABLE (
  integration text,
  status text,
  latency_ms int,
  checked_at timestamptz,
  details jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (h.integration)
      h.integration, h.status, h.latency_ms, h.checked_at, h.details
    FROM public.integration_health h
    ORDER BY h.integration, h.checked_at DESC
  ),
  email_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int   AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'skipped_no_provider')::int AS skipped
    FROM public.email_deliveries
    WHERE created_at > now() - interval '24 hours'
  ),
  sms_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent')::int   AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'skipped_no_provider')::int AS skipped
    FROM public.sms_deliveries
    WHERE created_at > now() - interval '24 hours'
  )
  SELECT l.integration, l.status, l.latency_ms, l.checked_at, l.details FROM latest l
  UNION ALL
  SELECT 'email_24h'::text,
         CASE WHEN e.failed > 0 AND e.sent = 0 THEN 'degraded' WHEN e.sent > 0 THEN 'healthy' ELSE 'unknown' END,
         NULL::int, now(),
         jsonb_build_object('sent', e.sent, 'failed', e.failed, 'skipped_no_provider', e.skipped) FROM email_stats e
  UNION ALL
  SELECT 'sms_24h'::text,
         CASE WHEN s.failed > 0 AND s.sent = 0 THEN 'degraded' WHEN s.sent > 0 THEN 'healthy' ELSE 'unknown' END,
         NULL::int, now(),
         jsonb_build_object('sent', s.sent, 'failed', s.failed, 'skipped_no_provider', s.skipped) FROM sms_stats s;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_integration_health_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_integration_health_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.sms_opt_out(_phone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _phone IS NULL OR length(_phone) < 6 THEN RAISE EXCEPTION 'phone required'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.sms_opt_outs (phone, reason)
  VALUES (_phone, 'user_request')
  ON CONFLICT (phone) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.sms_opt_out(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sms_opt_out(text) TO authenticated;
