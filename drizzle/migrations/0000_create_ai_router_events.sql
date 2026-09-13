-- Observability for the adaptive NVIDIA AI router.
-- No prompts, no completions, no secrets: metadata only.
CREATE TABLE IF NOT EXISTS public.ai_router_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  purpose        text NOT NULL DEFAULT 'unspecified',
  task_kind      text NOT NULL DEFAULT 'assistant',
  requested_tier text,
  tier_used      text NOT NULL,
  model_used     text,
  success        boolean NOT NULL,
  fallback_used  boolean NOT NULL DEFAULT false,
  error_type     text,
  latency_ms     integer,
  prompt_tokens  integer,
  completion_tokens integer,
  attempts       jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_trimmed boolean NOT NULL DEFAULT false,
  summarized     boolean NOT NULL DEFAULT false,
  user_id        uuid
);

CREATE INDEX IF NOT EXISTS ai_router_events_created_at_idx ON public.ai_router_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_router_events_model_idx ON public.ai_router_events (model_used);

GRANT SELECT ON public.ai_router_events TO authenticated;
GRANT ALL ON public.ai_router_events TO service_role;

ALTER TABLE public.ai_router_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read ai router events" ON public.ai_router_events;
CREATE POLICY "Admins read ai router events"
  ON public.ai_router_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin-readable aggregate report.
CREATE OR REPLACE FUNCTION public.admin_ai_router_report(_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz := now() - make_interval(hours => GREATEST(1, LEAST(_hours, 720)));
  _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT jsonb_build_object(
    'as_of', now(),
    'window_hours', GREATEST(1, LEAST(_hours, 720)),
    'totals', (
      SELECT jsonb_build_object(
        'requests', count(*),
        'failures', count(*) FILTER (WHERE NOT success),
        'fallbacks', count(*) FILTER (WHERE fallback_used),
        'trimmed', count(*) FILTER (WHERE context_trimmed),
        'summarized', count(*) FILTER (WHERE summarized),
        'prompt_tokens', COALESCE(sum(prompt_tokens), 0),
        'completion_tokens', COALESCE(sum(completion_tokens), 0),
        'p50_latency_ms', COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms), 0),
        'p95_latency_ms', COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)
      )
      FROM public.ai_router_events WHERE created_at >= _since
    ),
    'by_tier', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT tier_used AS tier, count(*) AS requests,
               count(*) FILTER (WHERE NOT success) AS failures,
               COALESCE(round(avg(latency_ms)), 0) AS avg_latency_ms
        FROM public.ai_router_events WHERE created_at >= _since
        GROUP BY tier_used ORDER BY tier_used
      ) x
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT COALESCE(model_used, 'none') AS model, count(*) AS requests,
               count(*) FILTER (WHERE NOT success) AS failures,
               COALESCE(round(avg(latency_ms)), 0) AS avg_latency_ms
        FROM public.ai_router_events WHERE created_at >= _since
        GROUP BY model_used ORDER BY count(*) DESC
      ) x
    ), '[]'::jsonb),
    'by_error', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT error_type, count(*) AS occurrences
        FROM public.ai_router_events
        WHERE created_at >= _since AND error_type IS NOT NULL
        GROUP BY error_type ORDER BY count(*) DESC
      ) x
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ai_router_report(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ai_router_report(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_router_report(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_router_report(integer) TO service_role;