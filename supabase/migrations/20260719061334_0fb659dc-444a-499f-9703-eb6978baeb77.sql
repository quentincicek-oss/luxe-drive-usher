
CREATE TABLE public.concierge_sessions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_sessions TO authenticated;
GRANT ALL ON public.concierge_sessions TO service_role;
ALTER TABLE public.concierge_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own concierge session" ON public.concierge_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX concierge_sessions_last_active_idx ON public.concierge_sessions (last_active_at);
