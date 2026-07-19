
-- Enums
CREATE TYPE public.referral_source AS ENUM ('nfc','qr','link');
CREATE TYPE public.referral_status AS ENUM ('pending','converted','rewarded','expired','cancelled');
CREATE TYPE public.reward_status AS ENUM ('pending','redeemed','expired','cancelled');

-- Campaigns (admin managed reward rules)
CREATE TABLE public.referral_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  reward_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  reward_flat_amount NUMERIC(10,2),
  reward_validity_days INTEGER NOT NULL DEFAULT 90,
  per_referrer_limit INTEGER,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_campaigns TO authenticated;
GRANT ALL ON public.referral_campaigns TO service_role;
ALTER TABLE public.referral_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_read_active" ON public.referral_campaigns FOR SELECT TO authenticated USING (active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "campaigns_admin_all" ON public.referral_campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Referral codes (belong to a user; may be tied to a campaign; can back QR/NFC/link)
CREATE TABLE public.referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referral_codes_owner_idx ON public.referral_codes(owner_user_id);
GRANT SELECT, INSERT, UPDATE ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codes_owner_read" ON public.referral_codes FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "codes_owner_write" ON public.referral_codes FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "codes_owner_update" ON public.referral_codes FOR UPDATE TO authenticated USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (owner_user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "codes_admin_all" ON public.referral_codes FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- NFC tags (physical tag UIDs mapped to a referral code)
CREATE TABLE public.nfc_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_uid TEXT NOT NULL UNIQUE,
  code_id UUID NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  issued_to UUID,
  last_tapped_at TIMESTAMPTZ,
  tap_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nfc_tags_code_idx ON public.nfc_tags(code_id);
GRANT SELECT ON public.nfc_tags TO authenticated;
GRANT ALL ON public.nfc_tags TO service_role;
ALTER TABLE public.nfc_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfc_admin_all" ON public.nfc_tags FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "nfc_owner_read" ON public.nfc_tags FOR SELECT TO authenticated USING (
  issued_to = auth.uid() OR EXISTS (SELECT 1 FROM public.referral_codes c WHERE c.id = code_id AND c.owner_user_id = auth.uid())
);

-- Referrals (permanent audit record)
CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  referred_user_id UUID,
  code_id UUID REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  source public.referral_source NOT NULL,
  status public.referral_status NOT NULL DEFAULT 'pending',
  nfc_tag_id UUID REFERENCES public.nfc_tags(id) ON DELETE SET NULL,
  first_booking_id UUID,
  ip_hash TEXT,
  user_agent TEXT,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_idx ON public.referrals(referrer_user_id);
CREATE INDEX referrals_referred_idx ON public.referrals(referred_user_id);
CREATE INDEX referrals_status_idx ON public.referrals(status);
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referrals_own_read" ON public.referrals FOR SELECT TO authenticated USING (
  referrer_user_id = auth.uid() OR referred_user_id = auth.uid() OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "referrals_admin_all" ON public.referrals FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Rewards (loyalty ledger)
CREATE TABLE public.referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.referral_campaigns(id) ON DELETE SET NULL,
  amount_percent NUMERIC(5,2),
  amount_flat NUMERIC(10,2),
  status public.reward_status NOT NULL DEFAULT 'pending',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  booking_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rewards_recipient_idx ON public.referral_rewards(recipient_user_id);
CREATE INDEX rewards_status_idx ON public.referral_rewards(status);
GRANT SELECT ON public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_rewards TO service_role;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rewards_own_read" ON public.referral_rewards FOR SELECT TO authenticated USING (
  recipient_user_id = auth.uid() OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "rewards_admin_all" ON public.referral_rewards FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at triggers
CREATE TRIGGER trg_ref_campaigns_updated BEFORE UPDATE ON public.referral_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ref_codes_updated BEFORE UPDATE ON public.referral_codes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_nfc_tags_updated BEFORE UPDATE ON public.nfc_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_referrals_updated BEFORE UPDATE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rewards_updated BEFORE UPDATE ON public.referral_rewards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- KPI function for admin dashboards
CREATE OR REPLACE FUNCTION public.admin_referral_kpis()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'total_referrals', (SELECT count(*) FROM referrals),
    'converted_referrals', (SELECT count(*) FROM referrals WHERE status IN ('converted','rewarded')),
    'pending_referrals', (SELECT count(*) FROM referrals WHERE status = 'pending'),
    'conversion_rate', (
      SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE status IN ('converted','rewarded')) / count(*), 2) END
      FROM referrals
    ),
    'pending_rewards', (SELECT count(*) FROM referral_rewards WHERE status = 'pending'),
    'redeemed_rewards', (SELECT count(*) FROM referral_rewards WHERE status = 'redeemed'),
    'active_campaigns', (SELECT count(*) FROM referral_campaigns WHERE active AND (ends_at IS NULL OR ends_at > now())),
    'nfc_tags_active', (SELECT count(*) FROM nfc_tags WHERE active),
    'top_referrers', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT r.referrer_user_id AS user_id,
               COALESCE(p.name || ' ' || COALESCE(p.surname,''), p.email, 'User') AS name,
               count(*) AS total,
               count(*) FILTER (WHERE status IN ('converted','rewarded')) AS converted
        FROM referrals r LEFT JOIN profiles p ON p.id = r.referrer_user_id
        GROUP BY r.referrer_user_id, p.name, p.surname, p.email
        ORDER BY converted DESC, total DESC LIMIT 10
      ) t
    ),
    'top_drivers', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT r.referrer_user_id AS user_id,
               COALESCE(dp.full_name, p.email, 'Driver') AS name,
               count(*) AS total,
               count(*) FILTER (WHERE status IN ('converted','rewarded')) AS converted
        FROM referrals r
        JOIN user_roles ur ON ur.user_id = r.referrer_user_id AND ur.role = 'driver'
        LEFT JOIN driver_profiles dp ON dp.user_id = r.referrer_user_id
        LEFT JOIN profiles p ON p.id = r.referrer_user_id
        GROUP BY r.referrer_user_id, dp.full_name, p.email
        ORDER BY converted DESC, total DESC LIMIT 10
      ) t
    )
  ) INTO result;
  RETURN result;
END; $$;
