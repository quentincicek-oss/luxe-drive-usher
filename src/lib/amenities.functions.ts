import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Json | null; error: { message: string } | null }>;
};
const asRpc = (s: unknown) => s as RpcClient;

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>): Promise<Json | null> {
  const { data, error } = await asRpc(supabase).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------- Passenger ----------------

export const listActiveAmenities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rideType?: string | null }) =>
    z.object({ rideType: z.string().max(64).nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "list_active_amenities", { _ride_type: data.rideType ?? null }),
  );

export const setBookingAmenities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; amenityIds: string[] }) =>
    z.object({
      bookingId: z.string().uuid(),
      amenityIds: z.array(z.string().uuid()).max(20),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "set_booking_amenities", {
      _booking_id: data.bookingId,
      _amenity_ids: data.amenityIds,
    }),
  );

// ---------------- Admin ----------------

export const adminListAmenities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => callRpc(context.supabase, "admin_list_amenities", {}));

const amenityPayload = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  price_delta_cents: z.number().int().min(0).max(1_000_000),
  currency: z.string().length(3).optional(),
  complimentary: z.boolean().optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  allowed_ride_types: z.array(z.string()).optional(),
  icon: z.string().max(200).nullable().optional(),
  image_url: z.string().max(2000).nullable().optional(),
  internal_cost_cents: z.number().int().min(0).nullable().optional(),
  inventory_note: z.string().max(500).nullable().optional(),
});

export const adminUpsertAmenity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string | null; payload: z.infer<typeof amenityPayload> }) =>
    z.object({ id: z.string().uuid().nullable().optional(), payload: amenityPayload }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_upsert_amenity", {
      _id: data.id ?? null, _payload: data.payload,
    }),
  );

export const adminDeleteAmenity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_delete_amenity", { _id: data.id }),
  );
