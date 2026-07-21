-- Phase 2A Fix 2: restrict live driver location access.
-- Rollback: DROP the three new policies and recreate the previous single policy:
--   CREATE POLICY "Authenticated read online drivers" ON public.drivers
--     FOR SELECT TO authenticated
--     USING ((is_online = true) OR (auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated read online drivers" ON public.drivers;

CREATE POLICY "drivers admin read all"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "drivers self read"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "drivers assigned passenger read"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.booking_assignments ba
      JOIN public.driver_profiles dp ON dp.id = ba.driver_id
      JOIN public.bookings b ON b.id = ba.booking_id
      WHERE dp.user_id = public.drivers.user_id
        AND b.passenger_id = auth.uid()
        AND ba.is_current = true
        AND ba.dispatch_status IN (
          'assigned'::dispatch_status,
          'accepted'::dispatch_status,
          'en_route'::dispatch_status,
          'arrived'::dispatch_status,
          'in_progress'::dispatch_status
        )
        AND b.status NOT IN (
          'completed'::booking_status,
          'cancelled'::booking_status
        )
    )
  );
