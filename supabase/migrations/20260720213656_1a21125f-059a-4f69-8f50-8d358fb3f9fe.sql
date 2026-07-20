DO $$
DECLARE
  target_id uuid := '72a1bb91-cc1e-482a-861d-10d16f2e0566';
  target_email text := 'quentincicek@gmail.com';
  match_count int;
BEGIN
  SELECT count(*) INTO match_count
    FROM auth.users
    WHERE id = target_id AND lower(email) = lower(target_email);
  IF match_count <> 1 THEN
    RAISE EXCEPTION 'bootstrap aborted: expected exactly 1 matching auth user, found %', match_count;
  END IF;

  SELECT count(*) INTO match_count FROM auth.users;
  IF match_count <> 1 THEN
    RAISE EXCEPTION 'bootstrap aborted: expected exactly 1 auth user total, found %', match_count;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_id, 'admin');

  INSERT INTO public.audit_log (actor_id, actor_email, action, entity_type, entity_id, previous, next, reason)
  VALUES (target_id, target_email, 'user.bootstrap_admin', 'user', target_id, NULL,
          jsonb_build_object('email', target_email, 'role', 'admin'),
          'One-time bootstrap: promoted sole existing test account to first administrator.');
END $$;