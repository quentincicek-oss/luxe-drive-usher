
-- =========================================================================
-- Batch A: Rate limits, MFA recovery, legal, cookie consent
-- =========================================================================

-- ---- 1) RATE LIMITS ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action            text NOT NULL,
  bucket_key        text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hit_count         int NOT NULL DEFAULT 0,
  last_hit_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action, bucket_key)
);
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limits: service role only"
  ON public.rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS rate_limits_action_key_idx
  ON public.rate_limits(action, bucket_key);

-- SECURITY DEFINER helper — inserts/updates within a per-(action,key) window.
-- Returns whether the request is allowed, plus retry-after when denied.
CREATE OR REPLACE FUNCTION public.check_and_bump_rate_limit(
  _action text,
  _key text,
  _limit int,
  _window_seconds int
) RETURNS TABLE (allowed boolean, remaining int, retry_after int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  now_ts timestamptz := now();
  row public.rate_limits%ROWTYPE;
  win_end timestamptz;
BEGIN
  IF _action IS NULL OR length(_action) = 0 THEN RAISE EXCEPTION 'action required'; END IF;
  IF _key IS NULL OR length(_key) = 0 THEN RAISE EXCEPTION 'key required'; END IF;
  IF _limit < 1 THEN RAISE EXCEPTION 'limit must be positive'; END IF;
  IF _window_seconds < 1 THEN RAISE EXCEPTION 'window must be positive'; END IF;

  INSERT INTO public.rate_limits(action, bucket_key, window_started_at, hit_count, last_hit_at)
  VALUES (_action, _key, now_ts, 1, now_ts)
  ON CONFLICT (action, bucket_key) DO UPDATE
    SET hit_count = CASE
          WHEN public.rate_limits.window_started_at + (_window_seconds || ' seconds')::interval <= now_ts
          THEN 1
          ELSE public.rate_limits.hit_count + 1
        END,
        window_started_at = CASE
          WHEN public.rate_limits.window_started_at + (_window_seconds || ' seconds')::interval <= now_ts
          THEN now_ts
          ELSE public.rate_limits.window_started_at
        END,
        last_hit_at = now_ts,
        updated_at = now_ts
  RETURNING * INTO row;

  win_end := row.window_started_at + (_window_seconds || ' seconds')::interval;

  IF row.hit_count <= _limit THEN
    RETURN QUERY SELECT true, GREATEST(0, _limit - row.hit_count), 0;
  ELSE
    RETURN QUERY SELECT false, 0, GREATEST(1, EXTRACT(EPOCH FROM (win_end - now_ts))::int);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_and_bump_rate_limit(text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_bump_rate_limit(text,text,int,int) TO authenticated, service_role;

-- ---- 2) ADMIN MFA RECOVERY CODES ----------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_recovery_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  batch_id     uuid NOT NULL
);
REVOKE ALL ON public.admin_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.admin_recovery_codes TO service_role;
ALTER TABLE public.admin_recovery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_recovery_codes: service role only"
  ON public.admin_recovery_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS admin_recovery_codes_user_idx ON public.admin_recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS admin_recovery_codes_hash_idx ON public.admin_recovery_codes(code_hash);

-- Generate 10 recovery codes for the calling admin. Requires AAL2.
-- Returns plaintext codes ONCE to the caller; only hashes are stored.
-- Any prior unused codes are invalidated.
CREATE OR REPLACE FUNCTION public.admin_generate_recovery_codes()
RETURNS TABLE (code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  me uuid := auth.uid();
  batch uuid := gen_random_uuid();
  i int;
  raw text;
  h text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE((auth.jwt() ->> 'aal'), '') <> 'aal2' THEN
    RAISE EXCEPTION 'aal2 required';
  END IF;

  -- invalidate previous unused codes
  UPDATE public.admin_recovery_codes
     SET used_at = now()
   WHERE user_id = me AND used_at IS NULL;

  FOR i IN 1..10 LOOP
    -- 10 chars from a base32-ish alphabet, grouped as XXXXX-XXXXX
    raw := upper(
      substr(replace(encode(gen_random_bytes(8),'base64'),'/',''), 1, 5) ||
      '-' ||
      substr(replace(encode(gen_random_bytes(8),'base64'),'+',''), 1, 5)
    );
    h := encode(extensions.digest(raw, 'sha256'), 'hex');
    INSERT INTO public.admin_recovery_codes(user_id, code_hash, batch_id)
    VALUES (me, h, batch);
    code := raw;
    RETURN NEXT;
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target_type, target_id, metadata)
  VALUES (me, 'admin_recovery_codes_generated', 'user', me,
          jsonb_build_object('batch_id', batch, 'count', 10));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_generate_recovery_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_recovery_codes() TO authenticated;

-- Recovery status for the current admin.
CREATE OR REPLACE FUNCTION public.admin_recovery_status()
RETURNS TABLE (total_codes int, unused_codes int, last_generated_at timestamptz, last_used_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT COUNT(*)::int,
           COUNT(*) FILTER (WHERE used_at IS NULL)::int,
           MAX(created_at),
           MAX(used_at)
      FROM public.admin_recovery_codes
     WHERE user_id = me;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recovery_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recovery_status() TO authenticated;

-- Consume a recovery code: verifies hash for the calling user, marks used,
-- records audit. Returns true when a valid unused code matched. Rate-limited.
CREATE OR REPLACE FUNCTION public.admin_consume_recovery_code(_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  me uuid := auth.uid();
  h text;
  updated int;
  rl record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _code IS NULL OR length(_code) < 6 THEN
    RETURN false;
  END IF;

  -- Rate limit: max 5 attempts per 10 minutes per user
  SELECT * INTO rl FROM public.check_and_bump_rate_limit(
    'admin_mfa_recovery_attempt', 'user:' || me::text, 5, 600);
  IF NOT rl.allowed THEN
    INSERT INTO public.audit_log(actor_id, action, target_type, target_id, metadata)
    VALUES (me, 'admin_recovery_code_rate_limited', 'user', me, jsonb_build_object('retry_after', rl.retry_after));
    RAISE EXCEPTION 'too many attempts';
  END IF;

  h := encode(extensions.digest(upper(trim(_code)), 'sha256'), 'hex');

  UPDATE public.admin_recovery_codes
     SET used_at = now()
   WHERE user_id = me AND code_hash = h AND used_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;

  IF updated > 0 THEN
    INSERT INTO public.audit_log(actor_id, action, target_type, target_id, metadata)
    VALUES (me, 'admin_recovery_code_used', 'user', me, '{}'::jsonb);
    RETURN true;
  ELSE
    INSERT INTO public.audit_log(actor_id, action, target_type, target_id, metadata)
    VALUES (me, 'admin_recovery_code_failed', 'user', me, '{}'::jsonb);
    RETURN false;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_consume_recovery_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consume_recovery_code(text) TO authenticated;

-- ---- 3) LEGAL DOCUMENTS & ACCEPTANCES -----------------------------------

CREATE TABLE IF NOT EXISTS public.legal_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,  -- 'terms' | 'privacy' | 'dpa' | 'cookies'
  version       text NOT NULL,
  effective_at  timestamptz NOT NULL DEFAULT now(),
  summary       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);
GRANT SELECT ON public.legal_documents TO anon, authenticated;
GRANT ALL    ON public.legal_documents TO service_role;
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_documents: public read"
  ON public.legal_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "legal_documents: admin write"
  ON public.legal_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  version       text NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, version)
);
GRANT SELECT, INSERT ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_acceptances TO service_role;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_acceptances: self read"
  ON public.legal_acceptances FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "legal_acceptances: self insert"
  ON public.legal_acceptances FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Record acceptance for the current user (idempotent per (user,kind,version)).
CREATE OR REPLACE FUNCTION public.record_legal_acceptance(_kind text, _version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _kind NOT IN ('terms','privacy','dpa','cookies') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF _version IS NULL OR length(_version) = 0 OR length(_version) > 40 THEN
    RAISE EXCEPTION 'invalid version';
  END IF;
  INSERT INTO public.legal_acceptances(user_id, kind, version)
  VALUES (me, _kind, _version)
  ON CONFLICT (user_id, kind, version) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.record_legal_acceptance(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(text,text) TO authenticated;

-- Seed current versions (safe to re-run).
INSERT INTO public.legal_documents(kind, version, effective_at, summary) VALUES
  ('terms',   '2026-07-01', '2026-07-01', 'HarborLine Executive Services — Terms of Service (initial internal pilot version).'),
  ('privacy', '2026-07-01', '2026-07-01', 'HarborLine Executive Services — Privacy Policy (initial internal pilot version).'),
  ('dpa',     '2026-07-01', '2026-07-01', 'HarborLine Executive Services — Data Processing Addendum (initial internal pilot version).'),
  ('cookies', '2026-07-01', '2026-07-01', 'HarborLine Executive Services — Cookie & tracking policy (initial internal pilot version).')
ON CONFLICT (kind, version) DO NOTHING;

-- ---- 4) COOKIE CONSENT ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cookie_consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_key  text NOT NULL,
  categories   jsonb NOT NULL,
  policy_ver   text NOT NULL,
  ip_hash      text,
  user_agent   text,
  granted_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.cookie_consents TO authenticated, anon;
GRANT ALL ON public.cookie_consents TO service_role;
ALTER TABLE public.cookie_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cookie_consents: self read"
  ON public.cookie_consents FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "cookie_consents: anon+auth insert"
  ON public.cookie_consents FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS cookie_consents_user_idx ON public.cookie_consents(user_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS cookie_consents_session_idx ON public.cookie_consents(session_key, granted_at DESC);
