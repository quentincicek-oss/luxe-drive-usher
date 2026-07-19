
-- Ride reviews
CREATE TABLE public.ride_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_reviews TO authenticated;
GRANT ALL ON public.ride_reviews TO service_role;

ALTER TABLE public.ride_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger manages own reviews" ON public.ride_reviews
  FOR ALL TO authenticated
  USING (auth.uid() = passenger_id)
  WITH CHECK (auth.uid() = passenger_id);

CREATE POLICY "Admins read reviews" ON public.ride_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ride_reviews_updated_at
  BEFORE UPDATE ON public.ride_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Receipt verification (email OTP)
CREATE TABLE public.receipt_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipt_verif_booking ON public.receipt_verifications(booking_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_verifications TO authenticated;
GRANT ALL ON public.receipt_verifications TO service_role;

ALTER TABLE public.receipt_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Passenger manages own verifications" ON public.receipt_verifications
  FOR ALL TO authenticated
  USING (auth.uid() = passenger_id)
  WITH CHECK (auth.uid() = passenger_id);

-- Bookings: payment fields
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS receipt_url text;
