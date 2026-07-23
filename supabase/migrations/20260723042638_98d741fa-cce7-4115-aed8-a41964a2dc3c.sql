
REVOKE ALL ON public.cancellation_policies FROM PUBLIC;
REVOKE ALL ON public.cancellation_policies FROM anon;
REVOKE ALL ON public.cancellation_policies FROM authenticated;
REVOKE ALL ON public.no_show_policies FROM PUBLIC;
REVOKE ALL ON public.no_show_policies FROM anon;
REVOKE ALL ON public.no_show_policies FROM authenticated;

GRANT SELECT ON public.cancellation_policies TO authenticated;
GRANT SELECT ON public.no_show_policies      TO authenticated;
GRANT ALL    ON public.cancellation_policies TO service_role;
GRANT ALL    ON public.no_show_policies      TO service_role;

-- Views inherit privileges from base tables via security_invoker, but the
-- view objects themselves need SELECT for authenticated to be queryable.
REVOKE ALL ON public.v_active_cancellation_policy FROM PUBLIC;
REVOKE ALL ON public.v_active_cancellation_policy FROM anon;
REVOKE ALL ON public.v_active_no_show_policy FROM PUBLIC;
REVOKE ALL ON public.v_active_no_show_policy FROM anon;
GRANT SELECT ON public.v_active_cancellation_policy TO authenticated;
GRANT SELECT ON public.v_active_no_show_policy      TO authenticated;
