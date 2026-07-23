
-- =====================================================================
-- Batch 1: Versioned Booking Policies (Cancellation + No-Show)
-- Append-only versioning. Admin-only mutations via SECURITY DEFINER RPCs.
-- No runtime coupling to bookings/payments/driver flows in this batch.
-- =====================================================================

-- ---------- Tables ----------
CREATE TABLE public.cancellation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  version int NOT NULL,
  name text NOT NULL,
  service_type text NOT NULL DEFAULT 'standard',
  free_cancellation_enabled boolean NOT NULL DEFAULT true,
  free_cancellation_cutoff_hours int NOT NULL DEFAULT 24,
  late_cancellation_enabled boolean NOT NULL DEFAULT true,
  fee_type text NOT NULL,
  fee_fixed_cents int,
  fee_percent_bps int,
  fee_cap_cents int,
  allow_cancellation_inside_cutoff boolean NOT NULL DEFAULT true,
  admin_review_required boolean NOT NULL DEFAULT true,
  customer_summary text NOT NULL,
  internal_notes text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT cancellation_policies_version_unique UNIQUE (policy_key, version),
  CONSTRAINT cancellation_policies_service_type_chk
    CHECK (service_type IN ('standard','airport')),
  CONSTRAINT cancellation_policies_fee_type_chk
    CHECK (fee_type IN ('fixed','percentage','full_fare','none')),
  CONSTRAINT cancellation_policies_cutoff_nonneg CHECK (free_cancellation_cutoff_hours >= 0),
  CONSTRAINT cancellation_policies_fixed_nonneg  CHECK (fee_fixed_cents IS NULL OR fee_fixed_cents >= 0),
  CONSTRAINT cancellation_policies_pct_range     CHECK (fee_percent_bps IS NULL OR (fee_percent_bps >= 0 AND fee_percent_bps <= 10000)),
  CONSTRAINT cancellation_policies_cap_nonneg    CHECK (fee_cap_cents IS NULL OR fee_cap_cents >= 0),
  CONSTRAINT cancellation_policies_summary_len   CHECK (length(btrim(customer_summary)) > 0),
  CONSTRAINT cancellation_policies_expiry_order  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CONSTRAINT cancellation_policies_fee_shape CHECK (
    (fee_type = 'fixed'      AND fee_fixed_cents IS NOT NULL AND fee_percent_bps IS NULL) OR
    (fee_type = 'percentage' AND fee_percent_bps IS NOT NULL AND fee_fixed_cents IS NULL) OR
    (fee_type IN ('full_fare','none') AND fee_fixed_cents IS NULL AND fee_percent_bps IS NULL)
  ),
  CONSTRAINT cancellation_policies_none_no_cap CHECK (
    fee_type <> 'none' OR fee_cap_cents IS NULL
  )
);

CREATE UNIQUE INDEX cancellation_policies_active_uniq
  ON public.cancellation_policies (policy_key, service_type)
  WHERE active;
CREATE INDEX cancellation_policies_lookup_idx
  ON public.cancellation_policies (service_type, active, effective_at DESC);

CREATE TABLE public.no_show_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  version int NOT NULL,
  name text NOT NULL,
  service_type text NOT NULL,
  no_show_enabled boolean NOT NULL DEFAULT true,
  min_wait_seconds int NOT NULL,
  required_contact_attempts int NOT NULL DEFAULT 1,
  fee_type text NOT NULL,
  fee_fixed_cents int,
  fee_percent_bps int,
  fee_cap_cents int,
  automatic_charge_enabled boolean NOT NULL DEFAULT false,
  admin_review_required boolean NOT NULL DEFAULT true,
  customer_summary text NOT NULL,
  internal_notes text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT no_show_policies_version_unique UNIQUE (policy_key, version),
  CONSTRAINT no_show_policies_service_type_chk
    CHECK (service_type IN ('standard','airport')),
  CONSTRAINT no_show_policies_fee_type_chk
    CHECK (fee_type IN ('fixed','percentage','full_fare','none')),
  CONSTRAINT no_show_policies_wait_nonneg     CHECK (min_wait_seconds >= 0),
  CONSTRAINT no_show_policies_attempts_nonneg CHECK (required_contact_attempts >= 0),
  CONSTRAINT no_show_policies_fixed_nonneg    CHECK (fee_fixed_cents IS NULL OR fee_fixed_cents >= 0),
  CONSTRAINT no_show_policies_pct_range       CHECK (fee_percent_bps IS NULL OR (fee_percent_bps >= 0 AND fee_percent_bps <= 10000)),
  CONSTRAINT no_show_policies_cap_nonneg      CHECK (fee_cap_cents IS NULL OR fee_cap_cents >= 0),
  CONSTRAINT no_show_policies_summary_len     CHECK (length(btrim(customer_summary)) > 0),
  CONSTRAINT no_show_policies_expiry_order    CHECK (expires_at IS NULL OR expires_at > effective_at),
  CONSTRAINT no_show_policies_fee_shape CHECK (
    (fee_type = 'fixed'      AND fee_fixed_cents IS NOT NULL AND fee_percent_bps IS NULL) OR
    (fee_type = 'percentage' AND fee_percent_bps IS NOT NULL AND fee_fixed_cents IS NULL) OR
    (fee_type IN ('full_fare','none') AND fee_fixed_cents IS NULL AND fee_percent_bps IS NULL)
  ),
  CONSTRAINT no_show_policies_none_no_cap CHECK (
    fee_type <> 'none' OR fee_cap_cents IS NULL
  )
);

CREATE UNIQUE INDEX no_show_policies_active_uniq
  ON public.no_show_policies (policy_key, service_type)
  WHERE active;
CREATE INDEX no_show_policies_lookup_idx
  ON public.no_show_policies (service_type, active, effective_at DESC);

-- ---------- GRANTs ----------
-- Full-row SELECT restricted via RLS to admins; DML routed through DEFINER RPCs only.
GRANT SELECT ON public.cancellation_policies TO authenticated;
GRANT SELECT ON public.no_show_policies      TO authenticated;
GRANT ALL    ON public.cancellation_policies TO service_role;
GRANT ALL    ON public.no_show_policies      TO service_role;
-- No anon grants. No INSERT/UPDATE/DELETE to authenticated (all writes DEFINER-only).

-- ---------- RLS ----------
ALTER TABLE public.cancellation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.no_show_policies      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read all cancellation policies"
  ON public.cancellation_policies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can read all no-show policies"
  ON public.no_show_policies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Deliberately no INSERT/UPDATE/DELETE policies — everything flows through RPCs.

-- ---------- Customer-safe views (used by future batches) ----------
CREATE OR REPLACE VIEW public.v_active_cancellation_policy
WITH (security_invoker = true)
AS
SELECT id, policy_key, version, name, service_type,
       free_cancellation_enabled, free_cancellation_cutoff_hours,
       late_cancellation_enabled, fee_type, fee_fixed_cents, fee_percent_bps,
       fee_cap_cents, allow_cancellation_inside_cutoff, admin_review_required,
       customer_summary, effective_at, expires_at
FROM public.cancellation_policies
WHERE active
  AND effective_at <= now()
  AND (expires_at IS NULL OR expires_at > now());

CREATE OR REPLACE VIEW public.v_active_no_show_policy
WITH (security_invoker = true)
AS
SELECT id, policy_key, version, name, service_type,
       no_show_enabled, min_wait_seconds, required_contact_attempts,
       fee_type, fee_fixed_cents, fee_percent_bps, fee_cap_cents,
       automatic_charge_enabled, admin_review_required,
       customer_summary, effective_at, expires_at
FROM public.no_show_policies
WHERE active
  AND effective_at <= now()
  AND (expires_at IS NULL OR expires_at > now());

-- Views inherit permissions from base tables via security_invoker; base tables
-- are admin-only under RLS, so today only admins can read these views. Future
-- batches will add narrow policies enabling passenger reads of these views.

-- =====================================================================
-- RPCs (SECURITY DEFINER; explicit search_path; has_role(admin); audit)
-- =====================================================================

-- Shared payload validator (raises on invalid combinations)
CREATE OR REPLACE FUNCTION public._validate_cancellation_payload(_payload jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE ft text;
BEGIN
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN RAISE EXCEPTION 'invalid payload'; END IF;
  IF COALESCE(_payload->>'name','') = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF COALESCE(btrim(_payload->>'customer_summary'),'') = '' THEN RAISE EXCEPTION 'customer_summary required'; END IF;
  IF (_payload->>'service_type') IS NOT NULL AND (_payload->>'service_type') NOT IN ('standard','airport') THEN
    RAISE EXCEPTION 'invalid service_type';
  END IF;
  ft := _payload->>'fee_type';
  IF ft NOT IN ('fixed','percentage','full_fare','none') THEN RAISE EXCEPTION 'invalid fee_type'; END IF;
  IF (_payload->>'free_cancellation_cutoff_hours') IS NOT NULL AND (_payload->>'free_cancellation_cutoff_hours')::int < 0 THEN
    RAISE EXCEPTION 'cutoff hours must be non-negative';
  END IF;
  IF ft = 'fixed' THEN
    IF (_payload->>'fee_fixed_cents') IS NULL OR (_payload->>'fee_fixed_cents')::int < 0 THEN
      RAISE EXCEPTION 'fixed fee requires non-negative fee_fixed_cents';
    END IF;
    IF (_payload->>'fee_percent_bps') IS NOT NULL THEN RAISE EXCEPTION 'fee_percent_bps not allowed for fixed'; END IF;
  ELSIF ft = 'percentage' THEN
    IF (_payload->>'fee_percent_bps') IS NULL OR (_payload->>'fee_percent_bps')::int < 0 OR (_payload->>'fee_percent_bps')::int > 10000 THEN
      RAISE EXCEPTION 'percentage fee requires fee_percent_bps in 0..10000';
    END IF;
    IF (_payload->>'fee_fixed_cents') IS NOT NULL THEN RAISE EXCEPTION 'fee_fixed_cents not allowed for percentage'; END IF;
  ELSE
    IF (_payload->>'fee_fixed_cents') IS NOT NULL OR (_payload->>'fee_percent_bps') IS NOT NULL THEN
      RAISE EXCEPTION 'fee values not allowed for %', ft;
    END IF;
  END IF;
  IF (_payload->>'fee_cap_cents') IS NOT NULL THEN
    IF (_payload->>'fee_cap_cents')::int < 0 THEN RAISE EXCEPTION 'fee_cap_cents must be non-negative'; END IF;
    IF ft = 'none' THEN RAISE EXCEPTION 'fee_cap_cents not allowed when fee_type=none'; END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public._validate_no_show_payload(_payload jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE ft text;
BEGIN
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN RAISE EXCEPTION 'invalid payload'; END IF;
  IF COALESCE(_payload->>'name','') = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF COALESCE(btrim(_payload->>'customer_summary'),'') = '' THEN RAISE EXCEPTION 'customer_summary required'; END IF;
  IF (_payload->>'service_type') NOT IN ('standard','airport') THEN RAISE EXCEPTION 'invalid service_type'; END IF;
  IF (_payload->>'min_wait_seconds') IS NULL OR (_payload->>'min_wait_seconds')::int < 0 THEN
    RAISE EXCEPTION 'min_wait_seconds must be non-negative';
  END IF;
  IF (_payload->>'required_contact_attempts') IS NOT NULL AND (_payload->>'required_contact_attempts')::int < 0 THEN
    RAISE EXCEPTION 'required_contact_attempts must be non-negative';
  END IF;
  ft := _payload->>'fee_type';
  IF ft NOT IN ('fixed','percentage','full_fare','none') THEN RAISE EXCEPTION 'invalid fee_type'; END IF;
  IF ft = 'fixed' THEN
    IF (_payload->>'fee_fixed_cents') IS NULL OR (_payload->>'fee_fixed_cents')::int < 0 THEN
      RAISE EXCEPTION 'fixed fee requires non-negative fee_fixed_cents';
    END IF;
    IF (_payload->>'fee_percent_bps') IS NOT NULL THEN RAISE EXCEPTION 'fee_percent_bps not allowed for fixed'; END IF;
  ELSIF ft = 'percentage' THEN
    IF (_payload->>'fee_percent_bps') IS NULL OR (_payload->>'fee_percent_bps')::int < 0 OR (_payload->>'fee_percent_bps')::int > 10000 THEN
      RAISE EXCEPTION 'percentage fee requires fee_percent_bps in 0..10000';
    END IF;
    IF (_payload->>'fee_fixed_cents') IS NOT NULL THEN RAISE EXCEPTION 'fee_fixed_cents not allowed for percentage'; END IF;
  ELSE
    IF (_payload->>'fee_fixed_cents') IS NOT NULL OR (_payload->>'fee_percent_bps') IS NOT NULL THEN
      RAISE EXCEPTION 'fee values not allowed for %', ft;
    END IF;
  END IF;
  IF (_payload->>'fee_cap_cents') IS NOT NULL THEN
    IF (_payload->>'fee_cap_cents')::int < 0 THEN RAISE EXCEPTION 'fee_cap_cents must be non-negative'; END IF;
    IF ft = 'none' THEN RAISE EXCEPTION 'fee_cap_cents not allowed when fee_type=none'; END IF;
  END IF;
END; $$;

-- ---------- Cancellation policy RPCs ----------
CREATE OR REPLACE FUNCTION public.admin_create_cancellation_policy(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_row public.cancellation_policies%ROWTYPE; pkey text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._validate_cancellation_payload(_payload);
  pkey := btrim(COALESCE(_payload->>'policy_key',''));
  IF pkey = '' THEN RAISE EXCEPTION 'policy_key required'; END IF;
  IF EXISTS (SELECT 1 FROM public.cancellation_policies WHERE policy_key = pkey) THEN
    RAISE EXCEPTION 'policy_key already exists — use create_version instead';
  END IF;
  INSERT INTO public.cancellation_policies (
    policy_key, version, name, service_type,
    free_cancellation_enabled, free_cancellation_cutoff_hours,
    late_cancellation_enabled, fee_type, fee_fixed_cents, fee_percent_bps, fee_cap_cents,
    allow_cancellation_inside_cutoff, admin_review_required,
    customer_summary, internal_notes, effective_at, expires_at, active, created_by
  ) VALUES (
    pkey, 1, _payload->>'name',
    COALESCE(_payload->>'service_type','standard'),
    COALESCE((_payload->>'free_cancellation_enabled')::boolean, true),
    COALESCE((_payload->>'free_cancellation_cutoff_hours')::int, 24),
    COALESCE((_payload->>'late_cancellation_enabled')::boolean, true),
    _payload->>'fee_type',
    NULLIF(_payload->>'fee_fixed_cents','')::int,
    NULLIF(_payload->>'fee_percent_bps','')::int,
    NULLIF(_payload->>'fee_cap_cents','')::int,
    COALESCE((_payload->>'allow_cancellation_inside_cutoff')::boolean, true),
    COALESCE((_payload->>'admin_review_required')::boolean, true),
    _payload->>'customer_summary',
    NULLIF(_payload->>'internal_notes',''),
    COALESCE(NULLIF(_payload->>'effective_at','')::timestamptz, now()),
    NULLIF(_payload->>'expires_at','')::timestamptz,
    false,
    auth.uid()
  ) RETURNING * INTO new_row;
  PERFORM public._audit_write(auth.uid(),'policy.cancellation.created','cancellation_policy',new_row.id,NULL,to_jsonb(new_row),NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_cancellation_policy_version(_policy_key text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_version int; new_row public.cancellation_policies%ROWTYPE; lock_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._validate_cancellation_payload(_payload);
  -- Serialize version allocation for this policy_key.
  SELECT id INTO lock_id FROM public.cancellation_policies
   WHERE policy_key = _policy_key ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF lock_id IS NULL THEN RAISE EXCEPTION 'policy_key not found'; END IF;
  SELECT COALESCE(MAX(version),0) + 1 INTO next_version
    FROM public.cancellation_policies WHERE policy_key = _policy_key;
  INSERT INTO public.cancellation_policies (
    policy_key, version, name, service_type,
    free_cancellation_enabled, free_cancellation_cutoff_hours,
    late_cancellation_enabled, fee_type, fee_fixed_cents, fee_percent_bps, fee_cap_cents,
    allow_cancellation_inside_cutoff, admin_review_required,
    customer_summary, internal_notes, effective_at, expires_at, active, created_by
  ) VALUES (
    _policy_key, next_version, _payload->>'name',
    COALESCE(_payload->>'service_type','standard'),
    COALESCE((_payload->>'free_cancellation_enabled')::boolean, true),
    COALESCE((_payload->>'free_cancellation_cutoff_hours')::int, 24),
    COALESCE((_payload->>'late_cancellation_enabled')::boolean, true),
    _payload->>'fee_type',
    NULLIF(_payload->>'fee_fixed_cents','')::int,
    NULLIF(_payload->>'fee_percent_bps','')::int,
    NULLIF(_payload->>'fee_cap_cents','')::int,
    COALESCE((_payload->>'allow_cancellation_inside_cutoff')::boolean, true),
    COALESCE((_payload->>'admin_review_required')::boolean, true),
    _payload->>'customer_summary',
    NULLIF(_payload->>'internal_notes',''),
    COALESCE(NULLIF(_payload->>'effective_at','')::timestamptz, now()),
    NULLIF(_payload->>'expires_at','')::timestamptz,
    false,
    auth.uid()
  ) RETURNING * INTO new_row;
  PERFORM public._audit_write(auth.uid(),'policy.cancellation.version_created','cancellation_policy',new_row.id,NULL,to_jsonb(new_row),NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_activate_cancellation_policy(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.cancellation_policies%ROWTYPE;
        prev jsonb; nxt jsonb; deactivated_prev jsonb; deactivated_next jsonb; existing_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO target FROM public.cancellation_policies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy not found'; END IF;
  IF target.active THEN RETURN to_jsonb(target); END IF;
  -- Deactivate any currently-active row for the same (policy_key, service_type)
  SELECT id INTO existing_id FROM public.cancellation_policies
    WHERE policy_key = target.policy_key AND service_type = target.service_type AND active
    FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    SELECT to_jsonb(c.*) INTO deactivated_prev FROM public.cancellation_policies c WHERE id = existing_id;
    UPDATE public.cancellation_policies SET active = false WHERE id = existing_id
      RETURNING to_jsonb(cancellation_policies.*) INTO deactivated_next;
    PERFORM public._audit_write(auth.uid(),'policy.cancellation.deactivated','cancellation_policy',existing_id,deactivated_prev,deactivated_next,_reason);
  END IF;
  prev := to_jsonb(target);
  UPDATE public.cancellation_policies SET active = true WHERE id = _id
    RETURNING to_jsonb(cancellation_policies.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'policy.cancellation.activated','cancellation_policy',_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_cancellation_policy(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.cancellation_policies c WHERE id = _id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'policy not found'; END IF;
  IF NOT (prev->>'active')::boolean THEN RETURN prev; END IF;
  UPDATE public.cancellation_policies SET active = false WHERE id = _id
    RETURNING to_jsonb(cancellation_policies.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'policy.cancellation.deactivated','cancellation_policy',_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_cancellation_policies()
RETURNS SETOF public.cancellation_policies
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.cancellation_policies ORDER BY policy_key, service_type, version DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_cancellation_policy(_service_type text, _at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF _service_type NOT IN ('standard','airport') THEN RAISE EXCEPTION 'invalid service_type'; END IF;
  SELECT jsonb_build_object(
    'id', id, 'policy_key', policy_key, 'version', version, 'name', name, 'service_type', service_type,
    'free_cancellation_enabled', free_cancellation_enabled,
    'free_cancellation_cutoff_hours', free_cancellation_cutoff_hours,
    'late_cancellation_enabled', late_cancellation_enabled,
    'fee_type', fee_type, 'fee_fixed_cents', fee_fixed_cents,
    'fee_percent_bps', fee_percent_bps, 'fee_cap_cents', fee_cap_cents,
    'allow_cancellation_inside_cutoff', allow_cancellation_inside_cutoff,
    'admin_review_required', admin_review_required,
    'customer_summary', customer_summary,
    'effective_at', effective_at, 'expires_at', expires_at
  ) INTO result
  FROM public.cancellation_policies
  WHERE active AND service_type = _service_type
    AND effective_at <= _at
    AND (expires_at IS NULL OR expires_at > _at)
  ORDER BY effective_at DESC, version DESC LIMIT 1;
  RETURN result;
END; $$;

-- ---------- No-show policy RPCs ----------
CREATE OR REPLACE FUNCTION public.admin_create_no_show_policy(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_row public.no_show_policies%ROWTYPE; pkey text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._validate_no_show_payload(_payload);
  pkey := btrim(COALESCE(_payload->>'policy_key',''));
  IF pkey = '' THEN RAISE EXCEPTION 'policy_key required'; END IF;
  IF EXISTS (SELECT 1 FROM public.no_show_policies WHERE policy_key = pkey) THEN
    RAISE EXCEPTION 'policy_key already exists — use create_version instead';
  END IF;
  INSERT INTO public.no_show_policies (
    policy_key, version, name, service_type,
    no_show_enabled, min_wait_seconds, required_contact_attempts,
    fee_type, fee_fixed_cents, fee_percent_bps, fee_cap_cents,
    automatic_charge_enabled, admin_review_required,
    customer_summary, internal_notes, effective_at, expires_at, active, created_by
  ) VALUES (
    pkey, 1, _payload->>'name', _payload->>'service_type',
    COALESCE((_payload->>'no_show_enabled')::boolean, true),
    (_payload->>'min_wait_seconds')::int,
    COALESCE((_payload->>'required_contact_attempts')::int, 1),
    _payload->>'fee_type',
    NULLIF(_payload->>'fee_fixed_cents','')::int,
    NULLIF(_payload->>'fee_percent_bps','')::int,
    NULLIF(_payload->>'fee_cap_cents','')::int,
    COALESCE((_payload->>'automatic_charge_enabled')::boolean, false),
    COALESCE((_payload->>'admin_review_required')::boolean, true),
    _payload->>'customer_summary',
    NULLIF(_payload->>'internal_notes',''),
    COALESCE(NULLIF(_payload->>'effective_at','')::timestamptz, now()),
    NULLIF(_payload->>'expires_at','')::timestamptz,
    false,
    auth.uid()
  ) RETURNING * INTO new_row;
  PERFORM public._audit_write(auth.uid(),'policy.no_show.created','no_show_policy',new_row.id,NULL,to_jsonb(new_row),NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_no_show_policy_version(_policy_key text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_version int; new_row public.no_show_policies%ROWTYPE; lock_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._validate_no_show_payload(_payload);
  SELECT id INTO lock_id FROM public.no_show_policies
   WHERE policy_key = _policy_key ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF lock_id IS NULL THEN RAISE EXCEPTION 'policy_key not found'; END IF;
  SELECT COALESCE(MAX(version),0) + 1 INTO next_version
    FROM public.no_show_policies WHERE policy_key = _policy_key;
  INSERT INTO public.no_show_policies (
    policy_key, version, name, service_type,
    no_show_enabled, min_wait_seconds, required_contact_attempts,
    fee_type, fee_fixed_cents, fee_percent_bps, fee_cap_cents,
    automatic_charge_enabled, admin_review_required,
    customer_summary, internal_notes, effective_at, expires_at, active, created_by
  ) VALUES (
    _policy_key, next_version, _payload->>'name', _payload->>'service_type',
    COALESCE((_payload->>'no_show_enabled')::boolean, true),
    (_payload->>'min_wait_seconds')::int,
    COALESCE((_payload->>'required_contact_attempts')::int, 1),
    _payload->>'fee_type',
    NULLIF(_payload->>'fee_fixed_cents','')::int,
    NULLIF(_payload->>'fee_percent_bps','')::int,
    NULLIF(_payload->>'fee_cap_cents','')::int,
    COALESCE((_payload->>'automatic_charge_enabled')::boolean, false),
    COALESCE((_payload->>'admin_review_required')::boolean, true),
    _payload->>'customer_summary',
    NULLIF(_payload->>'internal_notes',''),
    COALESCE(NULLIF(_payload->>'effective_at','')::timestamptz, now()),
    NULLIF(_payload->>'expires_at','')::timestamptz,
    false,
    auth.uid()
  ) RETURNING * INTO new_row;
  PERFORM public._audit_write(auth.uid(),'policy.no_show.version_created','no_show_policy',new_row.id,NULL,to_jsonb(new_row),NULL);
  RETURN to_jsonb(new_row);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_activate_no_show_policy(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.no_show_policies%ROWTYPE;
        prev jsonb; nxt jsonb; deactivated_prev jsonb; deactivated_next jsonb; existing_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO target FROM public.no_show_policies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy not found'; END IF;
  IF target.active THEN RETURN to_jsonb(target); END IF;
  SELECT id INTO existing_id FROM public.no_show_policies
    WHERE policy_key = target.policy_key AND service_type = target.service_type AND active
    FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    SELECT to_jsonb(c.*) INTO deactivated_prev FROM public.no_show_policies c WHERE id = existing_id;
    UPDATE public.no_show_policies SET active = false WHERE id = existing_id
      RETURNING to_jsonb(no_show_policies.*) INTO deactivated_next;
    PERFORM public._audit_write(auth.uid(),'policy.no_show.deactivated','no_show_policy',existing_id,deactivated_prev,deactivated_next,_reason);
  END IF;
  prev := to_jsonb(target);
  UPDATE public.no_show_policies SET active = true WHERE id = _id
    RETURNING to_jsonb(no_show_policies.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'policy.no_show.activated','no_show_policy',_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_no_show_policy(_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.no_show_policies c WHERE id = _id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'policy not found'; END IF;
  IF NOT (prev->>'active')::boolean THEN RETURN prev; END IF;
  UPDATE public.no_show_policies SET active = false WHERE id = _id
    RETURNING to_jsonb(no_show_policies.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'policy.no_show.deactivated','no_show_policy',_id,prev,nxt,_reason);
  RETURN nxt;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_no_show_policies()
RETURNS SETOF public.no_show_policies
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.no_show_policies ORDER BY policy_key, service_type, version DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_no_show_policy(_service_type text, _at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF _service_type NOT IN ('standard','airport') THEN RAISE EXCEPTION 'invalid service_type'; END IF;
  SELECT jsonb_build_object(
    'id', id, 'policy_key', policy_key, 'version', version, 'name', name, 'service_type', service_type,
    'no_show_enabled', no_show_enabled,
    'min_wait_seconds', min_wait_seconds,
    'required_contact_attempts', required_contact_attempts,
    'fee_type', fee_type, 'fee_fixed_cents', fee_fixed_cents,
    'fee_percent_bps', fee_percent_bps, 'fee_cap_cents', fee_cap_cents,
    'automatic_charge_enabled', automatic_charge_enabled,
    'admin_review_required', admin_review_required,
    'customer_summary', customer_summary,
    'effective_at', effective_at, 'expires_at', expires_at
  ) INTO result
  FROM public.no_show_policies
  WHERE active AND service_type = _service_type
    AND effective_at <= _at
    AND (expires_at IS NULL OR expires_at > _at)
  ORDER BY effective_at DESC, version DESC LIMIT 1;
  RETURN result;
END; $$;

-- =====================================================================
-- Seed data (all inactive; no runtime effect)
-- =====================================================================
INSERT INTO public.cancellation_policies (
  policy_key, version, name, service_type,
  free_cancellation_enabled, free_cancellation_cutoff_hours,
  late_cancellation_enabled, fee_type,
  admin_review_required, customer_summary, active
) VALUES (
  'standard', 1, 'Standard Cancellation Policy', 'standard',
  true, 24, true, 'none', true,
  'Reservations may be cancelled free of charge up to 24 hours before the scheduled pickup time. Cancellations inside the cutoff window may be subject to a fee once activated by HarborLine operations.',
  false
);

INSERT INTO public.no_show_policies (
  policy_key, version, name, service_type,
  no_show_enabled, min_wait_seconds, required_contact_attempts,
  fee_type, automatic_charge_enabled, admin_review_required,
  customer_summary, active
) VALUES (
  'standard_no_show', 1, 'Standard No-Show Policy', 'standard',
  true, 900, 2, 'none', false, true,
  'If a passenger is not located within 15 minutes of the scheduled pickup and after reasonable contact attempts, the reservation may be recorded as a no-show and reviewed by HarborLine operations.',
  false
);

INSERT INTO public.no_show_policies (
  policy_key, version, name, service_type,
  no_show_enabled, min_wait_seconds, required_contact_attempts,
  fee_type, automatic_charge_enabled, admin_review_required,
  customer_summary, active
) VALUES (
  'airport_no_show', 1, 'Airport No-Show Policy', 'airport',
  true, 2700, 2, 'none', false, true,
  'For airport pickups, if the passenger is not located within 45 minutes of the scheduled pickup and after reasonable contact attempts, the reservation may be recorded as a no-show and reviewed by HarborLine operations.',
  false
);
