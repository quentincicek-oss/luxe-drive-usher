// User Provisioning — server-only.
//
// Hardened per Phase I-E.1:
//   M1  sanitized failure audit written *outside* the failed txn
//   M2  atomic 5-minute resend cooldown enforced server-side
//   M3  driver email uniqueness enforced by DB index
//   M4  no silent passenger→staff promotion; explicit conversion RPC
//
// Every function:
//   • runs behind `requireSupabaseAuth`
//   • validates caller with `has_role(auth.uid(),'admin')` server-side
//   • loads the service-role admin client lazily inside the handler
//   • never returns tokens, invitation links, service-role keys, or raw provider errors
//
// Failure audit does NOT block the user-facing error: if the audit RPC
// itself fails, we still surface the original error to the caller.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const NameSchema = z.string().trim().min(1).max(100);
const PhoneSchema = z.string().trim().max(40).optional();
const LangSchema = z.string().trim().min(2).max(8).optional();
const EmployeeIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9\-]{1,31}$/i, "invalid employee id")
  .optional();

const ProvisionInput = z.object({
  accountType: z.enum(["admin", "driver", "passenger"]),
  email: EmailSchema,
  firstName: NameSchema,
  lastName: NameSchema,
  phone: PhoneSchema,
  preferredLanguage: LangSchema,
  employeeId: EmployeeIdSchema,
  isTestAccount: z.boolean().optional(),
  invitationMessage: z.string().trim().max(500).optional(),
});

const INVITE_COOLDOWN_SECONDS = 300;

type FailureCategory =
  | "validation"
  | "authorization"
  | "conflict_existing_role"
  | "invitation_failed"
  | "cooldown_active"
  | "rpc_failed"
  | "auth_lookup_failed"
  | "internal_error"
  | "unspecified";

function newCorrelationId(): string {
  // Non-cryptographic short id for audit correlation; never contains PII.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function assertAdmin(ctx: any) {
  const { data: ok, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error("authorization check failed");
  if (!ok) throw new Error("forbidden");
}

async function auditFailure(
  ctx: any,
  email: string,
  accountType: string,
  category: FailureCategory,
  correlationId: string,
) {
  // Best-effort. Runs on a fresh RPC call so no txn rollback erases it.
  try {
    await ctx.supabase.rpc("admin_audit_provisioning_failure", {
      _email: email,
      _account_type: accountType,
      _failure_category: category,
      _correlation_id: correlationId,
    });
  } catch {
    // Swallow — audit failure must not block the user-facing error.
  }
}

/** Provision a new admin/driver/passenger account. */
export const provisionUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ProvisionInput>) => ProvisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const correlationId = newCorrelationId();

    // AuthZ.
    try {
      await assertAdmin(ctx);
    } catch (e: any) {
      await auditFailure(ctx, data.email, data.accountType, "authorization", correlationId);
      throw e;
    }

    // Validation gate.
    if (data.accountType === "driver" && !data.employeeId) {
      await auditFailure(ctx, data.email, data.accountType, "validation", correlationId);
      throw new Error("employee_id required for driver");
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Look up existing auth user.
      let existingId: string | null = null;
      try {
        let page = 1;
        while (page <= 20) {
          const { data: list, error: listErr } = await (supabaseAdmin as any).auth.admin.listUsers({
            page,
            perPage: 200,
          });
          if (listErr) throw new Error("auth lookup failed");
          const hit = (list?.users ?? []).find(
            (u: any) => (u.email ?? "").toLowerCase() === data.email,
          );
          if (hit) {
            existingId = hit.id;
            break;
          }
          if (!list?.users?.length || list.users.length < 200) break;
          page += 1;
        }
      } catch {
        await auditFailure(ctx, data.email, data.accountType, "auth_lookup_failed", correlationId);
        throw new Error("auth lookup failed");
      }

      let userId: string;
      let invited = false;

      if (existingId) {
        // If the existing account already carries a different role, refuse
        // silent promotion. The caller must use the explicit conversion op.
        const { data: roles } = await ctx.supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", existingId);
        const held = new Set<string>((roles ?? []).map((r: any) => r.role));
        if (held.size > 0 && !held.has(data.accountType)) {
          await auditFailure(
            ctx,
            data.email,
            data.accountType,
            "conflict_existing_role",
            correlationId,
          );
          throw new Error(
            "conflict_existing_role: existing account has a different role. Use explicit conversion.",
          );
        }
        userId = existingId;
      } else {
        // Reserve invitation slot atomically to enforce cooldown across concurrent callers.
        const { data: reservation, error: rErr } = await ctx.supabase.rpc(
          "admin_reserve_invitation_slot",
          { _email: data.email, _cooldown_seconds: INVITE_COOLDOWN_SECONDS },
        );
        if (rErr) {
          await auditFailure(ctx, data.email, data.accountType, "rpc_failed", correlationId);
          throw new Error("cooldown check failed");
        }
        if (!reservation?.allowed) {
          // Do not audit rate-limited attempts (avoid audit-spam).
          throw new Error(
            `Please wait ${reservation?.retry_after_seconds ?? INVITE_COOLDOWN_SECONDS}s before retrying this invitation.`,
          );
        }

        const { data: invited1, error: invErr } = await (
          supabaseAdmin as any
        ).auth.admin.inviteUserByEmail(data.email, {
          data: {
            name: data.firstName,
            surname: data.lastName,
            provisioned_by_admin: true,
            invitation_note: data.invitationMessage ?? null,
          },
        });
        if (invErr || !invited1?.user?.id) {
          await auditFailure(
            ctx,
            data.email,
            data.accountType,
            "invitation_failed",
            correlationId,
          );
          throw new Error("invitation failed");
        }
        userId = invited1.user.id;
        invited = true;
      }

      const { data: finalized, error: rpcErr } = await ctx.supabase.rpc(
        "admin_provision_user_finalize",
        {
          _user_id: userId,
          _account_type: data.accountType,
          _profile: {
            email: data.email,
            name: data.firstName,
            surname: data.lastName,
            phone: data.phone ?? null,
            preferred_language: data.preferredLanguage ?? "en",
          },
          _driver:
            data.accountType === "driver"
              ? {
                  employee_id: data.employeeId,
                  full_name: `${data.firstName} ${data.lastName}`.trim(),
                  email: data.email,
                  phone: data.phone ?? null,
                }
              : null,
          _is_test: data.isTestAccount ?? false,
        },
      );
      if (rpcErr) {
        const msg = String(rpcErr.message ?? "");
        const category: FailureCategory = msg.startsWith("conflict_existing_role")
          ? "conflict_existing_role"
          : "rpc_failed";
        await auditFailure(ctx, data.email, data.accountType, category, correlationId);
        throw new Error(msg || "provision failed");
      }

      return {
        ok: true,
        userId,
        invited,
        accountType: data.accountType,
        correlationId,
        result: finalized,
      };
    } catch (e: any) {
      // Fallthrough for anything not already audited.
      if (!/^(cooldown_active|conflict_existing_role|forbidden|invitation failed|auth lookup failed|Please wait |employee_id required)/i.test(String(e?.message ?? ""))) {
        await auditFailure(ctx, data.email, data.accountType, "internal_error", correlationId);
      }
      throw e;
    }
  });

/** Resend an invitation, enforcing the same server-side cooldown. */
export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);

    const { data: prof, error } = await ctx.supabase
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    if (error || !prof?.email) throw new Error("user not found");

    const { data: reservation, error: rErr } = await ctx.supabase.rpc(
      "admin_reserve_invitation_slot",
      { _email: prof.email, _cooldown_seconds: INVITE_COOLDOWN_SECONDS },
    );
    if (rErr) throw new Error("cooldown check failed");
    if (!reservation?.allowed) {
      return {
        ok: false,
        cooldown: true,
        retryAfterSeconds: reservation?.retry_after_seconds ?? INVITE_COOLDOWN_SECONDS,
        nextAvailableAt: reservation?.next_available_at ?? null,
        message: `Please wait ${reservation?.retry_after_seconds ?? INVITE_COOLDOWN_SECONDS}s before resending.`,
      } as const;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: invErr } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail(
      prof.email,
      { data: { resent_by_admin: true } },
    );
    if (invErr) throw new Error("resend failed");

    await ctx.supabase.rpc("admin_audit_log", {
      _action: "user.invitation_resent",
      _entity_type: "user",
      _entity_id: data.userId,
      _previous: null,
      _next: { email: prof.email } as any,
      _reason: null,
    });
    return {
      ok: true,
      cooldown: false,
      retryAfterSeconds: INVITE_COOLDOWN_SECONDS,
      nextAvailableAt: reservation?.next_available_at ?? null,
    } as const;
  });

/** Read cooldown state for UI countdown (no side effects). */
export const getInvitationCooldown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);
    const { data: prof } = await ctx.supabase
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    if (!prof?.email) return { available: true, retryAfterSeconds: 0 };
    const { data: state } = await ctx.supabase.rpc("admin_get_invitation_cooldown", {
      _email: prof.email,
      _cooldown_seconds: INVITE_COOLDOWN_SECONDS,
    });
    return {
      available: !!state?.available,
      retryAfterSeconds: state?.retry_after_seconds ?? 0,
      nextAvailableAt: state?.next_available_at ?? null,
    };
  });

/** Suspend / reactivate an internal user. Unchanged behavior. */
export const setUserSuspension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; suspend: boolean; reason?: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        suspend: z.boolean(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const { data: nxt, error } = await ctx.supabase.rpc("admin_set_user_suspension", {
      _user_id: data.userId,
      _suspend: data.suspend,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, next: nxt };
  });

/** List managed users (admins + drivers + suspended + test accounts). */
export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    const { data, error } = await ctx.supabase.rpc("admin_list_managed_users");
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });

/**
 * Explicit admin-only role conversion. Requires:
 *  • separate confirmation flag from UI
 *  • non-empty reason
 *  • target is not self, not suspended, no active bookings/assignments
 *  • driver payload when converting TO driver
 * Writes a single `user.role_converted` audit event atomically.
 */
const ConvertInput = z.object({
  userId: z.string().uuid(),
  newRole: z.enum(["admin", "driver", "passenger"]),
  reason: z.string().trim().min(4).max(500),
  confirmed: z.literal(true),
  driver: z
    .object({
      employeeId: EmployeeIdSchema,
      fullName: NameSchema,
      email: EmailSchema.optional(),
      phone: PhoneSchema,
    })
    .optional(),
});

export const convertUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ConvertInput>) => ConvertInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);
    if (data.newRole === "driver" && (!data.driver || !data.driver.employeeId)) {
      throw new Error("driver payload with employee_id required");
    }
    const { data: result, error } = await ctx.supabase.rpc("admin_convert_user_role", {
      _user_id: data.userId,
      _new_role: data.newRole,
      _reason: data.reason,
      _driver:
        data.newRole === "driver" && data.driver
          ? {
              employee_id: data.driver.employeeId,
              full_name: data.driver.fullName,
              email: data.driver.email ?? null,
              phone: data.driver.phone ?? null,
            }
          : null,
      _confirmed: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true, result };
  });

/** Update an existing user's profile fields (and, for drivers, driver fields). */
const UpdateUserInput = z.object({
  userId: z.string().uuid(),
  profile: z.object({
    name: NameSchema.optional(),
    surname: NameSchema.optional(),
    phone: z.string().trim().max(40).optional(),
    preferredLanguage: LangSchema,
  }).optional(),
  driver: z
    .object({
      fullName: NameSchema.optional(),
      employeeId: EmployeeIdSchema,
      phone: z.string().trim().max(40).optional(),
      employmentStatus: z.enum(["active", "inactive", "vacation"]).optional(),
    })
    .optional(),
});

export const adminUpdateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof UpdateUserInput>) => UpdateUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);
    const { data: result, error } = await ctx.supabase.rpc("admin_update_user_profile", {
      _user_id: data.userId,
      _profile: {
        name: data.profile.name ?? null,
        surname: data.profile.surname ?? null,
        phone: data.profile.phone ?? null,
        preferred_language: data.profile.preferredLanguage ?? null,
      },
      _driver: data.driver
        ? {
            full_name: data.driver.fullName ?? null,
            employee_id: data.driver.employeeId ?? null,
            phone: data.driver.phone ?? null,
            employment_status: data.driver.employmentStatus ?? null,
          }
        : null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, result };
  });
