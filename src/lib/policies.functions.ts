import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

/**
 * Batch 1: versioned Booking Policy foundation.
 *
 * All mutations are routed through SECURITY DEFINER RPCs that enforce
 * `has_role(auth.uid(),'admin')` inside the database. Every mutation is
 * audit-logged via `_audit_write` inside the RPC. The frontend must not
 * call `admin_audit_log` separately for these paths.
 */

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    Promise<{ data: Json | null; error: { message: string } | null }>;
  from: (table: string) => {
    select: (cols: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};
const asRpc = (s: unknown) => s as RpcClient;

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>): Promise<Json | null> {
  const { data, error } = await asRpc(supabase).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/* -------------------- Payload schemas -------------------- */

const feeType = z.enum(["fixed", "percentage", "full_fare", "none"]);
const serviceType = z.enum(["standard", "airport"]);

const cancellationPayload = z
  .object({
    policy_key: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200),
    service_type: serviceType.default("standard"),
    free_cancellation_enabled: z.boolean().default(true),
    free_cancellation_cutoff_hours: z.number().int().min(0).max(24 * 60).default(24),
    late_cancellation_enabled: z.boolean().default(true),
    fee_type: feeType,
    fee_fixed_cents: z.number().int().min(0).nullable().optional(),
    fee_percent_bps: z.number().int().min(0).max(10000).nullable().optional(),
    fee_cap_cents: z.number().int().min(0).nullable().optional(),
    allow_cancellation_inside_cutoff: z.boolean().default(true),
    admin_review_required: z.boolean().default(true),
    customer_summary: z.string().min(1).max(4000),
    internal_notes: z.string().max(4000).nullable().optional(),
    effective_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fee_type === "fixed" && (v.fee_fixed_cents == null))
      ctx.addIssue({ code: "custom", message: "Fixed fee requires a value in cents." });
    if (v.fee_type === "percentage" && v.fee_percent_bps == null)
      ctx.addIssue({ code: "custom", message: "Percentage fee requires basis points (0–10000)." });
    if ((v.fee_type === "none" || v.fee_type === "full_fare")) {
      if (v.fee_fixed_cents != null || v.fee_percent_bps != null)
        ctx.addIssue({ code: "custom", message: "Fee values must be empty for this fee type." });
    }
    if (v.fee_type === "none" && v.fee_cap_cents != null)
      ctx.addIssue({ code: "custom", message: "Fee cap cannot be set when fee type is none." });
  });

const noShowPayload = z
  .object({
    policy_key: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200),
    service_type: serviceType,
    no_show_enabled: z.boolean().default(true),
    min_wait_seconds: z.number().int().min(0).max(6 * 60 * 60),
    required_contact_attempts: z.number().int().min(0).max(10).default(1),
    fee_type: feeType,
    fee_fixed_cents: z.number().int().min(0).nullable().optional(),
    fee_percent_bps: z.number().int().min(0).max(10000).nullable().optional(),
    fee_cap_cents: z.number().int().min(0).nullable().optional(),
    automatic_charge_enabled: z.boolean().default(false),
    admin_review_required: z.boolean().default(true),
    customer_summary: z.string().min(1).max(4000),
    internal_notes: z.string().max(4000).nullable().optional(),
    effective_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fee_type === "fixed" && v.fee_fixed_cents == null)
      ctx.addIssue({ code: "custom", message: "Fixed fee requires a value in cents." });
    if (v.fee_type === "percentage" && v.fee_percent_bps == null)
      ctx.addIssue({ code: "custom", message: "Percentage fee requires basis points (0–10000)." });
    if ((v.fee_type === "none" || v.fee_type === "full_fare")) {
      if (v.fee_fixed_cents != null || v.fee_percent_bps != null)
        ctx.addIssue({ code: "custom", message: "Fee values must be empty for this fee type." });
    }
    if (v.fee_type === "none" && v.fee_cap_cents != null)
      ctx.addIssue({ code: "custom", message: "Fee cap cannot be set when fee type is none." });
  });

/* -------------------- Cancellation policy fns -------------------- */

export const adminListCancellationPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => callRpc(context.supabase, "admin_list_cancellation_policies", {}));

export const adminCreateCancellationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: z.input<typeof cancellationPayload> }) =>
    z.object({ payload: cancellationPayload }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_create_cancellation_policy", { _payload: data.payload }),
  );

export const adminCreateCancellationPolicyVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { policy_key: string; payload: z.input<typeof cancellationPayload> }) =>
    z.object({ policy_key: z.string().min(1), payload: cancellationPayload }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_create_cancellation_policy_version", {
      _policy_key: data.policy_key,
      _payload: data.payload,
    }),
  );

export const adminActivateCancellationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_activate_cancellation_policy", {
      _id: data.id,
      _reason: data.reason ?? null,
    }),
  );

export const adminDeactivateCancellationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_deactivate_cancellation_policy", {
      _id: data.id,
      _reason: data.reason ?? null,
    }),
  );

/* -------------------- No-show policy fns -------------------- */

export const adminListNoShowPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => callRpc(context.supabase, "admin_list_no_show_policies", {}));

export const adminCreateNoShowPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: z.input<typeof noShowPayload> }) =>
    z.object({ payload: noShowPayload }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_create_no_show_policy", { _payload: data.payload }),
  );

export const adminCreateNoShowPolicyVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { policy_key: string; payload: z.input<typeof noShowPayload> }) =>
    z.object({ policy_key: z.string().min(1), payload: noShowPayload }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_create_no_show_policy_version", {
      _policy_key: data.policy_key,
      _payload: data.payload,
    }),
  );

export const adminActivateNoShowPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_activate_no_show_policy", {
      _id: data.id,
      _reason: data.reason ?? null,
    }),
  );

export const adminDeactivateNoShowPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_deactivate_no_show_policy", {
      _id: data.id,
      _reason: data.reason ?? null,
    }),
  );
