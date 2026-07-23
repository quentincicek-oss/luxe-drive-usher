
-- Revoke broad anon grants from every existing public table/sequence.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Restore minimum anon access on the tables whose RLS policies explicitly allow anon.
GRANT SELECT ON public.amenity_categories TO anon;
GRANT SELECT ON public.discount_rules     TO anon;
GRANT SELECT ON public.legal_documents    TO anon;
GRANT INSERT ON public.cookie_consents    TO anon;
GRANT INSERT ON public.analytics_events   TO anon;
