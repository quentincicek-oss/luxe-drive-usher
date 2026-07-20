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

    const rpc = context.supabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };

    // 1) Authorize + record REQUESTED. RPC enforces admin+admin, no self, reason present.
    const req = await rpc.rpc("admin_audit_mfa_reset_requested", {
      _target_user_id: data.targetUserId,
      _reason: data.reason,
    });
    if (req.error) throw new Error(req.error.message || "not permitted");

    // 2) Perform deletion with service-role client, tracking per-factor outcome.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminMfa = supabaseAdmin.auth.admin as unknown as {
      mfa: {
        listFactors: (a: { userId: string }) => Promise<{ data: { factors: { id: string }[] } | null; error: { message: string } | null }>;
        deleteFactor: (a: { userId: string; id: string }) => Promise<{ error: { message: string } | null }>;
      };
    };

    const recordOutcome = async (
      outcome: "completed" | "partial" | "failed",
      total: number,
      removed: number,
      error?: string,
    ) => {
      await rpc.rpc("admin_audit_mfa_reset_outcome", {
        _target_user_id: data.targetUserId,
        _outcome: outcome,
        _total: total,
        _removed: removed,
        _error: error ?? null,
      });
    };

    const list = await adminMfa.mfa.listFactors({ userId: data.targetUserId });
    if (list.error) {
      await recordOutcome("failed", 0, 0, `list: ${list.error.message}`);
      throw new Error("mfa list failed");
    }
    const factors = list.data?.factors ?? [];
    const total = factors.length;

    let removed = 0;
    let firstError: string | null = null;
    for (const f of factors) {
      const del = await adminMfa.mfa.deleteFactor({ userId: data.targetUserId, id: f.id });
      if (del.error) {
        if (!firstError) firstError = del.error.message || "delete failed";
        continue;
      }
      removed += 1;
    }

    if (total === 0) {
      await recordOutcome("completed", 0, 0);
      return { ok: true as const, removed: 0, total: 0, outcome: "completed" as const };
    }
    if (removed === total) {
      await recordOutcome("completed", total, removed);
      return { ok: true as const, removed, total, outcome: "completed" as const };
    }
    if (removed === 0) {
      await recordOutcome("failed", total, removed, firstError ?? undefined);
      throw new Error(firstError ?? "mfa delete failed");
    }
    await recordOutcome("partial", total, removed, firstError ?? undefined);
    throw new Error(
      `partial reset: ${removed}/${total} factors removed. Target may still hold a valid factor. ${firstError ?? ""}`.trim(),
    );
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
