
-- Shared audit helper (private, invoked only by other SECURITY DEFINER admin fns)
CREATE OR REPLACE FUNCTION public._audit_write(
  _actor_id uuid, _action text, _entity_type text, _entity_id uuid,
  _previous jsonb, _nxt jsonb, _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_email_val text;
BEGIN
  SELECT email INTO actor_email_val FROM public.profiles WHERE id = _actor_id;
  INSERT INTO public.audit_log (actor_id, actor_email, action, entity_type, entity_id, previous, next, reason)
  VALUES (_actor_id, actor_email_val, _action, _entity_type, _entity_id, _previous, _nxt, _reason);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_booking_status(
  _booking_id uuid, _status text, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('requested','pending','accepted','completed','cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT to_jsonb(b.*) INTO prev FROM public.bookings b WHERE id = _booking_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  UPDATE public.bookings SET status = _status, updated_at = now() WHERE id = _booking_id
    RETURNING to_jsonb(bookings.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'booking.status_changed','booking',_booking_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_driver_availability(
  _driver_id uuid, _availability text, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _availability NOT IN ('available','assigned','on_trip','offline','vacation') THEN
    RAISE EXCEPTION 'invalid availability';
  END IF;
  SELECT to_jsonb(dp.*) INTO prev FROM public.driver_profiles dp WHERE id = _driver_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'driver not found'; END IF;
  UPDATE public.driver_profiles SET availability_status = _availability::public.driver_availability, updated_at = now()
    WHERE id = _driver_id
    RETURNING to_jsonb(driver_profiles.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'driver.availability_changed','driver_profile',_driver_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_assign_driver(
  _booking_id uuid, _driver_id uuid, _vehicle_id uuid DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.booking_assignments%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id) THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_profiles WHERE id = _driver_id AND employment_status = 'active') THEN
    RAISE EXCEPTION 'driver not active';
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
END; $$;

CREATE OR REPLACE FUNCTION public.admin_remove_assignment(
  _assignment_id uuid, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(a.*) INTO prev FROM public.booking_assignments a WHERE id = _assignment_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;
  UPDATE public.booking_assignments
    SET is_current = false, dispatch_status = 'cancelled', updated_at = now()
    WHERE id = _assignment_id
    RETURNING to_jsonb(booking_assignments.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'assignment.removed','booking_assignment',_assignment_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_driver(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.driver_profiles%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_payload->>'full_name','') = '' OR COALESCE(_payload->>'employee_id','') = '' THEN
    RAISE EXCEPTION 'full_name and employee_id required';
  END IF;
  IF _id IS NULL THEN
    action_label := 'driver.created';
    INSERT INTO public.driver_profiles (
      full_name, employee_id, phone, email, photo_url, license_number, license_expires_at,
      employment_status, availability_status, assigned_vehicle_id, notes
    ) VALUES (
      _payload->>'full_name', _payload->>'employee_id',
      _payload->>'phone', _payload->>'email', _payload->>'photo_url',
      _payload->>'license_number', NULLIF(_payload->>'license_expires_at','')::date,
      COALESCE(_payload->>'employment_status','active')::public.driver_employment,
      COALESCE(_payload->>'availability_status','offline')::public.driver_availability,
      NULLIF(_payload->>'assigned_vehicle_id','')::uuid, _payload->>'notes'
    ) RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'driver.updated';
    SELECT to_jsonb(dp.*) INTO prev FROM public.driver_profiles dp WHERE id = _id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'driver not found'; END IF;
    UPDATE public.driver_profiles SET
      full_name           = _payload->>'full_name',
      employee_id         = _payload->>'employee_id',
      phone               = _payload->>'phone',
      email               = _payload->>'email',
      photo_url           = _payload->>'photo_url',
      license_number      = _payload->>'license_number',
      license_expires_at  = NULLIF(_payload->>'license_expires_at','')::date,
      employment_status   = COALESCE(_payload->>'employment_status','active')::public.driver_employment,
      availability_status = COALESCE(_payload->>'availability_status','offline')::public.driver_availability,
      assigned_vehicle_id = NULLIF(_payload->>'assigned_vehicle_id','')::uuid,
      notes               = _payload->>'notes',
      updated_at          = now()
    WHERE id = _id RETURNING * INTO new_row;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'driver_profile', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_driver(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(dp.*) INTO prev FROM public.driver_profiles dp WHERE id = _id;
  IF prev IS NULL THEN RAISE EXCEPTION 'driver not found'; END IF;
  DELETE FROM public.driver_profiles WHERE id = _id;
  PERFORM public._audit_write(auth.uid(),'driver.deleted','driver_profile',_id,prev,NULL,_reason);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.vehicles%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_payload->>'name','') = '' OR COALESCE(_payload->>'license_plate','') = '' THEN
    RAISE EXCEPTION 'name and license_plate required';
  END IF;
  IF _id IS NULL THEN
    action_label := 'vehicle.created';
    INSERT INTO public.vehicles (
      name, category, license_plate, vin, model_year, seats, status, insurance_expires_at
    ) VALUES (
      _payload->>'name',
      COALESCE(_payload->>'category','other')::public.vehicle_category,
      _payload->>'license_plate', _payload->>'vin',
      NULLIF(_payload->>'model_year','')::int,
      COALESCE((_payload->>'seats')::int, 6),
      COALESCE(_payload->>'status','active')::public.vehicle_status,
      NULLIF(_payload->>'insurance_expires_at','')::date
    ) RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'vehicle.updated';
    SELECT to_jsonb(v.*) INTO prev FROM public.vehicles v WHERE id = _id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'vehicle not found'; END IF;
    UPDATE public.vehicles SET
      name                 = _payload->>'name',
      category             = COALESCE(_payload->>'category','other')::public.vehicle_category,
      license_plate        = _payload->>'license_plate',
      vin                  = _payload->>'vin',
      model_year           = NULLIF(_payload->>'model_year','')::int,
      seats                = COALESCE((_payload->>'seats')::int, seats),
      status               = COALESCE(_payload->>'status','active')::public.vehicle_status,
      insurance_expires_at = NULLIF(_payload->>'insurance_expires_at','')::date,
      updated_at           = now()
    WHERE id = _id RETURNING * INTO new_row;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'vehicle', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(v.*) INTO prev FROM public.vehicles v WHERE id = _id;
  IF prev IS NULL THEN RAISE EXCEPTION 'vehicle not found'; END IF;
  DELETE FROM public.vehicles WHERE id = _id;
  PERFORM public._audit_write(auth.uid(),'vehicle.deleted','vehicle',_id,prev,NULL,_reason);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_resolve_incident(_id uuid, _status text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('reviewing','resolved','dismissed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT to_jsonb(i.*) INTO prev FROM public.incidents i WHERE id = _id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'incident not found'; END IF;
  UPDATE public.incidents SET
    status = _status,
    admin_notes = COALESCE(_notes, admin_notes),
    resolved_by = CASE WHEN _status IN ('resolved','dismissed') THEN auth.uid() ELSE resolved_by END,
    resolved_at = CASE WHEN _status IN ('resolved','dismissed') THEN now() ELSE resolved_at END,
    updated_at = now()
  WHERE id = _id RETURNING to_jsonb(incidents.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'incident.resolve','incident',_id,prev,nxt,_notes);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_review_no_show(_id uuid, _status text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT to_jsonb(n.*) INTO prev FROM public.no_show_reports n WHERE id = _id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'no_show not found'; END IF;
  UPDATE public.no_show_reports SET
    admin_status = _status,
    admin_notes = COALESCE(_notes, admin_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  WHERE id = _id RETURNING to_jsonb(no_show_reports.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'no_show.review','no_show_report',_id,prev,nxt,_notes);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_discount(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.discount_rules%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _id IS NULL THEN
    action_label := 'discount.created';
    INSERT INTO public.discount_rules (min_miles, max_miles, flat_off, percent_off, active)
    VALUES (
      COALESCE((_payload->>'min_miles')::numeric, 0),
      COALESCE((_payload->>'max_miles')::numeric, 25),
      COALESCE((_payload->>'flat_off')::numeric, 10),
      COALESCE((_payload->>'percent_off')::numeric, 5),
      COALESCE((_payload->>'active')::boolean, true)
    ) RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'discount.updated';
    SELECT to_jsonb(d.*) INTO prev FROM public.discount_rules d WHERE id = _id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'discount not found'; END IF;
    UPDATE public.discount_rules SET
      min_miles   = COALESCE((_payload->>'min_miles')::numeric, min_miles),
      max_miles   = COALESCE((_payload->>'max_miles')::numeric, max_miles),
      flat_off    = COALESCE((_payload->>'flat_off')::numeric, flat_off),
      percent_off = COALESCE((_payload->>'percent_off')::numeric, percent_off),
      active      = COALESCE((_payload->>'active')::boolean, active)
    WHERE id = _id RETURNING * INTO new_row;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'discount_rule', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_discount(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(d.*) INTO prev FROM public.discount_rules d WHERE id = _id;
  IF prev IS NULL THEN RAISE EXCEPTION 'discount not found'; END IF;
  DELETE FROM public.discount_rules WHERE id = _id;
  PERFORM public._audit_write(auth.uid(),'discount.deleted','discount_rule',_id,prev,NULL,NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_campaign(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.referral_campaigns%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_payload->>'name','') = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF _id IS NULL THEN
    action_label := 'campaign.created';
    INSERT INTO public.referral_campaigns (
      name, description, reward_percent, reward_flat_amount, reward_validity_days,
      per_referrer_limit, starts_at, ends_at, active
    ) VALUES (
      _payload->>'name', _payload->>'description',
      COALESCE((_payload->>'reward_percent')::numeric, 10),
      NULLIF(_payload->>'reward_flat_amount','')::numeric,
      COALESCE((_payload->>'reward_validity_days')::int, 90),
      NULLIF(_payload->>'per_referrer_limit','')::int,
      COALESCE(NULLIF(_payload->>'starts_at','')::timestamptz, now()),
      NULLIF(_payload->>'ends_at','')::timestamptz,
      COALESCE((_payload->>'active')::boolean, true)
    ) RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'campaign.updated';
    SELECT to_jsonb(c.*) INTO prev FROM public.referral_campaigns c WHERE id = _id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
    UPDATE public.referral_campaigns SET
      name                 = _payload->>'name',
      description          = _payload->>'description',
      reward_percent       = COALESCE((_payload->>'reward_percent')::numeric, reward_percent),
      reward_flat_amount   = NULLIF(_payload->>'reward_flat_amount','')::numeric,
      reward_validity_days = COALESCE((_payload->>'reward_validity_days')::int, reward_validity_days),
      per_referrer_limit   = NULLIF(_payload->>'per_referrer_limit','')::int,
      starts_at            = COALESCE(NULLIF(_payload->>'starts_at','')::timestamptz, starts_at),
      ends_at              = NULLIF(_payload->>'ends_at','')::timestamptz,
      active               = COALESCE((_payload->>'active')::boolean, active)
    WHERE id = _id RETURNING * INTO new_row;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'referral_campaign', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_toggle_campaign(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.referral_campaigns c WHERE id = _id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  UPDATE public.referral_campaigns SET active = NOT active WHERE id = _id
    RETURNING to_jsonb(referral_campaigns.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'campaign.toggled','referral_campaign',_id,prev,nxt,NULL);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_campaign(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.referral_campaigns c WHERE id = _id;
  IF prev IS NULL THEN RAISE EXCEPTION 'campaign not found'; END IF;
  DELETE FROM public.referral_campaigns WHERE id = _id;
  PERFORM public._audit_write(auth.uid(),'campaign.deleted','referral_campaign',_id,prev,NULL,NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_nfc_tag(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.nfc_tags%ROWTYPE; action_label text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_payload->>'tag_uid','') = '' OR COALESCE(_payload->>'code_id','') = '' THEN
    RAISE EXCEPTION 'tag_uid and code_id required';
  END IF;
  IF _id IS NULL THEN
    action_label := 'nfc_tag.created';
    INSERT INTO public.nfc_tags (tag_uid, code_id, label, active)
    VALUES (_payload->>'tag_uid', (_payload->>'code_id')::uuid, _payload->>'label',
            COALESCE((_payload->>'active')::boolean, true))
    RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'nfc_tag.updated';
    SELECT to_jsonb(t.*) INTO prev FROM public.nfc_tags t WHERE id = _id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'tag not found'; END IF;
    UPDATE public.nfc_tags SET
      tag_uid = _payload->>'tag_uid',
      code_id = (_payload->>'code_id')::uuid,
      label   = _payload->>'label',
      active  = COALESCE((_payload->>'active')::boolean, active)
    WHERE id = _id RETURNING * INTO new_row;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'nfc_tag', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_nfc_tag(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(t.*) INTO prev FROM public.nfc_tags t WHERE id = _id;
  IF prev IS NULL THEN RAISE EXCEPTION 'tag not found'; END IF;
  DELETE FROM public.nfc_tags WHERE id = _id;
  PERFORM public._audit_write(auth.uid(),'nfc_tag.deleted','nfc_tag',_id,prev,NULL,NULL);
END; $$;

-- ===== Permission matrix — lock down every SECURITY DEFINER function =====
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.has_role(uuid, public.app_role),
  public.advance_assignment(uuid, text, text),
  public.create_booking(text, text, timestamptz, integer, text),
  public.get_my_booking_pin(uuid),
  public.verify_booking_pin(uuid, text),
  public.driver_owns_booking(uuid),
  public.passenger_owns_booking(uuid),
  public.admin_audit_log(text, text, uuid, jsonb, jsonb, text),
  public.admin_dispatch_kpis(),
  public.admin_dispatch_overview(),
  public.admin_fleet_expirations(),
  public.admin_fleet_compliance_alerts(integer),
  public.admin_referral_kpis(),
  public.admin_incident_feed(integer),
  public.admin_set_booking_status(uuid, text, text),
  public.admin_set_driver_availability(uuid, text, text),
  public.admin_assign_driver(uuid, uuid, uuid, text),
  public.admin_remove_assignment(uuid, text),
  public.admin_upsert_driver(uuid, jsonb),
  public.admin_delete_driver(uuid, text),
  public.admin_upsert_vehicle(uuid, jsonb),
  public.admin_delete_vehicle(uuid, text),
  public.admin_resolve_incident(uuid, text, text),
  public.admin_review_no_show(uuid, text, text),
  public.admin_upsert_discount(uuid, jsonb),
  public.admin_delete_discount(uuid),
  public.admin_upsert_campaign(uuid, jsonb),
  public.admin_toggle_campaign(uuid),
  public.admin_delete_campaign(uuid),
  public.admin_upsert_nfc_tag(uuid, jsonb),
  public.admin_delete_nfc_tag(uuid)
TO authenticated;

-- ===== Dispatch state-machine test harness =====
CREATE OR REPLACE FUNCTION public.test_dispatch_state_machine()
RETURNS TABLE(t_name text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  passenger_uid uuid := gen_random_uuid();
  driver_user_uid uuid := gen_random_uuid();
  drv_id uuid; veh_id uuid;
  booking_id uuid; assignment_id uuid;
  err text; ok boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  BEGIN
    INSERT INTO public.profiles(id,email,name) VALUES
      (passenger_uid,'test-pax@example.com','Test Passenger'),
      (driver_user_uid,'test-drv@example.com','Test Driver');
    INSERT INTO public.user_roles(user_id,role) VALUES
      (passenger_uid,'passenger'), (driver_user_uid,'driver');
    INSERT INTO public.vehicles(name,category,license_plate,status,seats)
      VALUES ('TEST SUV','other','TEST-1','active',6) RETURNING id INTO veh_id;
    INSERT INTO public.driver_profiles(user_id,full_name,employee_id,employment_status,availability_status)
      VALUES (driver_user_uid,'Test Driver','TEST-D-1','active','available') RETURNING id INTO drv_id;
    INSERT INTO public.bookings(passenger_id,pickup,dropoff,pickup_time,passengers,ride_type,suggested_price,status)
      VALUES (passenger_uid,'A','B',now()+interval '1 hour',2,'escalade',150,'requested')
      RETURNING id INTO booking_id;

    assignment_id := (SELECT (public.admin_assign_driver(booking_id,drv_id,veh_id,'test')->>'id')::uuid);
    t_name:='admin_assign_driver creates assignment'; passed:=assignment_id IS NOT NULL; detail:=NULL; RETURN NEXT;
    t_name:='admin_assign_driver writes audit';
      passed:=EXISTS(SELECT 1 FROM public.audit_log WHERE entity_id=assignment_id AND action='assignment.created');
      detail:=NULL; RETURN NEXT;

    PERFORM public.advance_assignment(assignment_id,'accepted');
    t_name:='assigned -> accepted'; passed:=true; detail:=NULL; RETURN NEXT;
    PERFORM public.advance_assignment(assignment_id,'en_route');
    t_name:='accepted -> en_route'; passed:=true; detail:=NULL; RETURN NEXT;
    PERFORM public.advance_assignment(assignment_id,'arrived');
    t_name:='en_route -> arrived'; passed:=true; detail:=NULL; RETURN NEXT;

    BEGIN PERFORM public.advance_assignment(assignment_id,'in_progress');
      t_name:='arrived -> in_progress rejected without verification'; passed:=false; detail:='unexpected success';
    EXCEPTION WHEN OTHERS THEN
      t_name:='arrived -> in_progress rejected without verification'; passed:=true; detail:=SQLERRM;
    END; RETURN NEXT;

    INSERT INTO public.passenger_verifications(booking_id,method,verified_by_driver_id,evidence)
      VALUES (booking_id,'pin',drv_id,'{}'::jsonb);
    PERFORM public.advance_assignment(assignment_id,'in_progress');
    t_name:='arrived -> in_progress allowed after verification'; passed:=true; detail:=NULL; RETURN NEXT;

    PERFORM public.advance_assignment(assignment_id,'completed');
    t_name:='in_progress -> completed'; passed:=true; detail:=NULL; RETURN NEXT;
    ok := EXISTS(SELECT 1 FROM public.bookings WHERE id=booking_id AND status='completed');
    t_name:='bookings.status synced to completed'; passed:=ok; detail:=NULL; RETURN NEXT;

    BEGIN PERFORM public.advance_assignment(assignment_id,'en_route');
      t_name:='completed -> en_route rejected'; passed:=false; detail:='unexpected success';
    EXCEPTION WHEN OTHERS THEN
      t_name:='completed -> en_route rejected'; passed:=true; detail:=SQLERRM;
    END; RETURN NEXT;

    -- fresh assignment for skip-invalid checks
    INSERT INTO public.bookings(passenger_id,pickup,dropoff,pickup_time,passengers,ride_type,suggested_price,status)
      VALUES (passenger_uid,'A','B',now()+interval '2 hour',1,'escalade',150,'requested')
      RETURNING id INTO booking_id;
    assignment_id := (SELECT (public.admin_assign_driver(booking_id,drv_id,veh_id,'t2')->>'id')::uuid);
    BEGIN PERFORM public.advance_assignment(assignment_id,'in_progress');
      t_name:='assigned -> in_progress rejected'; passed:=false; detail:='unexpected success';
    EXCEPTION WHEN OTHERS THEN
      t_name:='assigned -> in_progress rejected'; passed:=true; detail:=SQLERRM;
    END; RETURN NEXT;
    BEGIN PERFORM public.advance_assignment(assignment_id,'completed');
      t_name:='assigned -> completed rejected'; passed:=false; detail:='unexpected success';
    EXCEPTION WHEN OTHERS THEN
      t_name:='assigned -> completed rejected'; passed:=true; detail:=SQLERRM;
    END; RETURN NEXT;
    ok := (SELECT dispatch_status::text FROM public.booking_assignments WHERE id=assignment_id) = 'assigned';
    t_name:='rejected transitions do not partially update'; passed:=ok; detail:=NULL; RETURN NEXT;

    -- failed admin mutation writes no audit row
    err := NULL;
    BEGIN PERFORM public.admin_set_booking_status(booking_id,'bogus_status','t');
    EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
    ok := err IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.audit_log WHERE entity_id=booking_id
        AND action='booking.status_changed' AND (next->>'status')='bogus_status');
    t_name:='failed admin mutation does not write audit'; passed:=ok; detail:=err; RETURN NEXT;

    -- Stripe idempotency
    INSERT INTO public.stripe_events(event_id) VALUES ('evt_test_i_b_1');
    BEGIN INSERT INTO public.stripe_events(event_id) VALUES ('evt_test_i_b_1');
      t_name:='stripe_events unique(event_id)'; passed:=false; detail:='duplicate allowed';
    EXCEPTION WHEN unique_violation THEN
      t_name:='stripe_events unique(event_id)'; passed:=true; detail:=NULL;
    END; RETURN NEXT;

    -- GPS route sequence idempotency
    INSERT INTO public.trip_route_points(booking_id,driver_id,seq,lat,lng,recorded_at)
      VALUES (booking_id,drv_id,1,40.7,-74.0,now());
    BEGIN
      INSERT INTO public.trip_route_points(booking_id,driver_id,seq,lat,lng,recorded_at)
        VALUES (booking_id,drv_id,1,40.7,-74.0,now());
      t_name:='trip_route_points seq idempotent';
      passed:=EXISTS(SELECT 1 FROM pg_indexes WHERE tablename='trip_route_points'
        AND (indexdef ILIKE '%UNIQUE%booking_id%seq%' OR indexdef ILIKE '%UNIQUE%seq%booking_id%'));
      detail:=CASE WHEN passed THEN NULL ELSE 'no unique(booking_id,seq)' END;
    EXCEPTION WHEN unique_violation THEN
      t_name:='trip_route_points seq idempotent'; passed:=true; detail:=NULL;
    END; RETURN NEXT;

    RAISE EXCEPTION 'ROLLBACK_TEST_RUN';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_RUN' THEN
      t_name:='HARNESS EXCEPTION'; passed:=false; detail:=SQLERRM; RETURN NEXT;
    END IF;
  END;
  RETURN;
END; $$;

REVOKE ALL ON FUNCTION public.test_dispatch_state_machine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_dispatch_state_machine() TO authenticated;
