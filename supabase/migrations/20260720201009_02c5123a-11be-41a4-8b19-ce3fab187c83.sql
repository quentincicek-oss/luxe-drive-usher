
-- =========================================================================
-- PHASE I-G  —  Support messaging, support settings, and amenity catalog
-- =========================================================================

-- ---- helpers -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- =========================================================================
-- SUPPORT MESSAGING
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.support_status AS ENUM ('open','pending','resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_sender AS ENUM ('passenger','admin','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_category AS ENUM (
    'booking_help','driver_concern','payment_receipt','lost_item',
    'safety_concern','vehicle_preference','amenity_question',
    'technical_problem','general_support'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category           public.support_category NOT NULL DEFAULT 'general_support',
  subject            text NOT NULL,
  status             public.support_status NOT NULL DEFAULT 'open',
  booking_id         uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  assigned_admin_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_passenger_msg_at timestamptz,
  last_admin_msg_at     timestamptz,
  passenger_unread_count int NOT NULL DEFAULT 0,
  admin_unread_count     int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_conversations TO authenticated;
GRANT ALL ON public.support_conversations TO service_role;
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passenger reads own support conversations"
  ON public.support_conversations FOR SELECT TO authenticated
  USING (passenger_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS support_conversations_passenger_idx
  ON public.support_conversations(passenger_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_conversations_status_idx
  ON public.support_conversations(status, updated_at DESC);

CREATE TRIGGER support_conversations_updated_at
  BEFORE UPDATE ON public.support_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.support_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_type      public.support_sender NOT NULL,
  sender_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Passengers only see non-internal messages on their own conversations.
CREATE POLICY "passenger reads own non-internal support messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    (
      NOT is_internal_note
      AND EXISTS (
        SELECT 1 FROM public.support_conversations c
        WHERE c.id = conversation_id AND c.passenger_id = auth.uid()
      )
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX IF NOT EXISTS support_messages_conversation_idx
  ON public.support_messages(conversation_id, created_at ASC);

-- Rate-limit passenger messages (server-side enforced via RPC too)
CREATE TABLE IF NOT EXISTS public.support_message_rate (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  message_count     int NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.support_message_rate TO service_role;
ALTER TABLE public.support_message_rate ENABLE ROW LEVEL SECURITY;
-- no policies: only accessed by SECURITY DEFINER RPCs

-- ---- Support RPCs --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.support_open_conversation(
  _category text, _subject text, _first_message text, _booking_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; cat public.support_category;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF length(coalesce(_subject,'')) < 2 OR length(_subject) > 200 THEN RAISE EXCEPTION 'invalid subject'; END IF;
  IF length(coalesce(_first_message,'')) < 1 OR length(_first_message) > 4000 THEN RAISE EXCEPTION 'invalid message'; END IF;
  BEGIN cat := _category::public.support_category;
  EXCEPTION WHEN OTHERS THEN cat := 'general_support'; END;
  IF _booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bookings WHERE id=_booking_id AND passenger_id=auth.uid()
  ) THEN RAISE EXCEPTION 'booking not owned'; END IF;

  INSERT INTO public.support_conversations (passenger_id, category, subject, booking_id, last_passenger_msg_at, admin_unread_count)
  VALUES (auth.uid(), cat, btrim(_subject), _booking_id, now(), 1)
  RETURNING id INTO new_id;

  INSERT INTO public.support_messages (conversation_id, sender_type, sender_user_id, body)
  VALUES (new_id, 'passenger', auth.uid(), btrim(_first_message));

  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.support_open_conversation(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_open_conversation(text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_send_message(_conversation_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE msg_id uuid; conv public.support_conversations%ROWTYPE;
        rate public.support_message_rate%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF length(coalesce(_body,'')) < 1 OR length(_body) > 4000 THEN RAISE EXCEPTION 'invalid message'; END IF;
  SELECT * INTO conv FROM public.support_conversations WHERE id=_conversation_id FOR UPDATE;
  IF NOT FOUND OR conv.passenger_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- rate-limit: 10 msgs / 5 min
  SELECT * INTO rate FROM public.support_message_rate WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.support_message_rate(user_id, window_started_at, message_count) VALUES (auth.uid(), now(), 1);
  ELSIF rate.window_started_at < now() - interval '5 minutes' THEN
    UPDATE public.support_message_rate SET window_started_at=now(), message_count=1, updated_at=now() WHERE user_id=auth.uid();
  ELSIF rate.message_count >= 10 THEN
    RAISE EXCEPTION 'rate limited';
  ELSE
    UPDATE public.support_message_rate SET message_count=rate.message_count+1, updated_at=now() WHERE user_id=auth.uid();
  END IF;

  INSERT INTO public.support_messages (conversation_id, sender_type, sender_user_id, body)
  VALUES (_conversation_id, 'passenger', auth.uid(), btrim(_body))
  RETURNING id INTO msg_id;

  UPDATE public.support_conversations SET
    status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
    last_passenger_msg_at = now(),
    admin_unread_count = admin_unread_count + 1,
    updated_at = now()
  WHERE id = _conversation_id;

  RETURN msg_id;
END; $$;
REVOKE ALL ON FUNCTION public.support_send_message(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_send_message(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_mark_read(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF public.has_role(auth.uid(),'admin') THEN
    UPDATE public.support_conversations SET admin_unread_count=0, updated_at=now() WHERE id=_conversation_id;
  ELSE
    UPDATE public.support_conversations SET passenger_unread_count=0, updated_at=now()
    WHERE id=_conversation_id AND passenger_id=auth.uid();
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.support_mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_mark_read(uuid) TO authenticated;

-- Admin support RPCs
CREATE OR REPLACE FUNCTION public.admin_support_reply(_conversation_id uuid, _body text, _internal boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE msg_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(_body,'')) < 1 OR length(_body) > 4000 THEN RAISE EXCEPTION 'invalid message'; END IF;
  INSERT INTO public.support_messages (conversation_id, sender_type, sender_user_id, body, is_internal_note)
  VALUES (_conversation_id, 'admin', auth.uid(), btrim(_body), coalesce(_internal,false))
  RETURNING id INTO msg_id;
  IF NOT coalesce(_internal,false) THEN
    UPDATE public.support_conversations SET
      last_admin_msg_at = now(),
      passenger_unread_count = passenger_unread_count + 1,
      status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
      updated_at = now()
    WHERE id = _conversation_id;
    PERFORM public._audit_write(auth.uid(),'support.reply_sent','support_conversation',_conversation_id,NULL,NULL,NULL);
  ELSE
    UPDATE public.support_conversations SET updated_at = now() WHERE id = _conversation_id;
    PERFORM public._audit_write(auth.uid(),'support.internal_note_added','support_conversation',_conversation_id,NULL,NULL,NULL);
  END IF;
  RETURN msg_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_support_reply(uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_support_reply(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_support_set_status(_conversation_id uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('open','pending','resolved') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.support_conversations c WHERE id=_conversation_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  UPDATE public.support_conversations SET status=_status::public.support_status, updated_at=now()
    WHERE id=_conversation_id RETURNING to_jsonb(support_conversations.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'support.status_changed','support_conversation',_conversation_id,prev,nxt,NULL);
  RETURN nxt;
END; $$;
REVOKE ALL ON FUNCTION public.admin_support_set_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_support_set_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_support_assign(_conversation_id uuid, _assignee uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; nxt jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _assignee IS NOT NULL AND NOT public.has_role(_assignee,'admin') THEN RAISE EXCEPTION 'assignee not admin'; END IF;
  SELECT to_jsonb(c.*) INTO prev FROM public.support_conversations c WHERE id=_conversation_id FOR UPDATE;
  IF prev IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  UPDATE public.support_conversations SET assigned_admin_id=_assignee, updated_at=now()
    WHERE id=_conversation_id RETURNING to_jsonb(support_conversations.*) INTO nxt;
  PERFORM public._audit_write(auth.uid(),'support.assigned','support_conversation',_conversation_id,prev,nxt,NULL);
  RETURN nxt;
END; $$;
REVOKE ALL ON FUNCTION public.admin_support_assign(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_support_assign(uuid,uuid) TO authenticated;

-- =========================================================================
-- SUPPORT SETTINGS (singleton)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.support_settings (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  whatsapp_enabled         boolean NOT NULL DEFAULT false,
  whatsapp_phone_e164      text,
  whatsapp_template        text,
  email_enabled            boolean NOT NULL DEFAULT false,
  email_address            text,
  operating_hours          text,
  emergency_message        text,
  fallback_message         text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.support_settings TO authenticated;
GRANT ALL ON public.support_settings TO service_role;
ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read support settings"
  ON public.support_settings FOR SELECT TO authenticated USING (true);

INSERT INTO public.support_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_update_support_settings(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prev jsonb; nxt jsonb;
  wa_enabled boolean; wa_phone text; wa_tpl text;
  em_enabled boolean; em_addr text;
  ops text; emerg text; fb text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  wa_enabled := coalesce((_payload->>'whatsapp_enabled')::boolean, false);
  wa_phone   := NULLIF(btrim(_payload->>'whatsapp_phone_e164'),'');
  wa_tpl     := NULLIF(btrim(_payload->>'whatsapp_template'),'');
  em_enabled := coalesce((_payload->>'email_enabled')::boolean, false);
  em_addr    := NULLIF(lower(btrim(_payload->>'email_address')),'');
  ops        := NULLIF(btrim(_payload->>'operating_hours'),'');
  emerg      := NULLIF(btrim(_payload->>'emergency_message'),'');
  fb         := NULLIF(btrim(_payload->>'fallback_message'),'');

  IF wa_enabled AND (wa_phone IS NULL OR wa_phone !~ '^\+[1-9][0-9]{6,14}$') THEN
    RAISE EXCEPTION 'invalid whatsapp phone (E.164 required)';
  END IF;
  IF em_enabled AND (em_addr IS NULL OR em_addr !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') THEN
    RAISE EXCEPTION 'invalid support email';
  END IF;
  IF wa_tpl IS NOT NULL AND length(wa_tpl) > 500 THEN RAISE EXCEPTION 'template too long'; END IF;
  IF fb IS NOT NULL AND length(fb) > 1000 THEN RAISE EXCEPTION 'fallback too long'; END IF;

  SELECT to_jsonb(s.*) INTO prev FROM public.support_settings s WHERE id=1 FOR UPDATE;

  UPDATE public.support_settings SET
    whatsapp_enabled = wa_enabled,
    whatsapp_phone_e164 = wa_phone,
    whatsapp_template = wa_tpl,
    email_enabled = em_enabled,
    email_address = em_addr,
    operating_hours = ops,
    emergency_message = emerg,
    fallback_message = fb,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id=1 RETURNING to_jsonb(support_settings.*) INTO nxt;

  PERFORM public._audit_write(auth.uid(),'support.settings.updated','support_settings',NULL,prev,nxt,NULL);
  IF (prev->>'whatsapp_phone_e164') IS DISTINCT FROM (nxt->>'whatsapp_phone_e164')
     OR (prev->>'whatsapp_enabled') IS DISTINCT FROM (nxt->>'whatsapp_enabled') THEN
    PERFORM public._audit_write(auth.uid(),'support.whatsapp.updated','support_settings',NULL,prev,nxt,NULL);
  END IF;
  IF (prev->>'email_address') IS DISTINCT FROM (nxt->>'email_address')
     OR (prev->>'email_enabled') IS DISTINCT FROM (nxt->>'email_enabled') THEN
    PERFORM public._audit_write(auth.uid(),'support.email.updated','support_settings',NULL,prev,nxt,NULL);
  END IF;
  RETURN nxt;
END; $$;
REVOKE ALL ON FUNCTION public.admin_update_support_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_support_settings(jsonb) TO authenticated;

-- =========================================================================
-- AMENITY CATALOG
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.amenity_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.amenity_categories TO authenticated, anon;
GRANT ALL ON public.amenity_categories TO service_role;
ALTER TABLE public.amenity_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amenity categories readable" ON public.amenity_categories FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.amenity_options (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  description          text,
  category_id          uuid REFERENCES public.amenity_categories(id) ON DELETE SET NULL,
  price_delta_cents    int NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0),
  currency             text NOT NULL DEFAULT 'USD',
  complimentary        boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  display_order        int NOT NULL DEFAULT 0,
  allowed_ride_types   text[] NOT NULL DEFAULT ARRAY['escalade','suburban','denali']::text[],
  icon                 text,
  image_url            text,
  internal_cost_cents  int,
  inventory_note       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- Passengers/anon may read active amenities via RPC only (no direct grant to hide internal_cost_cents).
GRANT SELECT ON public.amenity_options TO authenticated;
GRANT ALL ON public.amenity_options TO service_role;
ALTER TABLE public.amenity_options ENABLE ROW LEVEL SECURITY;
-- Any authenticated user can read active options; admins see all.
CREATE POLICY "amenity options readable" ON public.amenity_options FOR SELECT TO authenticated
  USING (active OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER amenity_options_updated_at BEFORE UPDATE ON public.amenity_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.booking_amenities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amenity_option_id   uuid NOT NULL REFERENCES public.amenity_options(id) ON DELETE RESTRICT,
  amenity_code        text NOT NULL,
  amenity_name        text NOT NULL,
  quantity            int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  price_delta_cents   int NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0),
  currency            text NOT NULL DEFAULT 'USD',
  complimentary       boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, amenity_option_id)
);
GRANT SELECT ON public.booking_amenities TO authenticated;
GRANT ALL ON public.booking_amenities TO service_role;
ALTER TABLE public.booking_amenities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "passenger reads own booking amenities"
  ON public.booking_amenities FOR SELECT TO authenticated
  USING (
    public.passenger_owns_booking(booking_id)
    OR public.driver_owns_booking(booking_id)
    OR public.has_role(auth.uid(),'admin')
  );

CREATE INDEX IF NOT EXISTS booking_amenities_booking_idx ON public.booking_amenities(booking_id);

-- ---- amenity RPCs --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_active_amenities(_ride_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.display_order, t.name), '[]'::jsonb) INTO result
  FROM (
    SELECT o.id, o.code, o.name, o.description, o.price_delta_cents, o.currency,
           o.complimentary, o.display_order, o.icon, o.image_url,
           o.allowed_ride_types, c.code AS category_code, c.name AS category_name
    FROM public.amenity_options o
    LEFT JOIN public.amenity_categories c ON c.id = o.category_id
    WHERE o.active
      AND (_ride_type IS NULL OR _ride_type = ANY(o.allowed_ride_types))
  ) t;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.list_active_amenities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_amenities(text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.admin_list_amenities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.display_order, t.name), '[]'::jsonb) INTO result
  FROM (
    SELECT o.*, c.code AS category_code, c.name AS category_name
    FROM public.amenity_options o
    LEFT JOIN public.amenity_categories c ON c.id = o.category_id
  ) t;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_amenities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_amenities() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_amenity(_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb; new_row public.amenity_options%ROWTYPE; action_label text;
        price_before int; price_after int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_payload->>'code','') = '' OR COALESCE(_payload->>'name','') = '' THEN
    RAISE EXCEPTION 'code and name required';
  END IF;
  IF (_payload->>'price_delta_cents') IS NOT NULL AND (_payload->>'price_delta_cents')::int < 0 THEN
    RAISE EXCEPTION 'price must be non-negative';
  END IF;

  IF _id IS NULL THEN
    action_label := 'amenity.created';
    INSERT INTO public.amenity_options
      (code, name, description, category_id, price_delta_cents, currency,
       complimentary, active, display_order, allowed_ride_types, icon, image_url,
       internal_cost_cents, inventory_note)
    VALUES (
      lower(btrim(_payload->>'code')),
      btrim(_payload->>'name'),
      NULLIF(_payload->>'description',''),
      NULLIF(_payload->>'category_id','')::uuid,
      COALESCE((_payload->>'price_delta_cents')::int, 0),
      COALESCE(_payload->>'currency','USD'),
      COALESCE((_payload->>'complimentary')::boolean, false),
      COALESCE((_payload->>'active')::boolean, true),
      COALESCE((_payload->>'display_order')::int, 0),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(coalesce(_payload->'allowed_ride_types','[]'::jsonb))),
        ARRAY['escalade','suburban','denali']::text[]
      ),
      NULLIF(_payload->>'icon',''),
      NULLIF(_payload->>'image_url',''),
      NULLIF(_payload->>'internal_cost_cents','')::int,
      NULLIF(_payload->>'inventory_note','')
    ) RETURNING * INTO new_row;
    prev := NULL;
  ELSE
    action_label := 'amenity.updated';
    SELECT to_jsonb(o.*) INTO prev FROM public.amenity_options o WHERE id=_id FOR UPDATE;
    IF prev IS NULL THEN RAISE EXCEPTION 'amenity not found'; END IF;
    price_before := (prev->>'price_delta_cents')::int;
    UPDATE public.amenity_options SET
      code = lower(btrim(_payload->>'code')),
      name = btrim(_payload->>'name'),
      description = NULLIF(_payload->>'description',''),
      category_id = NULLIF(_payload->>'category_id','')::uuid,
      price_delta_cents = COALESCE((_payload->>'price_delta_cents')::int, 0),
      currency = COALESCE(_payload->>'currency','USD'),
      complimentary = COALESCE((_payload->>'complimentary')::boolean, complimentary),
      active = COALESCE((_payload->>'active')::boolean, active),
      display_order = COALESCE((_payload->>'display_order')::int, display_order),
      allowed_ride_types = COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(coalesce(_payload->'allowed_ride_types','[]'::jsonb))),
        allowed_ride_types
      ),
      icon = NULLIF(_payload->>'icon',''),
      image_url = NULLIF(_payload->>'image_url',''),
      internal_cost_cents = NULLIF(_payload->>'internal_cost_cents','')::int,
      inventory_note = NULLIF(_payload->>'inventory_note',''),
      updated_at = now()
    WHERE id=_id RETURNING * INTO new_row;
    price_after := new_row.price_delta_cents;
    IF price_before IS DISTINCT FROM price_after THEN
      PERFORM public._audit_write(auth.uid(),'amenity.price_changed','amenity_option',new_row.id,prev,to_jsonb(new_row),NULL);
    END IF;
    IF (prev->>'active')::boolean IS DISTINCT FROM new_row.active THEN
      PERFORM public._audit_write(
        auth.uid(),
        CASE WHEN new_row.active THEN 'amenity.activated' ELSE 'amenity.deactivated' END,
        'amenity_option', new_row.id, prev, to_jsonb(new_row), NULL);
    END IF;
  END IF;
  PERFORM public._audit_write(auth.uid(), action_label, 'amenity_option', new_row.id, prev, to_jsonb(new_row), NULL);
  RETURN to_jsonb(new_row);
END; $$;
REVOKE ALL ON FUNCTION public.admin_upsert_amenity(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_amenity(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_amenity(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT to_jsonb(o.*) INTO prev FROM public.amenity_options o WHERE id=_id;
  IF prev IS NULL THEN RAISE EXCEPTION 'amenity not found'; END IF;
  -- Prevent hard delete if referenced by any historical booking selection.
  IF EXISTS (SELECT 1 FROM public.booking_amenities WHERE amenity_option_id=_id) THEN
    UPDATE public.amenity_options SET active=false, updated_at=now() WHERE id=_id;
    PERFORM public._audit_write(auth.uid(),'amenity.deactivated','amenity_option',_id,prev,NULL,'referenced by historical bookings');
  ELSE
    DELETE FROM public.amenity_options WHERE id=_id;
    PERFORM public._audit_write(auth.uid(),'amenity.deleted','amenity_option',_id,prev,NULL,NULL);
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_delete_amenity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_amenity(uuid) TO authenticated;

-- Passenger sets the amenity selection for their booking. Server snapshots price.
-- Locked once a driver is assigned OR payment captured.
CREATE OR REPLACE FUNCTION public.set_booking_amenities(_booking_id uuid, _amenity_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.bookings%ROWTYPE;
  aid uuid; opt public.amenity_options%ROWTYPE;
  total_add int := 0;
  has_assignment boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.passenger_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF b.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'booking closed'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.booking_assignments WHERE booking_id=_booking_id AND is_current) INTO has_assignment;
  IF has_assignment THEN RAISE EXCEPTION 'amenities locked: trip already assigned'; END IF;

  -- Wipe prior selections (allowed pre-assignment).
  DELETE FROM public.booking_amenities WHERE booking_id=_booking_id;

  IF _amenity_ids IS NOT NULL THEN
    FOREACH aid IN ARRAY _amenity_ids LOOP
      SELECT * INTO opt FROM public.amenity_options WHERE id=aid;
      IF NOT FOUND OR NOT opt.active THEN RAISE EXCEPTION 'amenity unavailable'; END IF;
      IF NOT (b.ride_type = ANY(opt.allowed_ride_types)) THEN
        RAISE EXCEPTION 'amenity not allowed for %', b.ride_type;
      END IF;
      INSERT INTO public.booking_amenities
        (booking_id, amenity_option_id, amenity_code, amenity_name,
         quantity, price_delta_cents, currency, complimentary)
      VALUES
        (_booking_id, opt.id, opt.code, opt.name, 1,
         CASE WHEN opt.complimentary THEN 0 ELSE opt.price_delta_cents END,
         opt.currency, opt.complimentary);
      IF NOT opt.complimentary THEN total_add := total_add + opt.price_delta_cents; END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'amenity_add_cents', total_add);
END; $$;
REVOKE ALL ON FUNCTION public.set_booking_amenities(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_booking_amenities(uuid,uuid[]) TO authenticated;

-- Server-side total (base * 100 + amenities).
CREATE OR REPLACE FUNCTION public.booking_amenity_total_cents(_booking_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(ba.price_delta_cents * ba.quantity), 0)::int
  FROM public.booking_amenities ba WHERE ba.booking_id = _booking_id
    AND NOT ba.complimentary;
$$;
REVOKE ALL ON FUNCTION public.booking_amenity_total_cents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_amenity_total_cents(uuid) TO authenticated;

-- =========================================================================
-- Seed default amenity categories + options (idempotent)
-- =========================================================================
INSERT INTO public.amenity_categories (code, name, display_order) VALUES
  ('beverages','Beverages',10),
  ('comfort','Comfort',20),
  ('connectivity','Connectivity',30)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.amenity_options
  (code, name, description, category_id, price_delta_cents, complimentary, display_order, allowed_ride_types)
SELECT * FROM (VALUES
  ('bottled_water','Bottled Water','Complimentary chilled bottled water', (SELECT id FROM amenity_categories WHERE code='beverages'), 0, true, 10, ARRAY['escalade','suburban','denali']::text[]),
  ('premium_water','Premium Mineral Water','Fiji or San Pellegrino, chilled', (SELECT id FROM amenity_categories WHERE code='beverages'), 100, false, 20, ARRAY['escalade','suburban','denali']::text[]),
  ('phone_charger','Phone Charger','iPhone & USB-C cables available', (SELECT id FROM amenity_categories WHERE code='connectivity'), 0, true, 10, ARRAY['escalade','suburban','denali']::text[]),
  ('child_seat','Child Seat','Please advise child age/weight',            (SELECT id FROM amenity_categories WHERE code='comfort'), 0, true, 20, ARRAY['escalade','suburban','denali']::text[])
) AS v(code,name,description,category_id,price_delta_cents,complimentary,display_order,allowed_ride_types)
ON CONFLICT (code) DO NOTHING;
