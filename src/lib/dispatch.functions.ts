import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Allowed dispatch transitions — mirrored on the server via advance_assignment().
export type DispatchStatus =
  | "pending" | "assigned" | "accepted" | "en_route"
  | "arrived" | "in_progress" | "completed" | "cancelled";

// C1 + C2 + H1 — the ONLY sanctioned way for a driver/admin to move a trip forward.
// Enforces state machine, ownership, verification-before-start, event logging,
// and bookings.status sync (H2) inside a single SECURITY DEFINER RPC.
export const advanceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignmentId: string; next: DispatchStatus; reason?: string }) =>
    z.object({
      assignmentId: z.string().uuid(),
      next: z.enum([
        "pending","assigned","accepted","en_route",
        "arrived","in_progress","completed","cancelled",
      ]),
      reason: z.string().max(500).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) =>
        Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: res, error } = await supabase.rpc("advance_assignment", {
      _assignment_id: data.assignmentId,
      _next_status: data.next,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return res as { ok: boolean; status: string };
  });

// C4 — booking creation with SERVER-SIDE pricing. The browser can pass any
// suggested_price it likes; we ignore it. The RPC derives price from ride_type.
// Structured address fields (lat/lng/place_id/components) are optional — the
// server bounds-checks coordinates and stores them alongside the free-text
// pickup/dropoff so downstream systems (dispatch, receipts) have precise data.
const componentSchema = z
  .object({
    street_number: z.string().max(20).optional(),
    route: z.string().max(200).optional(),
    subpremise: z.string().max(50).optional(),
    locality: z.string().max(120).optional(),
    admin_area_level_1: z.string().max(120).optional(),
    admin_area_level_2: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    country_code: z.string().max(4).optional(),
    postal_code: z.string().max(20).optional(),
  })
  .partial()
  .optional();

export const createBookingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    pickup: string; dropoff: string; pickupTime: string;
    passengers: number; rideType: "escalade" | "suburban" | "denali";
    pickupLat?: number | null; pickupLng?: number | null;
    pickupPlaceId?: string | null;
    pickupComponents?: Record<string, string> | null;
    dropoffLat?: number | null; dropoffLng?: number | null;
    dropoffPlaceId?: string | null;
    dropoffComponents?: Record<string, string> | null;
  }) => z.object({
    pickup: z.string().trim().min(2).max(300),
    dropoff: z.string().trim().min(2).max(300),
    pickupTime: z.string().datetime(),
    passengers: z.number().int().min(1).max(7),
    rideType: z.enum(["escalade","suburban","denali"]),
    pickupLat: z.number().min(-90).max(90).nullable().optional(),
    pickupLng: z.number().min(-180).max(180).nullable().optional(),
    pickupPlaceId: z.string().max(255).nullable().optional(),
    pickupComponents: componentSchema.nullable(),
    dropoffLat: z.number().min(-90).max(90).nullable().optional(),
    dropoffLng: z.number().min(-180).max(180).nullable().optional(),
    dropoffPlaceId: z.string().max(255).nullable().optional(),
    dropoffComponents: componentSchema.nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) =>
        Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: id, error } = await supabase.rpc("create_booking", {
      _pickup: data.pickup,
      _dropoff: data.dropoff,
      _pickup_time: data.pickupTime,
      _passengers: data.passengers,
      _ride_type: data.rideType,
      _pickup_lat: data.pickupLat ?? null,
      _pickup_lng: data.pickupLng ?? null,
      _pickup_place_id: data.pickupPlaceId ?? null,
      _pickup_components: data.pickupComponents ?? null,
      _dropoff_lat: data.dropoffLat ?? null,
      _dropoff_lng: data.dropoffLng ?? null,
      _dropoff_place_id: data.dropoffPlaceId ?? null,
      _dropoff_components: data.dropoffComponents ?? null,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

// C3 — Passenger-only PIN retrieval via SECURITY DEFINER RPC. Returns null
// once the trip has been verified (PIN is single-use).
export const getMyBookingPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) =>
    z.object({ bookingId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) =>
        Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: pin, error } = await supabase.rpc("get_my_booking_pin", {
      _booking_id: data.bookingId,
    });
    if (error) throw new Error(error.message);
    return { pin: (pin as string | null) ?? null };
  });
