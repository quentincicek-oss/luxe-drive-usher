// Server-only SMS provider (Twilio REST). Safe no-op when credentials absent.
// Validates E.164, respects opt-outs, never throws to caller.

import { createClient } from "@supabase/supabase-js";

export type SmsTemplate =
  | "booking.confirmation"
  | "booking.updated"
  | "booking.cancelled"
  | "driver.assigned"
  | "driver.arrived";

export type SmsLocale = "en" | "tr";

export interface SendSmsInput {
  to: string;                  // E.164 e.g. +12125551212
  template: SmsTemplate;
  locale?: SmsLocale;
  data?: Record<string, string | number>;
  bookingId?: string | null;
}

export interface SendSmsResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped_no_provider" | "skipped_opt_out" | "invalid_number";
  providerId?: string;
  error?: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

function render(t: SmsTemplate, locale: SmsLocale, d: Record<string, string | number>): string {
  const tr = locale === "tr";
  const g = (en: string, turk: string) => (tr ? turk : en);
  const optOut = g(" Reply STOP to opt out.", " Çıkmak için STOP yazın.");
  switch (t) {
    case "booking.confirmation":
      return g(
        `HarborLine: Booking confirmed. ${d.pickup} to ${d.dropoff} at ${d.pickup_time}. Code ${d.code}.`,
        `HarborLine: Rezervasyon onaylandı. ${d.pickup} → ${d.dropoff}, ${d.pickup_time}. Kod ${d.code}.`,
      ) + optOut;
    case "booking.updated":
      return g(
        `HarborLine: Reservation updated to ${d.pickup_time}.`,
        `HarborLine: Rezervasyon güncellendi (${d.pickup_time}).`,
      ) + optOut;
    case "booking.cancelled":
      return g(
        `HarborLine: Your reservation has been cancelled.`,
        `HarborLine: Rezervasyonunuz iptal edildi.`,
      ) + optOut;
    case "driver.assigned":
      return g(
        `HarborLine: ${d.driver_name} (${d.vehicle}) assigned to your ride.`,
        `HarborLine: ${d.driver_name} (${d.vehicle}) yolculuğunuza atandı.`,
      ) + optOut;
    case "driver.arrived":
      return g(
        `HarborLine: Your driver has arrived at the pickup point.`,
        `HarborLine: Şoförünüz alış noktasında.`,
      ) + optOut;
  }
}

async function sendViaTwilio(input: { to: string; body: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "no_provider" };

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const form = new URLSearchParams({ To: input.to, From: from, Body: input.body });
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: string };
    if (!res.ok) return { ok: false, error: `${res.status}: ${body.message || body.code || "twilio_error"}` };
    return { ok: true, id: body.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "twilio_exception" };
  }
}

export async function sendTransactionalSms(input: SendSmsInput): Promise<SendSmsResult> {
  const locale: SmsLocale = input.locale ?? "en";
  const to = String(input.to || "").trim();
  const insertBase = {
    to_phone: to,
    template: input.template,
    locale,
    booking_id: input.bookingId ?? null,
    provider: null as string | null,
    meta: {} as Record<string, unknown>,
  };

  if (!E164.test(to)) {
    await (admin() as any).from("sms_deliveries").insert({ ...insertBase, status: "invalid_number", error: "not_e164" });
    return { ok: false, status: "invalid_number", error: "not_e164" };
  }

  // Opt-out check
  const { data: opt } = await (admin() as any).from("sms_opt_outs").select("phone").eq("phone", to).maybeSingle();
  if (opt) {
    await (admin() as any).from("sms_deliveries").insert({ ...insertBase, status: "skipped_opt_out" });
    return { ok: false, status: "skipped_opt_out" };
  }

  const hasProvider = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  if (!hasProvider) {
    await (admin() as any).from("sms_deliveries").insert({ ...insertBase, status: "skipped_no_provider" });
    return { ok: false, status: "skipped_no_provider", error: "no_provider" };
  }

  const body = render(input.template, locale, input.data ?? {});
  insertBase.provider = "twilio";
  const providerRes = await sendViaTwilio({ to, body });
  if (!providerRes.ok) {
    await (admin() as any).from("sms_deliveries").insert({ ...insertBase, status: "failed", error: providerRes.error?.slice(0, 500) });
    return { ok: false, status: "failed", error: providerRes.error };
  }
  await (admin() as any).from("sms_deliveries").insert({
    ...insertBase, status: "sent", provider_id: providerRes.id ?? null, sent_at: new Date().toISOString(),
  });
  return { ok: true, status: "sent", providerId: providerRes.id };
}
