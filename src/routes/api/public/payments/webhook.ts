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

  const { error } = await admin()
    .from("bookings")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      stripe_session_id: sessionId,
      ...(amountTotal !== null && { price: amountTotal }),
      status: "completed",
    })
    .eq("id", bookingId);

  if (error) console.error("Failed to mark booking paid:", error.message);
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
