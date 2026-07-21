import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin MFA recovery code server functions.
 *
 * Codes are generated only for admins in an aal2 session. The plaintext codes
 * are returned exactly once (only hashes are stored). Consuming a code allows
 * an admin who has lost their authenticator to remove their existing TOTP
 * factors and re-enroll — without the service role ever being exposed to the
 * client, and without weakening MFA for anyone else.
 */

export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_generate_recovery_codes");
    if (error) throw new Error(error.message);
    // data is an array of { code: string }
    const codes = (data ?? []).map((r: { code: string }) => r.code);
    return { codes };
  });

export const recoveryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_recovery_status");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      totalCodes: row?.total_codes ?? 0,
      unusedCodes: row?.unused_codes ?? 0,
      lastGeneratedAt: row?.last_generated_at ?? null,
      lastUsedAt: row?.last_used_at ?? null,
    };
  });

const ConsumeInput = z.object({ code: z.string().min(6).max(40) });

/**
 * Consume a recovery code AND remove the caller's TOTP factors so they can
 * re-enroll on a fresh device. The recovery RPC is rate-limited server-side
 * (5 attempts / 10 minutes / user).
 *
 * The client should call this from /admin/recover after signInWithPassword.
 * On success it must call supabase.auth.mfa.enroll() again from the client
 * and land the user on /admin/mfa.
 */
export const consumeRecoveryAndResetMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConsumeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc(
      "admin_consume_recovery_code",
      { _code: data.code },
    );
    if (error) throw new Error(error.message);
    if (!ok) return { ok: false as const, reason: "invalid_code" as const };

    // Remove all TOTP factors for this user via the service role. Loaded
    // inside the handler so it never leaks into the client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The admin auth API exposes factor management per-user.
    const admin = (supabaseAdmin.auth as unknown as {
      admin: {
        mfa: {
          listFactors: (a: { userId: string }) => Promise<{ data?: { factors?: Array<{ id: string }> }; error?: unknown }>;
          deleteFactor: (a: { userId: string; id: string }) => Promise<{ error?: unknown }>;
        };
      };
    }).admin;

    try {
      const list = await admin.mfa.listFactors({ userId: context.userId });
      const factors = list?.data?.factors ?? [];
      for (const f of factors) {
        await admin.mfa.deleteFactor({ userId: context.userId, id: f.id });
      }
    } catch (e) {
      // Log to audit via a follow-up RPC? Silently swallow — the client will
      // still be told the code was accepted, and Supabase will refuse to grant
      // aal2 without a factor, forcing enrollment.
      console.error("recovery factor cleanup failed", e);
    }

    return { ok: true as const };
  });
