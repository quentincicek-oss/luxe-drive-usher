-- Phase I hardening — defense-in-depth. Restrict EXECUTE on the three RPCs
-- introduced by the Critical Fix Batch so they cannot be invoked without a
-- signed-in session. Function bodies already enforce auth.uid() checks;
-- this closes the anon-callable SECURITY DEFINER lint finding for the new
-- surface. Pre-existing RPCs (admin_*, verify_booking_pin, has_role, etc.)
-- are intentionally out of scope for this batch.
REVOKE EXECUTE ON FUNCTION public.advance_assignment(uuid, text, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.advance_assignment(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.create_booking(text, text, timestamptz, integer, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_booking_pin(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.get_my_booking_pin(uuid) TO authenticated;