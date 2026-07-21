// Server-only transactional email provider.
// Currently supports Resend via REST (no SDK — Worker-friendly).
// Safe no-op when RESEND_API_KEY is absent: records the attempt with
// status='skipped_no_provider'. Never throws.

import { createClient } from "@supabase/supabase-js";

export type EmailTemplate =
  | "booking.confirmation"
  | "booking.updated"
  | "booking.cancelled"
  | "driver.assigned"
  | "admin.provisioning";

export type EmailLocale = "en" | "tr";

export interface SendEmailInput {
  to: string;
  template: EmailTemplate;
  locale?: EmailLocale;
  data?: Record<string, string | number>;
  bookingId?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped_no_provider";
  providerId?: string;
  error?: string;
}

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

// --- Templates ------------------------------------------------------------

type Rendered = { subject: string; html: string; text: string };

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function frame(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050505;font-family:Georgia,serif;color:#f5f5f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0b0b0b;border:1px solid #1f1f1f;border-radius:12px">
<tr><td style="padding:32px">
<div style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:#D4AF37;letter-spacing:.14em;text-transform:uppercase;margin-bottom:24px">HarborLine</div>
${inner}
<hr style="border:none;border-top:1px solid #1f1f1f;margin:28px 0"/>
<div style="font-size:11px;color:#8a8a8a;line-height:1.6">HarborLine Executive Services · Concierge private transport<br/>Reply to this email for support.</div>
</td></tr></table></td></tr></table></body></html>`;
}

function render(t: EmailTemplate, locale: EmailLocale, d: Record<string, string | number>): Rendered {
  const tr = locale === "tr";
  const g = (en: string, turk: string) => (tr ? turk : en);
  switch (t) {
    case "booking.confirmation": {
      const subject = g("Your HarborLine ride is confirmed", "HarborLine rezervasyonunuz onaylandı");
      const body = `
        <h1 style="font-family:'Playfair Display',Georgia,serif;color:#f5f5f5;font-size:24px;margin:0 0 12px">${esc(g("Confirmed", "Onaylandı"))}</h1>
        <p style="color:#d5d5d5;font-size:15px;line-height:1.6">${esc(g("Thank you for choosing HarborLine.", "HarborLine'ı tercih ettiğiniz için teşekkür ederiz."))}</p>
        <table style="width:100%;margin-top:16px;font-size:14px;color:#d5d5d5">
          <tr><td style="padding:4px 0;color:#8a8a8a">${esc(g("Pickup", "Alış"))}</td><td>${esc(d.pickup)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a8a8a">${esc(g("Dropoff", "Bırakış"))}</td><td>${esc(d.dropoff)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a8a8a">${esc(g("When", "Zaman"))}</td><td>${esc(d.pickup_time)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a8a8a">${esc(g("Vehicle", "Araç"))}</td><td>${esc(d.vehicle)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a8a8a">${esc(g("Confirmation", "Onay Kodu"))}</td><td style="color:#D4AF37;font-family:monospace">${esc(d.code)}</td></tr>
        </table>`;
      const text = g(
        `HarborLine — Booking confirmed\nPickup: ${d.pickup}\nDropoff: ${d.dropoff}\nWhen: ${d.pickup_time}\nCode: ${d.code}\n`,
        `HarborLine — Rezervasyon onaylandı\nAlış: ${d.pickup}\nBırakış: ${d.dropoff}\nZaman: ${d.pickup_time}\nKod: ${d.code}\n`,
      );
      return { subject, html: frame(body), text };
    }
    case "booking.updated": {
      const subject = g("Your HarborLine reservation was updated", "HarborLine rezervasyonunuz güncellendi");
      const body = `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 12px">${esc(g("Reservation updated", "Rezervasyon güncellendi"))}</h1>
        <p style="color:#d5d5d5">${esc(g("Your reservation details have changed.", "Rezervasyon bilgileriniz değişti."))}</p>
        <p style="color:#d5d5d5">${esc(d.pickup)} → ${esc(d.dropoff)}<br/>${esc(d.pickup_time)}</p>`;
      return { subject, html: frame(body), text: `${subject}\n${d.pickup} -> ${d.dropoff} @ ${d.pickup_time}` };
    }
    case "booking.cancelled": {
      const subject = g("Your HarborLine reservation was cancelled", "HarborLine rezervasyonunuz iptal edildi");
      const body = `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 12px">${esc(g("Cancelled", "İptal edildi"))}</h1>
        <p style="color:#d5d5d5">${esc(g("Your reservation has been cancelled.", "Rezervasyonunuz iptal edildi."))}</p>
        ${d.refund ? `<p style="color:#D4AF37">${esc(g("A refund has been issued.", "İade işleme alındı."))}</p>` : ""}`;
      return { subject, html: frame(body), text: subject };
    }
    case "driver.assigned": {
      const subject = g("A driver has been assigned to your ride", "Yolculuğunuza şoför atandı");
      const body = `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 12px">${esc(g("Driver assigned", "Şoför atandı"))}</h1>
        <p style="color:#d5d5d5">${esc(d.driver_name)} · ${esc(d.vehicle)}</p>`;
      return { subject, html: frame(body), text: `${subject}\n${d.driver_name}` };
    }
    case "admin.provisioning": {
      const subject = "Your HarborLine internal account";
      const body = `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 12px">Account created</h1>
        <p style="color:#d5d5d5">You have been provisioned as <b>${esc(d.role)}</b>.</p>
        <p style="color:#d5d5d5">Sign in at <a style="color:#D4AF37" href="${esc(d.url)}">${esc(d.url)}</a>.</p>`;
      return { subject, html: frame(body), text: `${subject} — role: ${d.role} — ${d.url}` };
    }
  }
}

// --- Provider dispatch ----------------------------------------------------

async function sendViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "HarborLine <notify@harborline.local>";
  if (!apiKey) return { ok: false, error: "no_provider" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: `${res.status}: ${body.message || body.name || "resend_error"}` };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "resend_exception" };
  }
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const locale: EmailLocale = input.locale ?? "en";
  const to = String(input.to || "").trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, status: "failed", error: "invalid_email" };
  }
  const rendered = render(input.template, locale, input.data ?? {});
  const hasProvider = Boolean(process.env.RESEND_API_KEY);
  const insertBase = {
    to_email: to,
    template: input.template,
    subject: rendered.subject,
    locale,
    booking_id: input.bookingId ?? null,
    provider: hasProvider ? "resend" : null,
    meta: {} as Record<string, unknown>,
  };

  if (!hasProvider) {
    await (admin() as any).from("email_deliveries").insert({ ...insertBase, status: "skipped_no_provider" });
    return { ok: false, status: "skipped_no_provider", error: "no_provider" };
  }

  const providerRes = await sendViaResend({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
  if (!providerRes.ok) {
    await (admin() as any).from("email_deliveries").insert({ ...insertBase, status: "failed", error: providerRes.error?.slice(0, 500) });
    return { ok: false, status: "failed", error: providerRes.error };
  }
  await (admin() as any).from("email_deliveries").insert({
    ...insertBase, status: "sent", provider_id: providerRes.id ?? null, sent_at: new Date().toISOString(),
  });
  return { ok: true, status: "sent", providerId: providerRes.id };
}
