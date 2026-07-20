
-- =========================================================================
-- Phase I-E.1 — Provisioning hardening (M1..M4)  [retry: builtin sha256]
-- =========================================================================

DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT lower(btrim(email))
    FROM public.driver_profiles
    WHERE email IS NOT NULL AND btrim(email) <> ''
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'aborting: % duplicate normalized driver email(s) found', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS driver_profiles_email_ci_unique
  ON public.driver_profiles ((lower(btrim(email))))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS public.invitation_cooldowns (
  email_key          text PRIMARY KEY,
  last_sent_at       timestamptz NOT NULL DEFAULT now(),
  send_count         integer NOT NULL DEFAULT 1,
  last_actor_id      uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.invitation_cooldowns FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.invitation_cooldowns TO service_role;
ALTER TABLE public.invitation_cooldowns ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._email_fingerprint(_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT substr(encode(sha256(convert_to(lower(btrim(coalesce(_email,''))), 'UTF8')), 'hex'), 1, 16);
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_provisioning_failure(
  _email             text,
  _account_type      text,
  _failure_category  text,
  _correlation_id    text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  actor_email_val text;
  payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _account_type IS NULL OR _account_type NOT IN ('admin','driver','passenger') THEN
    _account_type := 'unknown';
  END IF;
  IF _failure_category IS NULL OR length(_failure_category) > 64
     OR _failure_category NOT IN (
       'validation','authorization','conflict_existing_role',
       'invitation_failed','cooldown_active','rpc_failed',
       'auth_lookup_failed','internal_error','unspecified'
     ) THEN
    _failure_category := 'unspecified';
  END IF;

  SELECT email INTO actor_email_val FROM public.profiles WHERE id = auth.uid();

  payload := jsonb_build_object(
    'email_fingerprint', public._email_fingerprint(_email),
    'requested_account_type', _account_type,
    'failure_category', _failure_category,
    'correlation_id', substr(coalesce(_correlation_id,''), 1, 64)
  );

  INSERT INTO public.audit_log
    (actor_id, actor_email, action, entity_type, entity_id, previous, next, reason)
  VALUES
    (auth.uid(), actor_email_val, 'user.provisioning_failed', 'user', NULL, NULL, payload, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_audit_provisioning_failure(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_audit_provisioning_failure(text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reserve_invitation_slot(
  _email             text,
  _cooldown_seconds  integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  key_val text;
  cooldown_secs int := GREATEST(coalesce(_cooldown_seconds, 300), 1);
  now_ts timestamptz := now();
  updated_row public.invitation_cooldowns%ROWTYPE;
  next_available timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _email IS NULL OR btrim(_email) = '' THEN RAISE EXCEPTION 'email required'; END IF;
  key_val := lower(btrim(_email));

  INSERT INTO public.invitation_cooldowns (email_key, last_sent_at, send_count, last_actor_id)
  VALUES (key_val, now_ts, 1, auth.uid())
  ON CONFLICT (email_key) DO UPDATE
    SET last_sent_at  = CASE
                          WHEN public.invitation_cooldowns.last_sent_at + (cooldown_secs || ' seconds')::interval <= now_ts
                          THEN now_ts ELSE public.invitation_cooldowns.last_sent_at
                        END,
        send_count    = CASE
                          WHEN public.invitation_cooldowns.last_sent_at + (cooldown_secs || ' seconds')::interval <= now_ts
                          THEN public.invitation_cooldowns.send_count + 1
                          ELSE public.invitation_cooldowns.send_count
                        END,
        last_actor_id = CASE
                          WHEN public.invitation_cooldowns.last_sent_at + (cooldown_secs || ' seconds')::interval <= now_ts
                          THEN auth.uid() ELSE public.invitation_cooldowns.last_actor_id
                        END,
        updated_at    = now_ts
  RETURNING * INTO updated_row;

  IF updated_row.last_sent_at = now_ts THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'retry_after_seconds', cooldown_secs,
      'next_available_at', now_ts + (cooldown_secs || ' seconds')::interval
    );
  ELSE
    next_available := updated_row.last_sent_at + (cooldown_secs || ' seconds')::interval;
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', GREATEST(EXTRACT(EPOCH FROM (next_available - now_ts))::int, 1),
      'next_available_at', next_available
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reserve_invitation_slot(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reserve_invitation_slot(text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_invitation_cooldown(
  _email             text,
  _cooldown_seconds  integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  key_val text; last_ts timestamptz; next_available timestamptz;
  cooldown_secs int := GREATEST(coalesce(_cooldown_seconds, 300), 1);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _email IS NULL OR btrim(_email) = '' THEN
    RETURN jsonb_build_object('available', true, 'retry_after_seconds', 0);
  END IF;
  key_val := lower(btrim(_email));
  SELECT last_sent_at INTO last_ts FROM public.invitation_cooldowns WHERE email_key = key_val;
  IF last_ts IS NULL THEN
    RETURN jsonb_build_object('available', true, 'retry_after_seconds', 0);
  END IF;
  next_available := last_ts + (cooldown_secs || ' seconds')::interval;
  IF next_available <= now() THEN
    RETURN jsonb_build_object('available', true, 'retry_after_seconds', 0);
  END IF;
  RETURN jsonb_build_object(
    'available', false,
    'retry_after_seconds', GREATEST(EXTRACT(EPOCH FROM (next_available - now()))::int, 1),
    'next_available_at', next_available
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_invitation_cooldown(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_invitation_cooldown(text,integer) TO authenticated;

-- Rewrite finalize RPC: block silent passenger→staff promotion, idempotent role insert.
CREATE OR REPLACE FUNCTION public.admin_provision_user_finalize(
  _user_id uuid,
  _account_type text,
  _profile jsonb,
  _driver jsonb DEFAULT NULL,
  _is_test boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  prev jsonb;
  drv_row public.driver_profiles%ROWTYPE;
  role_val public.app_role;
  final jsonb;
  existing_role public.app_role;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF _account_type NOT IN ('admin','driver','passenger') THEN RAISE EXCEPTION 'invalid account_type'; END IF;
  role_val := _account_type::public.app_role;

  SELECT role INTO existing_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
  IF existing_role IS NOT NULL AND existing_role <> role_val THEN
    RAISE EXCEPTION 'conflict_existing_role:%', existing_role::text;
  END IF;

  INSERT INTO public.profiles (id, email, name, surname, phone, preferred_language, is_test_account)
  VALUES (
    _user_id,
    COALESCE(_profile->>'email',''),
    _profile->>'name',
    _profile->>'surname',
    _profile->>'phone',
    COALESCE(_profile->>'preferred_language','en'),
    COALESCE(_is_test, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    email              = COALESCE(NULLIF(EXCLUDED.email,''), public.profiles.email),
    name               = COALESCE(EXCLUDED.name, public.profiles.name),
    surname            = COALESCE(EXCLUDED.surname, public.profiles.surname),
    phone              = COALESCE(EXCLUDED.phone, public.profiles.phone),
    preferred_language = COALESCE(EXCLUDED.preferred_language, public.profiles.preferred_language),
    is_test_account    = COALESCE(_is_test, public.profiles.is_test_account),
    updated_at         = now();

  SELECT to_jsonb(p.*) INTO prev FROM public.profiles p WHERE id = _user_id;

  INSERT INTO public.user_roles (user_id, role)
    SELECT _user_id, role_val
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = role_val);

  IF _account_type = 'driver' THEN
    IF _driver IS NULL OR COALESCE(_driver->>'employee_id','') = '' OR COALESCE(_driver->>'full_name','') = '' THEN
      RAISE EXCEPTION 'driver payload requires employee_id and full_name';
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE employee_id = _driver->>'employee_id' AND user_id IS DISTINCT FROM _user_id) THEN
      RAISE EXCEPTION 'employee_id already in use';
    END IF;
    INSERT INTO public.driver_profiles (user_id, full_name, employee_id, phone, email, employment_status, availability_status)
    VALUES (
      _user_id, _driver->>'full_name', _driver->>'employee_id',
      _driver->>'phone', _driver->>'email',
      'active'::public.employment_status, 'offline'::public.driver_availability
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name         = EXCLUDED.full_name,
      employee_id       = EXCLUDED.employee_id,
      phone             = COALESCE(EXCLUDED.phone, public.driver_profiles.phone),
      email             = COALESCE(EXCLUDED.email, public.driver_profiles.email),
      employment_status = 'active'::public.employment_status,
      updated_at        = now()
    RETURNING * INTO drv_row;
  END IF;

  final := jsonb_build_object(
    'user_id', _user_id,
    'account_type', _account_type,
    'profile', prev,
    'driver_profile_id', COALESCE(drv_row.id::text, NULL),
    'is_test_account', COALESCE(_is_test, false)
  );
  PERFORM public._audit_write(auth.uid(), 'user.provisioned', 'user', _user_id, NULL, final, NULL);
  RETURN final;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provision_user_finalize(uuid, text, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_user_finalize(uuid, text, jsonb, jsonb, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_convert_user_role(
  _user_id      uuid,
  _new_role     text,
  _reason       text,
  _driver       jsonb DEFAULT NULL,
  _confirmed    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  prev_profile jsonb; prev_role public.app_role; new_role_val public.app_role;
  active_bookings int; active_assignments int;
  drv_row public.driver_profiles%ROWTYPE; suspended_flag boolean; final jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'cannot convert self'; END IF;
  IF _confirmed IS NOT TRUE THEN RAISE EXCEPTION 'confirmation required'; END IF;
  IF _new_role NOT IN ('admin','driver','passenger') THEN RAISE EXCEPTION 'invalid new_role'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 4 THEN RAISE EXCEPTION 'reason required'; END IF;
  new_role_val := _new_role::public.app_role;

  SELECT to_jsonb(p.*), p.is_suspended INTO prev_profile, suspended_flag
    FROM public.profiles p WHERE id = _user_id FOR UPDATE;
  IF prev_profile IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF suspended_flag THEN RAISE EXCEPTION 'cannot convert suspended account'; END IF;

  SELECT role INTO prev_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
  IF prev_role IS NULL THEN RAISE EXCEPTION 'ambiguous: user has no existing role'; END IF;
  IF prev_role = new_role_val THEN RAISE EXCEPTION 'user already has role %', new_role_val; END IF;

  SELECT count(*) INTO active_bookings FROM public.bookings
    WHERE user_id = _user_id AND status IN ('requested','pending','accepted');
  IF active_bookings > 0 THEN
    RAISE EXCEPTION 'user has % active booking(s)', active_bookings;
  END IF;

  SELECT count(*) INTO active_assignments
    FROM public.booking_assignments ba
    JOIN public.driver_profiles dp ON dp.id = ba.driver_id
    WHERE dp.user_id = _user_id AND ba.is_current
      AND ba.dispatch_status IN ('assigned','accepted','en_route','arrived','in_progress');
  IF active_assignments > 0 THEN
    RAISE EXCEPTION 'user has % active assignment(s)', active_assignments;
  END IF;

  IF new_role_val = 'driver'::public.app_role THEN
    IF _driver IS NULL OR COALESCE(_driver->>'employee_id','') = '' OR COALESCE(_driver->>'full_name','') = '' THEN
      RAISE EXCEPTION 'driver payload with employee_id and full_name required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE employee_id = _driver->>'employee_id' AND user_id IS DISTINCT FROM _user_id) THEN
      RAISE EXCEPTION 'employee_id already in use';
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, new_role_val);

  IF new_role_val = 'driver'::public.app_role THEN
    INSERT INTO public.driver_profiles (user_id, full_name, employee_id, phone, email, employment_status, availability_status)
    VALUES (
      _user_id, _driver->>'full_name', _driver->>'employee_id',
      _driver->>'phone', _driver->>'email',
      'active'::public.employment_status, 'offline'::public.driver_availability
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name         = EXCLUDED.full_name,
      employee_id       = EXCLUDED.employee_id,
      phone             = COALESCE(EXCLUDED.phone, public.driver_profiles.phone),
      email             = COALESCE(EXCLUDED.email, public.driver_profiles.email),
      employment_status = 'active'::public.employment_status,
      updated_at        = now()
    RETURNING * INTO drv_row;
  ELSIF prev_role = 'driver'::public.app_role THEN
    UPDATE public.driver_profiles
       SET user_id = NULL,
           employment_status = 'inactive'::public.employment_status,
           availability_status = 'offline'::public.driver_availability,
           updated_at = now()
     WHERE user_id = _user_id;
  END IF;

  final := jsonb_build_object(
    'user_id', _user_id,
    'previous_role', prev_role::text,
    'new_role', new_role_val::text,
    'driver_profile_id', COALESCE(drv_row.id::text, NULL)
  );
  PERFORM public._audit_write(
    auth.uid(), 'user.role_converted', 'user', _user_id,
    jsonb_build_object('role', prev_role::text), final, _reason
  );
  RETURN final;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_convert_user_role(uuid, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_convert_user_role(uuid, text, text, jsonb, boolean) TO authenticated;
