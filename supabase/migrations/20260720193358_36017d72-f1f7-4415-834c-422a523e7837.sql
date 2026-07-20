
-- 1) Suspension + test-account markers on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

-- 2) Provisioning finalize RPC
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
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF _account_type NOT IN ('admin','driver','passenger') THEN RAISE EXCEPTION 'invalid account_type'; END IF;
  role_val := _account_type::public.app_role;

  -- Ensure profile row and update identity + test marker
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

  -- Authoritative role: single row for this user
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, role_val);

  -- Driver profile handling
  IF _account_type = 'driver' THEN
    IF _driver IS NULL OR COALESCE(_driver->>'employee_id','') = '' OR COALESCE(_driver->>'full_name','') = '' THEN
      RAISE EXCEPTION 'driver payload requires employee_id and full_name';
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE employee_id = _driver->>'employee_id' AND user_id IS DISTINCT FROM _user_id) THEN
      RAISE EXCEPTION 'employee_id already in use';
    END IF;
    INSERT INTO public.driver_profiles (user_id, full_name, employee_id, phone, email, employment_status, availability_status)
    VALUES (
      _user_id,
      _driver->>'full_name',
      _driver->>'employee_id',
      _driver->>'phone',
      _driver->>'email',
      'active'::public.employment_status,
      'offline'::public.driver_availability
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name          = EXCLUDED.full_name,
      employee_id        = EXCLUDED.employee_id,
      phone              = COALESCE(EXCLUDED.phone, public.driver_profiles.phone),
      email              = COALESCE(EXCLUDED.email, public.driver_profiles.email),
      employment_status  = 'active'::public.employment_status,
      updated_at         = now()
    RETURNING * INTO drv_row;
  ELSE
    -- non-driver: remove any prior driver profile link
    UPDATE public.driver_profiles SET user_id = NULL, updated_at = now()
      WHERE user_id = _user_id;
  END IF;

  final := jsonb_build_object(
    'user_id', _user_id,
    'account_type', _account_type,
    'profile', prev,
    'driver_profile_id', COALESCE(drv_row.id::text, NULL),
    'is_test_account', COALESCE(_is_test, false)
  );

  PERFORM public._audit_write(
    auth.uid(),
    'user.provisioned',
    'user',
    _user_id,
    NULL,
    final,
    NULL
  );
  RETURN final;
END;
$$;

-- 3) Suspension RPC — atomic profile + driver flip + block when active work
CREATE OR REPLACE FUNCTION public.admin_set_user_suspension(
  _user_id uuid,
  _suspend boolean,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE prev jsonb; nxt jsonb; active_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'cannot suspend self'; END IF;

  SELECT to_jsonb(p.*) INTO prev FROM public.profiles p WHERE id = _user_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  IF _suspend THEN
    -- Block suspension if driver has active operational assignment
    SELECT count(*) INTO active_count
    FROM public.booking_assignments ba
    JOIN public.driver_profiles dp ON dp.id = ba.driver_id
    WHERE dp.user_id = _user_id
      AND ba.is_current
      AND ba.dispatch_status IN ('assigned','accepted','en_route','arrived','in_progress');
    IF active_count > 0 THEN
      RAISE EXCEPTION 'driver has % active assignment(s) — resolve before suspension', active_count;
    END IF;

    UPDATE public.profiles SET
      is_suspended = true,
      suspended_at = now(),
      suspended_by = auth.uid(),
      suspended_reason = _reason,
      updated_at = now()
    WHERE id = _user_id RETURNING to_jsonb(profiles.*) INTO nxt;

    UPDATE public.driver_profiles SET
      employment_status = 'inactive'::public.employment_status,
      availability_status = 'offline'::public.driver_availability,
      updated_at = now()
    WHERE user_id = _user_id;
  ELSE
    UPDATE public.profiles SET
      is_suspended = false,
      suspended_at = NULL,
      suspended_by = NULL,
      suspended_reason = NULL,
      updated_at = now()
    WHERE id = _user_id RETURNING to_jsonb(profiles.*) INTO nxt;

    UPDATE public.driver_profiles SET
      employment_status = 'active'::public.employment_status,
      updated_at = now()
    WHERE user_id = _user_id;
  END IF;

  PERFORM public._audit_write(
    auth.uid(),
    CASE WHEN _suspend THEN 'user.suspended' ELSE 'user.reactivated' END,
    'user', _user_id, prev, nxt, _reason
  );
  RETURN nxt;
END;
$$;

-- 4) Managed users list — sanitized
CREATE OR REPLACE FUNCTION public.admin_list_managed_users()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO result
  FROM (
    SELECT
      p.id AS user_id,
      p.email,
      TRIM(BOTH FROM COALESCE(p.name,'') || ' ' || COALESCE(p.surname,'')) AS full_name,
      p.preferred_language,
      p.is_suspended,
      p.suspended_at,
      p.suspended_reason,
      p.is_test_account,
      p.created_at,
      p.updated_at,
      ur.role::text AS role,
      dp.employee_id AS driver_employee_id,
      dp.employment_status::text AS driver_employment_status,
      dp.availability_status::text AS driver_availability_status
    FROM public.profiles p
    LEFT JOIN public.user_roles ur ON ur.user_id = p.id
    LEFT JOIN public.driver_profiles dp ON dp.user_id = p.id
    WHERE ur.role IN ('admin','driver')
       OR p.is_test_account = true
       OR p.is_suspended = true
  ) t;
  RETURN result;
END;
$$;

-- 5) Harden admin_assign_driver: reject suspended drivers
CREATE OR REPLACE FUNCTION public.admin_assign_driver(_booking_id uuid, _driver_id uuid, _vehicle_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE prev jsonb; new_row public.booking_assignments%ROWTYPE; action_label text; drv_user uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id) THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_profiles WHERE id = _driver_id AND employment_status = 'active') THEN
    RAISE EXCEPTION 'driver not active';
  END IF;
  SELECT user_id INTO drv_user FROM public.driver_profiles WHERE id = _driver_id;
  IF drv_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = drv_user AND is_suspended) THEN
    RAISE EXCEPTION 'driver account is suspended';
  END IF;
  IF _vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = _vehicle_id AND status = 'active') THEN
    RAISE EXCEPTION 'vehicle not active';
  END IF;
  SELECT to_jsonb(a.*) INTO prev FROM public.booking_assignments a
    WHERE booking_id = _booking_id AND is_current = true FOR UPDATE;
  action_label := CASE WHEN prev IS NULL THEN 'assignment.created' ELSE 'assignment.reassigned' END;
  INSERT INTO public.booking_assignments (booking_id, driver_id, vehicle_id, dispatch_status, is_current, assigned_by)
  VALUES (_booking_id, _driver_id, _vehicle_id, 'assigned', true, auth.uid())
  RETURNING * INTO new_row;
  UPDATE public.bookings SET status = 'accepted', updated_at = now()
    WHERE id = _booking_id AND status IN ('requested','pending');
  PERFORM public._audit_write(auth.uid(), action_label, 'booking_assignment', new_row.id,
                              prev, to_jsonb(new_row), _reason);
  RETURN to_jsonb(new_row);
END; $function$;

-- 6) Harden admin_set_driver_availability: reject changes while suspended
CREATE OR REPLACE FUNCTION public.admin_set_driver_availability(_driver_id uuid, _availability text, _reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE prev jsonb; nxt jsonb; drv_user uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _availability NOT IN ('available','assigned','on_trip','offline','vacation') THEN
    RAISE EXCEPTION 'invalid availability';
  END IF;
  SELECT to_jsonb(dp.*), dp.user_id INTO prev, drv_user
    FROM public.driver_profiles dp WHERE id = _driver_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'driver not found'; END IF;
  IF drv_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = drv_user AND is_suspended) THEN
    RAISE EXCEPTION 'driver account is suspended';
  END IF;
  UPDATE public.driver_profiles SET availability_status = _availability::public.driver_availability, updated_at = now()
    WHERE id = _driver_id
    RETURNING to_jsonb(driver_profiles.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'driver.availability_changed','driver_profile',_driver_id,prev,nxt,_reason);
  RETURN nxt;
END; $function$;

-- 7) Harden advance_assignment: block non-terminal moves when driver suspended
CREATE OR REPLACE FUNCTION public.advance_assignment(_assignment_id uuid, _next_status text, _reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a public.booking_assignments%ROWTYPE;
  is_admin boolean := public.has_role(auth.uid(), 'admin');
  is_driver boolean;
  verified boolean;
  event_label text;
  allowed boolean := false;
  drv_user uuid;
  drv_suspended boolean := false;
BEGIN
  SELECT * INTO a FROM public.booking_assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.id = a.driver_id AND dp.user_id = auth.uid()
  ) INTO is_driver;
  IF NOT (is_admin OR is_driver) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT dp.user_id INTO drv_user FROM public.driver_profiles dp WHERE dp.id = a.driver_id;
  IF drv_user IS NOT NULL THEN
    SELECT is_suspended INTO drv_suspended FROM public.profiles WHERE id = drv_user;
  END IF;
  IF drv_suspended AND _next_status NOT IN ('cancelled') THEN
    RAISE EXCEPTION 'driver account is suspended';
  END IF;

  allowed := CASE a.dispatch_status::text
    WHEN 'pending'     THEN _next_status IN ('assigned','cancelled')
    WHEN 'assigned'    THEN _next_status IN ('accepted','cancelled')
    WHEN 'accepted'    THEN _next_status IN ('en_route','cancelled')
    WHEN 'en_route'    THEN _next_status IN ('arrived','cancelled')
    WHEN 'arrived'     THEN _next_status IN ('in_progress','cancelled')
    WHEN 'in_progress' THEN _next_status IN ('completed')
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', a.dispatch_status, _next_status;
  END IF;

  IF _next_status = 'in_progress' THEN
    SELECT EXISTS(SELECT 1 FROM public.passenger_verifications WHERE booking_id = a.booking_id) INTO verified;
    IF NOT verified THEN RAISE EXCEPTION 'passenger not verified'; END IF;
  END IF;

  event_label := CASE _next_status
    WHEN 'accepted' THEN 'accepted' WHEN 'en_route' THEN 'en_route'
    WHEN 'arrived' THEN 'arrived' WHEN 'in_progress' THEN 'started'
    WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled'
    ELSE _next_status
  END;

  UPDATE public.booking_assignments
    SET dispatch_status = _next_status::public.dispatch_status, updated_at = now()
    WHERE id = _assignment_id;

  INSERT INTO public.driver_trip_events (assignment_id, driver_id, event, reason)
  VALUES (_assignment_id, a.driver_id, event_label, _reason);

  IF _next_status = 'completed' THEN
    UPDATE public.bookings SET status = 'completed', updated_at = now() WHERE id = a.booking_id;
  ELSIF _next_status = 'cancelled' THEN
    UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = a.booking_id;
  ELSIF _next_status IN ('accepted','en_route','arrived','in_progress') THEN
    UPDATE public.bookings SET status = 'accepted', updated_at = now()
      WHERE id = a.booking_id AND status IN ('requested','pending');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _next_status);
END; $function$;

-- Grants (revoke public/anon, grant only authenticated)
REVOKE ALL ON FUNCTION public.admin_provision_user_finalize(uuid, text, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_user_finalize(uuid, text, jsonb, jsonb, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_user_suspension(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_suspension(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_managed_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_managed_users() TO authenticated;
