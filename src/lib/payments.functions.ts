import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type Result = { clientSecret: string } | { error: string };

type AmenityLine = {
  amenity_code: string;
  amenity_name: string;
  quantity: number;
  price_delta_cents: number;
  complimentary: boolean;
};

export const createBookingCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid booking id");
    return data;
  })
  .handler(async ({ data, context }): Promise<Result> => {
    const { supabase, userId } = context;

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id, passenger_id, pickup, dropoff, ride_type, suggested_price, price, paid")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!booking || booking.passenger_id !== userId) return { error: "Booking not found" };
    if (booking.paid) return { error: "Already paid" };

    const baseAmount = Number(booking.price ?? booking.suggested_price ?? 0);
    if (!baseAmount || baseAmount < 1) return { error: "Invalid amount" };

    // Server-derived amenity lines (never trust client-submitted prices).
    const { data: amenityRows } = await supabase
      .from("booking_amenities")
      .select("amenity_code, amenity_name, quantity, price_delta_cents, complimentary")
      .eq("booking_id", booking.id);
    const amenities: AmenityLine[] = (amenityRows ?? []) as AmenityLine[];

    const { data: userRes } = await supabase.auth.getUser();
    const email = userRes.user?.email ?? undefined;

    const rideLabel =
      booking.ride_type === "escalade" ? "Cadillac Escalade" :
      booking.ride_type === "suburban" ? "Chevrolet Suburban" : "GMC Denali";

    try {
      const stripe = createStripeClient(data.environment);
      const line_items: Array<{
        quantity: number;
        price_data: { currency: string; unit_amount: number; product_data: { name: string; description?: string } };
      }> = [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(baseAmount * 100),
            product_data: { name: `HarborLine · ${rideLabel}`, description: `${booking.pickup} → ${booking.dropoff}` },
          },
        },
      ];

      for (const a of amenities) {
        if (a.complimentary || a.price_delta_cents <= 0) continue;
        line_items.push({
          quantity: Math.max(1, a.quantity),
          price_data: {
            currency: "usd",
            unit_amount: a.price_delta_cents,
            product_data: { name: `Amenity · ${a.amenity_name}` },
          },
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        ...(email && { customer_email: email }),
        line_items,
        payment_intent_data: {
          description: `HarborLine ride ${booking.id.slice(0, 8).toUpperCase()}`,
          metadata: { bookingId: booking.id, userId },
        },
        metadata: { bookingId: booking.id, userId },
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (e) {
      return { error: getStripeErrorMessage(e) };
    }
  });
