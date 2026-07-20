import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// All admin RPCs authorize inside the SECURITY DEFINER body (has_role) and
// write their audit row atomically with the mutation. The frontend must NOT
// call admin_audit_log separately for these paths.

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    Promise<{ data: Json | null; error: { message: string } | null }>;
};
const asRpc = (s: unknown) => s as RpcClient;

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>): Promise<Json | null> {
  const { data, error } = await asRpc(supabase).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// ============ Bookings ============
export const adminSetBookingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; status: string; reason?: string }) =>
    z.object({
      bookingId: z.string().uuid(),
      status: z.enum(["requested","pending","accepted","completed","cancelled"]),
      reason: z.string().max(500).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_set_booking_status", {
      _booking_id: data.bookingId, _status: data.status, _reason: data.reason ?? null,
    })
  );

// ============ Assignments ============
export const adminAssignDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; driverId: string; vehicleId?: string | null; reason?: string }) =>
    z.object({
      bookingId: z.string().uuid(),
      driverId: z.string().uuid(),
      vehicleId: z.string().uuid().nullable().optional(),
      reason: z.string().max(500).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_assign_driver", {
      _booking_id: data.bookingId, _driver_id: data.driverId,
      _vehicle_id: data.vehicleId ?? null, _reason: data.reason ?? null,
    })
  );

export const adminRemoveAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignmentId: string; reason?: string }) =>
    z.object({
      assignmentId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_remove_assignment", {
      _assignment_id: data.assignmentId, _reason: data.reason ?? null,
    })
  );

// ============ Drivers ============
const driverPayload = z.object({
  full_name: z.string().min(1).max(200),
  employee_id: z.string().min(1).max(50),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  photo_url: z.string().max(2000).nullable().optional(),
  license_number: z.string().max(100).nullable().optional(),
  license_expires_at: z.string().nullable().optional(),
  employment_status: z.enum(["active","inactive","vacation"]).optional(),
  availability_status: z.enum(["available","assigned","on_trip","offline","vacation"]).optional(),
  assigned_vehicle_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export const adminUpsertDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof driverPayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: driverPayload }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_driver", {
      _id: data.id ?? null, _payload: data.payload,
    })
  );

export const adminDeleteDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_driver", {
      _id: data.id, _reason: data.reason ?? null,
    })
  );

// ============ Vehicles ============
const vehiclePayload = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(["escalade","suburban","denali","other"]).optional(),
  license_plate: z.string().min(1).max(50),
  vin: z.string().max(100).nullable().optional(),
  model_year: z.union([z.number().int(), z.string(), z.null()]).optional(),
  seats: z.union([z.number().int(), z.string()]).optional(),
  status: z.enum(["active","maintenance"]).optional(),
  insurance_expires_at: z.string().nullable().optional(),
});
export const adminUpsertVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof vehiclePayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: vehiclePayload }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_vehicle", {
      _id: data.id ?? null, _payload: data.payload,
    })
  );

export const adminDeleteVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_vehicle", {
      _id: data.id, _reason: data.reason ?? null,
    })
  );

// ============ Discount rules ============
const discountPayload = z.object({
  min_miles: z.number().optional(),
  max_miles: z.number().optional(),
  flat_off: z.number().optional(),
  percent_off: z.number().optional(),
  active: z.boolean().optional(),
});
export const adminUpsertDiscount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof discountPayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: discountPayload }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_discount", {
      _id: data.id ?? null, _payload: data.payload,
    })
  );

export const adminDeleteDiscount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_discount", { _id: data.id })
  );

// ============ Referral campaigns ============
const campaignPayload = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  reward_percent: z.number().optional(),
  reward_flat_amount: z.number().nullable().optional(),
  reward_validity_days: z.number().int().optional(),
  per_referrer_limit: z.number().int().nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  active: z.boolean().optional(),
});
export const adminUpsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof campaignPayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: campaignPayload }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_campaign", {
      _id: data.id ?? null, _payload: data.payload,
    })
  );

export const adminToggleCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_toggle_campaign", { _id: data.id })
  );

export const adminDeleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_campaign", { _id: data.id })
  );

// ============ NFC tags ============
const nfcPayload = z.object({
  tag_uid: z.string().min(1).max(200),
  code_id: z.string().uuid(),
  label: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
});
export const adminUpsertNfcTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof nfcPayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: nfcPayload }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_nfc_tag", {
      _id: data.id ?? null, _payload: data.payload,
    })
  );

export const adminDeleteNfcTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_nfc_tag", { _id: data.id })
  );

// ============ Incident + no-show review (moved to atomic RPCs) ============
export const adminResolveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "reviewing" | "resolved" | "dismissed"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["reviewing","resolved","dismissed"]),
      notes: z.string().max(2000).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_resolve_incident", {
      _id: data.id, _status: data.status, _notes: data.notes ?? null,
    })
  );

export const adminReviewNoShow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "rejected"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["approved","rejected"]),
      notes: z.string().max(2000).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_review_no_show", {
      _id: data.id, _status: data.status, _notes: data.notes ?? null,
    })
  );
