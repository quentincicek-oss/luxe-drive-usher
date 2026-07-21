// Auto integration-health checks + refund initiation + delivery log readers.
// Admin-only.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type ProviderState = "healthy" | "degraded" | "down" | "unknown";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || data !== true) throw new Error("admin required");
}

async function recordHealth(
  ctx: { supabase: any },
  integration: string,
  status: ProviderState,
  latency: number | null,
  details: Record<string, unknown>,
) {
  await ctx.supabase.rpc("admin_record_integration_health", {
    _integration: integration,
    _status: status,
    _latency: latency,
    _details: details as never,
  });
}

/** Auto-check known providers without performing billable actions. */
export const opsRunHealthChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const results: Record<string, ProviderState> = {};

    // ---- Stripe: list a single balance record (no charge) ----
    const stripeConfigured = Boolean(process.env.STRIPE_SANDBOX_API_KEY && process.env.LOVABLE_API_KEY);
    if (stripeConfigured) {
      const t0 = Date.now();
      try {
        const stripe = createStripeClient("sandbox");
        await stripe.balance.retrieve();
        await recordHealth(context, "stripe", "healthy", Date.now() - t0, { environment: "sandbox" });
        results.stripe = "healthy";
      } catch (e) {
        await recordHealth(context, "stripe", "down", Date.now() - t0, { error: getStripeErrorMessage(e) });
        results.stripe = "down";
      }
    } else {
      await recordHealth(context, "stripe", "unknown", null, { reason: "not_configured" });
      results.stripe = "unknown";
    }

    // ---- Resend: GET /domains (no send) ----
    if (process.env.RESEND_API_KEY) {
      const t0 = Date.now();
      try {
        const res = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        const state: ProviderState = res.ok ? "healthy" : res.status === 401 ? "down" : "degraded";
        await recordHealth(context, "email_resend", state, Date.now() - t0, { http_status: res.status });
        results.email_resend = state;
      } catch (e) {
        await recordHealth(context, "email_resend", "down", Date.now() - t0, { error: String(e) });
        results.email_resend = "down";
      }
    } else {
      await recordHealth(context, "email_resend", "unknown", null, { reason: "not_configured" });
      results.email_resend = "unknown";
    }

    // ---- Twilio: GET Account resource ----
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token) {
      const t0 = Date.now();
      try {
        const auth = Buffer.from(`${sid}:${token}`).toString("base64");
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        const state: ProviderState = res.ok ? "healthy" : "down";
        await recordHealth(context, "sms_twilio", state, Date.now() - t0, { http_status: res.status });
        results.sms_twilio = state;
      } catch (e) {
        await recordHealth(context, "sms_twilio", "down", Date.now() - t0, { error: String(e) });
        results.sms_twilio = "down";
      }
    } else {
      await recordHealth(context, "sms_twilio", "unknown", null, { reason: "not_configured" });
      results.sms_twilio = "unknown";
    }

    // ---- Google Maps: simple JS API detection via key presence ----
    if (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY) {
      await recordHealth(context, "google_maps", "healthy", null, { source: "connector" });
      results.google_maps = "healthy";
    } else {
      await recordHealth(context, "google_maps", "unknown", null, { reason: "not_configured" });
      results.google_maps = "unknown";
    }

    return results;
  });

export const opsIntegrationHealthSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any).rpc("admin_integration_health_summary");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<{ integration: string; status: string; latency_ms: number | null; checked_at: string; details: string }>;
  });

export const opsRecentEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("email_deliveries")
      .select("id, to_email, template, subject, locale, status, provider, error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const opsRecentSms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("sms_deliveries")
      .select("id, to_phone, template, locale, status, provider, error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---- Refund initiation ---------------------------------------------------

export const adminRefundBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string; amountCents?: number | null; reason?: string; environment: StripeEnv }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid booking id");
    if (data.amountCents != null && (data.amountCents < 100 || data.amountCents > 10_000_00)) throw new Error("Invalid amount");
    if (data.environment !== "sandbox" && data.environment !== "live") throw new Error("Invalid environment");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: booking, error } = await context.supabase
      .from("bookings")
      .select("id, stripe_session_id, paid, price")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error || !booking) return { ok: false, error: "booking_not_found" };
    if (!booking.paid || !booking.stripe_session_id) return { ok: false, error: "not_paid" };

    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!pi) return { ok: false, error: "no_payment_intent" };

      const refund = await stripe.refunds.create({
        payment_intent: pi,
        ...(data.amountCents ? { amount: data.amountCents } : {}),
        reason: (data.reason as "duplicate" | "fraudulent" | "requested_by_customer") ?? "requested_by_customer",
        metadata: { bookingId: booking.id, initiatedBy: context.userId },
      });

      // Persist via service role (admin-only RLS on writes)
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("stripe_refunds").insert({
        booking_id: booking.id,
        stripe_refund_id: refund.id,
        stripe_payment_intent: pi,
        amount_cents: refund.amount ?? 0,
        currency: refund.currency ?? "usd",
        reason: data.reason ?? "requested_by_customer",
        status: refund.status ?? "pending",
        environment: data.environment,
        initiated_by: context.userId,
        raw: refund as unknown as Record<string, unknown>,
      });
      await supabaseAdmin.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
      return { ok: true, refundId: refund.id, status: refund.status };
    } catch (e) {
      return { ok: false, error: getStripeErrorMessage(e) };
    }
  });
