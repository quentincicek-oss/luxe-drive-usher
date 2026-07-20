
-- 1. Tighten SECURITY DEFINER grants: remove anon EXECUTE from admin/auth-only RPCs.
REVOKE EXECUTE ON FUNCTION public.admin_delete_amenity(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_amenities() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_support_assign(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_support_reply(uuid, text, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_support_set_status(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_support_settings(jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_amenity(uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.booking_amenity_total_cents(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_user_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_active_amenities(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_booking_amenities(uuid, uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_mark_read(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_open_conversation(text, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_send_message(uuid, text) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_delete_amenity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_amenities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_assign(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_reply(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_set_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_support_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_amenity(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_amenity_total_cents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_amenities(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_booking_amenities(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_mark_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_open_conversation(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_send_message(uuid, text) TO authenticated;

-- 2. Granular MFA reset outcome auditing.
--    Replaces single-shot 'admin.mfa_factor_reset' with request/completion/failure states.
--    Original admin_audit_mfa_reset is retained (compat) but the server function no longer calls it.

-- 2a. Request/authorize: same authorization rules as before, action = 'admin.mfa_factor_reset_requested'.
CREATE OR REPLACE FUNCTION public.admin_audit_mfa_reset_requested(_target_user_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  clean_reason text := btrim(coalesce(_reason, ''));
  new_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(actor, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _target_user_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;
  IF actor = _target_user_id THEN RAISE EXCEPTION 'self reset not allowed'; END IF;
  IF NOT public.has_role(_target_user_id, 'admin') THEN RAISE EXCEPTION 'target is not an admin'; END IF;
  IF length(clean_reason) < 4 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF length(clean_reason) > 500 THEN RAISE EXCEPTION 'reason too long'; END IF;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, reason, next)
  VALUES (
    actor,
    'admin.mfa_factor_reset_requested',
    'user',
    _target_user_id,
    left(clean_reason, 500),
    jsonb_build_object('target_user_id', _target_user_id)
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_audit_mfa_reset_requested(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_audit_mfa_reset_requested(uuid, text) TO authenticated;

-- 2b. Outcome: records completion or failure. Requires the caller to still be an admin.
--     Never accepts factor secrets — only counts and a sanitized outcome string.
CREATE OR REPLACE FUNCTION public.admin_audit_mfa_reset_outcome(
  _target_user_id uuid,
  _outcome text,
  _total integer,
  _removed integer,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  action_label text;
  clean_error text := left(btrim(coalesce(_error, '')), 500);
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.has_role(actor, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _target_user_id IS NULL THEN RAISE EXCEPTION 'target required'; END IF;
  IF actor = _target_user_id THEN RAISE EXCEPTION 'self reset not allowed'; END IF;
  IF _outcome NOT IN ('completed','failed','partial') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  IF _total IS NULL OR _total < 0 THEN RAISE EXCEPTION 'invalid total'; END IF;
  IF _removed IS NULL OR _removed < 0 OR _removed > _total THEN RAISE EXCEPTION 'invalid removed count'; END IF;

  action_label := CASE _outcome
    WHEN 'completed' THEN 'admin.mfa_factor_reset_completed'
    WHEN 'partial'   THEN 'admin.mfa_factor_reset_partial'
    ELSE                  'admin.mfa_factor_reset_failed'
  END;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, reason, next)
  VALUES (
    actor,
    action_label,
    'user',
    _target_user_id,
    NULLIF(clean_error, ''),
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'outcome', _outcome,
      'factors_total', _total,
      'factors_removed', _removed
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_audit_mfa_reset_outcome(uuid, text, integer, integer, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_audit_mfa_reset_outcome(uuid, text, integer, integer, text) TO authenticated;
