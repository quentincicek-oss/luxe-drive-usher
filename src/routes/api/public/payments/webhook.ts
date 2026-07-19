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
