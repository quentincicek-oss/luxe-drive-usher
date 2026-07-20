
CREATE OR REPLACE FUNCTION public.admin_upsert_verification_settings(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prev jsonb;
  nxt jsonb;
  v_pin boolean;
  v_qr boolean;
  v_nfc boolean;
  v_min int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload';
  END IF;

  -- Validate min_waiting_seconds range if provided
  IF _payload ? 'min_waiting_seconds' THEN
    v_min := (_payload->>'min_waiting_seconds')::int;
    IF v_min IS NULL OR v_min < 60 OR v_min > 1800 THEN
      RAISE EXCEPTION 'min_waiting_seconds out of range';
    END IF;
  END IF;

  -- Validate booleans if provided
  IF _payload ? 'pin_enabled' THEN v_pin := (_payload->>'pin_enabled')::boolean; END IF;
  IF _payload ? 'qr_enabled'  THEN v_qr  := (_payload->>'qr_enabled')::boolean;  END IF;
  IF _payload ? 'nfc_enabled' THEN v_nfc := (_payload->>'nfc_enabled')::boolean; END IF;

  SELECT to_jsonb(v.*) INTO prev FROM public.verification_settings v WHERE id = 1 FOR UPDATE;
  IF prev IS NULL THEN
    INSERT INTO public.verification_settings (id, pin_enabled, qr_enabled, nfc_enabled, min_waiting_seconds, updated_at, updated_by)
    VALUES (
      1,
      COALESCE(v_pin, true),
      COALESCE(v_qr, true),
      COALESCE(v_nfc, true),
      COALESCE(v_min, 300),
      now(),
      auth.uid()
    )
    RETURNING to_jsonb(verification_settings.*) INTO nxt;
  ELSE
    UPDATE public.verification_settings SET
      pin_enabled         = COALESCE(v_pin, pin_enabled),
      qr_enabled          = COALESCE(v_qr,  qr_enabled),
      nfc_enabled         = COALESCE(v_nfc, nfc_enabled),
      min_waiting_seconds = COALESCE(v_min, min_waiting_seconds),
      updated_at          = now(),
      updated_by          = auth.uid()
    WHERE id = 1
    RETURNING to_jsonb(verification_settings.*) INTO nxt;
  END IF;

  PERFORM public._audit_write(
    auth.uid(),
    'settings.verification.update',
    'verification_settings',
    NULL,
    prev,
    nxt,
    NULL
  );

  RETURN nxt;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_upsert_verification_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_verification_settings(jsonb) TO authenticated;
