import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

// C5 — idempotency. Returns true if this Stripe event has NOT been seen
// before (and reserves it). Retried webhooks return false and are skipped.
async function reserveEventOnce(eventId: string, eventType: string, env: StripeEnv): Promise<boolean> {
  const { error } = await admin()
    .from("stripe_events")
    .insert({ event_id: eventId, event_type: eventType, environment: env });
  if (!error) return true;
  // Postgres unique_violation = 23505
  const code = (error as { code?: string }).code;
  if (code === "23505") return false;
  // Any other error: treat as processed to avoid infinite retries; log for ops.
  console.error("stripe_events insert failed:", error.message);
  return false;
}

async function handleCheckoutCompleted(session: Record<string, unknown>) {
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const bookingId = metadata.bookingId;
  if (!bookingId) {
    console.error("checkout.session.completed missing bookingId metadata");
    return;
  }
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total / 100 : null;
  const sessionId = typeof session.id === "string" ? session.id : null;

  const { data: updated, error } = await admin()
    .from("bookings")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      stripe_session_id: sessionId,
      ...(amountTotal !== null && { price: amountTotal }),
      status: "completed",
    })
    .eq("id", bookingId)
    .select("id, pickup, dropoff, pickup_time, ride_type, passenger_id")
    .maybeSingle();

  if (error) { console.error("Failed to mark booking paid:", error.message); return; }
  if (!updated) return;

  // Fire-and-forget notifications. Never throw from webhook path.
  try {
    const { data: prof } = await admin()
      .from("profiles")
      .select("email, phone, preferred_language")
      .eq("id", (updated as { passenger_id: string }).passenger_id)
      .maybeSingle();
    const locale = ((prof as { preferred_language?: string } | null)?.preferred_language === "tr" ? "tr" : "en") as "en" | "tr";
    const u = updated as { id: string; pickup: string; dropoff: string; pickup_time: string; ride_type: string };
    const rideLabel = u.ride_type === "escalade" ? "Cadillac Escalade" : u.ride_type === "suburban" ? "Chevrolet Suburban" : "GMC Denali";
    const code = u.id.slice(0, 8).toUpperCase();
    const email = (prof as { email?: string } | null)?.email;
    const phone = (prof as { phone?: string } | null)?.phone;

    if (email) {
      const { sendTransactionalEmail } = await import("@/lib/email.server");
      await sendTransactionalEmail({
        to: email, template: "booking.confirmation", locale, bookingId: u.id,
        data: { pickup: u.pickup, dropoff: u.dropoff, pickup_time: u.pickup_time, vehicle: rideLabel, code },
      });
    }
    if (phone) {
      const { sendTransactionalSms } = await import("@/lib/sms.server");
      await sendTransactionalSms({
        to: phone, template: "booking.confirmation", locale, bookingId: u.id,
        data: { pickup: u.pickup, dropoff: u.dropoff, pickup_time: u.pickup_time, code },
      });
    }
  } catch (e) {
    console.error("Post-payment notification error:", e);
  }
}

async function handleRefund(refund: Record<string, unknown>, env: StripeEnv) {
  const metadata = (refund.metadata ?? {}) as Record<string, string>;
  const bookingId = metadata.bookingId;
  const refundId = typeof refund.id === "string" ? refund.id : null;
  if (!bookingId || !refundId) return;
  const amount = typeof refund.amount === "number" ? refund.amount : 0;
  const status = typeof refund.status === "string" ? refund.status : "unknown";
  const pi = typeof refund.payment_intent === "string" ? refund.payment_intent : null;
  await admin().from("stripe_refunds").upsert(
    {
      booking_id: bookingId,
      stripe_refund_id: refundId,
      stripe_payment_intent: pi,
      amount_cents: amount,
      currency: typeof refund.currency === "string" ? refund.currency : "usd",
      status,
      environment: env,
      raw: refund as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_refund_id" },
  );
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;

        try {
          const event = await verifyWebhook(request, env);
          const eventId = (event as unknown as { id?: string }).id;
          if (!eventId) {
            console.error("Webhook missing event id");
            return new Response("Missing event id", { status: 400 });
          }
          const first = await reserveEventOnce(eventId, event.type, env);
          if (!first) {
            // Already processed (Stripe retry). Return 200 so Stripe stops retrying.
            return Response.json({ received: true, duplicate: true });
          }
          if (event.type === "checkout.session.completed") {
            await handleCheckoutCompleted(event.data.object);
          } else if (event.type === "charge.refunded" || event.type === "refund.updated" || event.type === "refund.created") {
            await handleRefund(event.data.object as Record<string, unknown>, env);
          } else {
            console.log("Unhandled event:", event.type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
