
-- Phase I-Z — Driver Sign In server gate + Admin MFA recovery audit

-- 1) Server-authoritative driver eligibility gate.
--    Returns TRUE only when the caller is a fully provisioned, active,
--    non-suspended driver with exactly one authoritative driver role
--    and exactly one linked driver_profiles row. Returns FALSE for
--    every other case (passenger, admin, suspended, inactive,
--    conflicting roles, missing profile). Never reveals the reason.
CREATE OR REPLACE FUNCTION public.driver_signin_eligibility()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  role_count int;
  driver_role_count int;
  profile_count int;
  is_suspended boolean;
  emp_status text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  SELECT count(*) INTO role_count FROM public.user_roles WHERE user_id = uid;
  SELECT count(*) INTO driver_role_count FROM public.user_roles
    WHERE user_id = uid AND role = 'driver';
  -- must have exactly one authoritative role, and it must be driver
  IF role_count <> 1 OR driver_role_count <> 1 THEN RETURN false; END IF;

  SELECT p.is_suspended INTO is_suspended
    FROM public.profiles p WHERE p.id = uid;
  IF is_suspended IS TRUE THEN RETURN false; END IF;

  SELECT count(*) INTO profile_count FROM public.driver_profiles WHERE user_id = uid;
  IF profile_count <> 1 THEN RETURN false; END IF;

  SELECT dp.employment_status INTO emp_status
    FROM public.driver_profiles dp WHERE dp.user_id = uid;
  IF emp_status IS DISTINCT FROM 'active' THEN RETURN false; END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_signin_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_signin_eligibility() FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_signin_eligibility() TO authenticated;

-- 2) MFA-reset audit RPC. Removal of another admin's TOTP factor
--    happens via the Auth Admin API in a server function using the
--    service-role client. This RPC records the atomic audit event and
--    enforces authorization (caller must be an admin, target must be
--    an admin, no self-reset). It does NOT touch auth.mfa_factors.
CREATE OR REPLACE FUNCTION public.admin_audit_mfa_reset(
  _target_user_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  clean_reason text := btrim(coalesce(_reason, ''));
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(actor, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _target_user_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;
  IF actor = _target_user_id THEN RAISE EXCEPTION 'self reset not allowed'; END IF;
  IF NOT public.has_role(_target_user_id, 'admin') THEN
    RAISE EXCEPTION 'target is not an admin';
  END IF;
  IF length(clean_reason) < 4 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF length(clean_reason) > 500 THEN RAISE EXCEPTION 'reason too long'; END IF;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, reason, next)
  VALUES (
    actor,
    'admin.mfa_factor_reset',
    'user',
    _target_user_id,
    left(clean_reason, 500),
    jsonb_build_object('target_user_id', _target_user_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_audit_mfa_reset(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_audit_mfa_reset(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_audit_mfa_reset(uuid, text) TO authenticated;

-- 3) Admin listing helper for MFA status (returns admin ids + email only).
CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS TABLE (user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT ur.user_id, p.email
      FROM public.user_roles ur
      LEFT JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin'
     ORDER BY p.email NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO authenticated;
