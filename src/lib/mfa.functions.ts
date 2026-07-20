// Administrator MFA recovery — server-only.
//
// - resetAdminMfa: removes ALL TOTP factors on a target admin's account via
//   the Auth Admin API and writes an atomic audit event through the
//   admin_audit_mfa_reset RPC. The RPC enforces: caller is admin, target is
//   admin, no self-reset, reason required. Additionally requires the caller
//   to hold an AAL2 session.
// - listAdminMfaStatus: returns { user_id, email, hasVerifiedFactor } for
//   every admin so the panel can display status.
//
// TOTP secrets are never returned or logged. Factor deletion forces the
// target admin to re-enroll at next sign-in because the admin gate
// (/admin/mfa) transitions to the enroll phase when no verified factor
// exists.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ResetInput = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().trim().min(4).max(500),
});

function requireAal2(claims: Record<string, unknown> | undefined) {
  const aal = typeof claims?.aal === "string" ? (claims.aal as string) : null;
  if (aal !== "aal2") throw new Error("aal2 required");
}

export const resetAdminMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResetInput.parse(input))
  .handler(async ({ data, context }) => {
    requireAal2(context.claims as Record<string, unknown> | undefined);

    // Audit + authorization (caller admin, target admin, no self, reason present).
    // Runs in the caller's session so has_role() applies to auth.uid().
    const { error: auditErr } = await (
      context.supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }
    ).rpc("admin_audit_mfa_reset", {
      _target_user_id: data.targetUserId,
      _reason: data.reason,
    });
    if (auditErr) throw new Error(auditErr.message || "not permitted");

    // Only after authorization audit succeeds, load the service-role client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // List and delete every factor. TOTP factors force re-enrollment at
    // next login because the admin gate routes to /admin/mfa.
    const list = await (
      supabaseAdmin.auth.admin as unknown as {
        mfa: { listFactors: (a: { userId: string }) => Promise<{ data: { factors: { id: string }[] } | null; error: { message: string } | null }> };
      }
    ).mfa.listFactors({ userId: data.targetUserId });
    if (list.error) throw new Error("mfa list failed");
    const factors = list.data?.factors ?? [];

    for (const f of factors) {
      const del = await (
        supabaseAdmin.auth.admin as unknown as {
          mfa: { deleteFactor: (a: { userId: string; id: string }) => Promise<{ error: { message: string } | null }> };
        }
      ).mfa.deleteFactor({ userId: data.targetUserId, id: f.id });
      if (del.error) throw new Error("mfa delete failed");
    }

    return { ok: true as const, removed: factors.length };
  });

type AdminRow = { user_id: string; email: string | null };

export const listAdminMfaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireAal2(context.claims as Record<string, unknown> | undefined);

    const { data, error } = await (
      context.supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: AdminRow[] | null; error: { message: string } | null }> }
    ).rpc("admin_list_admins", {});
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { user_id: string; email: string | null; hasVerifiedFactor: boolean }[] = [];
    for (const row of data ?? []) {
      const list = await (
        supabaseAdmin.auth.admin as unknown as {
          mfa: { listFactors: (a: { userId: string }) => Promise<{ data: { factors: { status: string; factor_type: string }[] } | null }> };
        }
      ).mfa.listFactors({ userId: row.user_id });
      const factors = list.data?.factors ?? [];
      const hasVerifiedFactor = factors.some((f) => f.status === "verified");
      results.push({ user_id: row.user_id, email: row.email, hasVerifiedFactor });
    }
    return results;
  });

const EligibilityInput = z.object({}).optional();

// Server-authoritative Driver Sign In eligibility. Returns only { ok }.
// The RPC hides the specific reason. Callers surface the generic
// "Driver access is available only to accounts provisioned by HarborLine"
// message on any non-ok result.
export const driverSignInEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EligibilityInput.parse(input))
  .handler(async ({ context }) => {
    const { data, error } = await (
      context.supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }> }
    ).rpc("driver_signin_eligibility", {});
    if (error) return { ok: false as const };
    return { ok: data === true };
  });
