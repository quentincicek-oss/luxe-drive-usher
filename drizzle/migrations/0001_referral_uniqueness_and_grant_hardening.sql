-- 1) One referral claim per referred user, enforced by the database so two
--    concurrent claims cannot both pass the application-level check.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_user_unique
  ON public.referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL;

-- 2) Least privilege: service-only / internal tables must not be reachable by
--    unauthenticated Data API callers.
REVOKE ALL ON public.ai_router_events FROM anon;
REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.rate_limits FROM anon;
REVOKE ALL ON public.monitoring_events FROM anon;
REVOKE ALL ON public.integration_health FROM anon;
REVOKE ALL ON public.stripe_events FROM anon;
REVOKE ALL ON public.stripe_refunds FROM anon;
REVOKE ALL ON public.restore_drills FROM anon;
REVOKE ALL ON public.email_deliveries FROM anon;
REVOKE ALL ON public.sms_deliveries FROM anon;
REVOKE ALL ON public.admin_recovery_codes FROM anon;
REVOKE ALL ON public.booking_pins FROM anon;
REVOKE ALL ON public.receipt_verifications FROM anon;

-- 3) Booking creation and monitoring capture are authenticated-only actions.
REVOKE EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text, double precision, double precision, text, jsonb, double precision, double precision, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.monitoring_capture(text, text, text, jsonb, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text, double precision, double precision, text, jsonb, double precision, double precision, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_capture(text, text, text, jsonb, text) TO authenticated;
