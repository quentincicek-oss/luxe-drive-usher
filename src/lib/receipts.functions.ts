import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomInt } from "crypto";

function hashCode(code: string, salt: string) {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

const OTP_TTL_MINUTES = 10;

export const requestReceiptOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid booking id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify booking belongs to caller
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id, passenger_id")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking || booking.passenger_id !== userId) throw new Error("Booking not found");

    // Get user email
    const { data: userRes } = await supabase.auth.getUser();
    const email = userRes.user?.email;
    if (!email) throw new Error("No email on file");

    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = hashCode(code, data.bookingId);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

    // Invalidate previous unconsumed codes for this booking
    await supabase
      .from("receipt_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("booking_id", data.bookingId)
      .is("consumed_at", null);

    const { error: insErr } = await supabase.from("receipt_verifications").insert({
      booking_id: data.bookingId,
      passenger_id: userId,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(insErr.message);

    // Best-effort email delivery via Lovable AI Gateway is out of scope here;
    // fall back to returning the code so it can also be displayed to the user
    // for demo/preview. In production, hook this to a transactional email.
    return { ok: true, email, devCode: code, ttlMinutes: OTP_TTL_MINUTES };
  });

export const verifyReceiptOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string; code: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid booking id");
    if (!/^\d{4,8}$/.test(data.code)) throw new Error("Invalid code");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("receipt_verifications")
      .select("id, code_hash, expires_at, consumed_at, attempts")
      .eq("booking_id", data.bookingId)
      .eq("passenger_id", userId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = rows?.[0];
    if (!row) return { ok: false, reason: "invalid" as const };
    if (row.attempts >= 6) return { ok: false, reason: "tooMany" as const };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "invalid" as const };

    const expected = hashCode(data.code, data.bookingId);
    if (expected !== row.code_hash) {
      await supabase.from("receipt_verifications").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return { ok: false, reason: "invalid" as const };
    }

    await supabase.from("receipt_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

    // Load booking + profile for the receipt payload
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, pickup, dropoff, pickup_time, ride_type, passengers, suggested_price, price, status, paid, paid_at, created_at")
      .eq("id", data.bookingId)
      .maybeSingle();
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, surname, email")
      .eq("id", userId)
      .maybeSingle();

    return { ok: true as const, booking, profile };
  });
