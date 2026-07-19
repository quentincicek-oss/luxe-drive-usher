-- Phase F: Driver App additive schema

-- Enums
DO $$ BEGIN
  CREATE TYPE public.driver_document_kind AS ENUM ('license','insurance','company_id','medical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.driver_document_status AS ENUM ('valid','expiring','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.driver_trip_event_kind AS ENUM (
    'accepted','rejected','arrived','waiting','started','completed',
    'no_show','incident','dispatch_contacted','passenger_contacted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- driver_documents
-- ============================================================
CREATE TABLE public.driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
  kind public.driver_document_kind NOT NULL,
  document_number TEXT,
  issued_at DATE,
  expires_at DATE,
  file_url TEXT,
  status public.driver_document_status NOT NULL DEFAULT 'valid',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_documents_driver_idx ON public.driver_documents(driver_id);

GRANT SELECT ON public.driver_documents TO authenticated;
GRANT ALL ON public.driver_documents TO service_role;

ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read own documents"
  ON public.driver_documents FOR SELECT TO authenticated
  USING (
    driver_id IN (SELECT id FROM public.driver_profiles WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

CREATE POLICY "Admins manage documents"
  ON public.driver_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER driver_documents_updated_at
  BEFORE UPDATE ON public.driver_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- driver_trip_events
-- ============================================================
CREATE TABLE public.driver_trip_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.booking_assignments(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
  event public.driver_trip_event_kind NOT NULL,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_trip_events_assignment_idx ON public.driver_trip_events(assignment_id);
CREATE INDEX driver_trip_events_driver_idx ON public.driver_trip_events(driver_id);

GRANT SELECT, INSERT ON public.driver_trip_events TO authenticated;
GRANT ALL ON public.driver_trip_events TO service_role;

ALTER TABLE public.driver_trip_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers insert own events"
  ON public.driver_trip_events FOR INSERT TO authenticated
  WITH CHECK (
    driver_id IN (SELECT id FROM public.driver_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Drivers and admins read events"
  ON public.driver_trip_events FOR SELECT TO authenticated
  USING (
    driver_id IN (SELECT id FROM public.driver_profiles WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );
