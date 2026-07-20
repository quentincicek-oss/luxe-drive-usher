
CREATE OR REPLACE FUNCTION public.admin_update_user_profile(
  _user_id uuid,
  _profile jsonb,
  _driver  jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  prev_profile jsonb;
  new_profile  jsonb;
  prev_driver  jsonb;
  new_driver   jsonb;
  drv_id       uuid;
  is_driver    boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;

  SELECT to_jsonb(p.*) INTO prev_profile FROM public.profiles p WHERE id = _user_id FOR UPDATE;
  IF prev_profile IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  UPDATE public.profiles SET
    name               = COALESCE(NULLIF(_profile->>'name',''),               name),
    surname            = COALESCE(NULLIF(_profile->>'surname',''),            surname),
    phone              = COALESCE(NULLIF(_profile->>'phone',''),              phone),
    preferred_language = COALESCE(NULLIF(_profile->>'preferred_language',''), preferred_language),
    updated_at         = now()
  WHERE id = _user_id
  RETURNING to_jsonb(profiles.*) INTO new_profile;

  PERFORM public._audit_write(auth.uid(),'user.profile_updated','user',_user_id,prev_profile,new_profile,NULL);

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'driver')
    INTO is_driver;

  IF is_driver AND _driver IS NOT NULL THEN
    SELECT id, to_jsonb(dp.*) INTO drv_id, prev_driver
    FROM public.driver_profiles dp WHERE user_id = _user_id FOR UPDATE;
    IF drv_id IS NULL THEN RAISE EXCEPTION 'driver profile not found'; END IF;

    IF COALESCE(_driver->>'employee_id','') <> '' AND EXISTS (
      SELECT 1 FROM public.driver_profiles
      WHERE employee_id = _driver->>'employee_id' AND id <> drv_id
    ) THEN
      RAISE EXCEPTION 'employee_id already in use';
    END IF;

    UPDATE public.driver_profiles SET
      full_name         = COALESCE(NULLIF(_driver->>'full_name',''),   full_name),
      employee_id       = COALESCE(NULLIF(_driver->>'employee_id',''), employee_id),
      phone             = COALESCE(NULLIF(_driver->>'phone',''),       phone),
      employment_status = COALESCE(NULLIF(_driver->>'employment_status','')::public.driver_employment, employment_status),
      updated_at        = now()
    WHERE id = drv_id
    RETURNING to_jsonb(driver_profiles.*) INTO new_driver;

    PERFORM public._audit_write(auth.uid(),'driver.updated','driver_profile',drv_id,prev_driver,new_driver,NULL);
  END IF;

  RETURN jsonb_build_object(
    'user_id', _user_id,
    'profile', new_profile,
    'driver',  new_driver
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_profile(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_profile(uuid, jsonb, jsonb) TO authenticated;
