import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type Result = { clientSecret: string } | { error: string };

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

    const amount = Number(booking.price ?? booking.suggested_price ?? 0);
    if (!amount || amount < 1) return { error: "Invalid amount" };

    const { data: userRes } = await supabase.auth.getUser();
    const email = userRes.user?.email ?? undefined;

    const rideLabel =
      booking.ride_type === "escalade" ? "Cadillac Escalade" :
      booking.ride_type === "suburban" ? "Chevrolet Suburban" : "GMC Denali";

    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        ...(email && { customer_email: email }),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `HarborLine · ${rideLabel}`,
              description: `${booking.pickup} → ${booking.dropoff}`,
            },
          },
        }],
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
