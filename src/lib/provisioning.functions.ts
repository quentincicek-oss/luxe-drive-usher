// User Provisioning — server-only.
//
// Every function:
//   • runs behind `requireSupabaseAuth`
//   • validates caller with `has_role(auth.uid(),'admin')` (server-side)
//   • uses service-role admin client for Supabase Auth Admin API only,
//     loaded lazily inside the handler (never at module scope)
//   • never returns access tokens, refresh tokens, service-role keys,
//     invitation links, or plaintext passwords
//
// Data mutations go through SECURITY DEFINER RPCs in the migration
// (admin_provision_user_finalize / admin_set_user_suspension) which
// bundle mutation + audit in a single transaction.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const NameSchema = z.string().trim().min(1).max(100);
const PhoneSchema = z.string().trim().max(40).optional();
const LangSchema = z.string().trim().min(2).max(8).optional();
const EmployeeIdSchema = z.string().trim().regex(/^[A-Z0-9][A-Z0-9\-]{1,31}$/i, "invalid employee id").optional();

const ProvisionInput = z.object({
  accountType: z.enum(["admin", "driver", "passenger"]),
  email: EmailSchema,
  firstName: NameSchema,
  lastName: NameSchema,
  phone: PhoneSchema,
  preferredLanguage: LangSchema,
  employeeId: EmployeeIdSchema,
  isTestAccount: z.boolean().optional(),
  invitationMessage: z.string().trim().max(500).optional(), // metadata only
});

async function assertAdmin(ctx: any) {
  const { data: ok, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error("authorization check failed");
  if (!ok) throw new Error("forbidden");
}

export const provisionUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof ProvisionInput>) => ProvisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);

    if (data.accountType === "driver" && !data.employeeId) {
      throw new Error("employee_id required for driver");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up existing auth user by email (Admin API), paginating safely.
    let existingId: string | null = null;
    let page = 1;
    while (page <= 20) {
      const { data: list, error: listErr } = await (supabaseAdmin as any).auth.admin.listUsers({
        page, perPage: 200,
      });
      if (listErr) throw new Error("auth lookup failed");
      const hit = (list?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === data.email);
      if (hit) { existingId = hit.id; break; }
      if (!list?.users?.length || list.users.length < 200) break;
      page += 1;
    }

    let userId: string;
    let invited = false;

    if (existingId) {
      // Reject reassignment if the existing account already carries a conflicting role.
      const { data: roles } = await ctx.supabase.from("user_roles").select("role").eq("user_id", existingId);
      const held = new Set((roles ?? []).map((r: any) => r.role));
      const rejectFor = new Set<string>();
      if (data.accountType === "passenger" && (held.has("admin") || held.has("driver"))) rejectFor.add("passenger");
      if (data.accountType === "driver" && held.has("admin")) rejectFor.add("driver");
      if (rejectFor.size > 0) {
        throw new Error("email is linked to a conflicting account");
      }
      userId = existingId;
    } else {
      // Invite via Auth Admin API (Supabase sends the invitation email).
      const { data: invited1, error: invErr } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail(
        data.email,
        {
          data: {
            name: data.firstName,
            surname: data.lastName,
            provisioned_by_admin: true,
            invitation_note: data.invitationMessage ?? null,
          },
        },
      );
      if (invErr || !invited1?.user?.id) {
        // Do not surface raw provider error text.
        throw new Error("invitation failed");
      }
      userId = invited1.user.id;
      invited = true;
    }

    // Finalize atomically (profile + role + optional driver + audit).
    const { data: finalized, error: rpcErr } = await ctx.supabase.rpc("admin_provision_user_finalize", {
      _user_id: userId,
      _account_type: data.accountType,
      _profile: {
        email: data.email,
        name: data.firstName,
        surname: data.lastName,
        phone: data.phone ?? null,
        preferred_language: data.preferredLanguage ?? "en",
      },
      _driver: data.accountType === "driver" ? {
        employee_id: data.employeeId,
        full_name: `${data.firstName} ${data.lastName}`.trim(),
        email: data.email,
        phone: data.phone ?? null,
      } : null,
      _is_test: data.isTestAccount ?? false,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return {
      ok: true,
      userId,
      invited,
      accountType: data.accountType,
      result: finalized,
    };
  });

export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertAdmin(ctx);

    const { data: prof, error } = await ctx.supabase
      .from("profiles").select("email").eq("id", data.userId).maybeSingle();
    if (error || !prof?.email) throw new Error("user not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: invErr } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail(prof.email, {
      data: { resent_by_admin: true },
    });
    if (invErr) throw new Error("resend failed");

    await ctx.supabase.rpc("admin_audit_log", {
      _action: "user.invitation_resent",
      _entity_type: "user",
      _entity_id: data.userId,
      _previous: null,
      _next: { email: prof.email } as any,
      _reason: null,
    });
    return { ok: true };
  });

export const setUserSuspension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; suspend: boolean; reason?: string }) =>
    z.object({
      userId: z.string().uuid(),
      suspend: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }).parse(input),
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

export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    const { data, error } = await ctx.supabase.rpc("admin_list_managed_users");
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });
