import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Passenger verification (driver submits PIN) ============
export const verifyPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; pin: string }) =>
    z.object({
      bookingId: z.string().uuid(),
      pin: z.string().regex(/^\d{4}$/),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: res, error } = await (supabase as any).rpc("verify_booking_pin", {
      _booking_id: data.bookingId,
      _pin: data.pin,
    });
    if (error) throw new Error(error.message);
    return res as { ok: boolean; reason?: string; attempts?: number; until?: string };
  });

// Manual verification (QR / NFC path) — records evidence without PIN math.
export const recordVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; method: "qr" | "nfc"; evidence?: Record<string, unknown> }) =>
    z.object({
      bookingId: z.string().uuid(),
      method: z.enum(["qr", "nfc"]),
      evidence: z.record(z.any()).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    const { error } = await (supabase as any).from("passenger_verifications").insert({
      booking_id: data.bookingId,
      method: data.method,
      verified_by_driver_id: drv?.id,
      evidence: data.evidence ?? {},
    });
    if (error) throw new Error(error.message);
    // Log workflow event
    const { data: a } = await (supabase as any).from("booking_assignments")
      .select("id, driver_id").eq("booking_id", data.bookingId).eq("is_current", true).maybeSingle();
    if (a) {
      await (supabase as any).from("driver_trip_events").insert({
        assignment_id: a.id, driver_id: a.driver_id, event: "verified", reason: data.method,
      });
    }
    return { ok: true };
  });

// ============ GPS ============
export const recordTripLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; kind: "arrival" | "trip_start" | "trip_end"; lat: number; lng: number; accuracy?: number }) =>
    z.object({
      bookingId: z.string().uuid(),
      kind: z.enum(["arrival", "trip_start", "trip_end"]),
      lat: z.number().gte(-90).lte(90),
      lng: z.number().gte(-180).lte(180),
      accuracy: z.number().nonnegative().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    if (!drv) throw new Error("driver profile not found");
    const { error } = await (supabase as any).from("trip_locations").insert({
      booking_id: data.bookingId, driver_id: drv.id, kind: data.kind,
      lat: data.lat, lng: data.lng, accuracy_m: data.accuracy,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const uploadRoutePoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; points: Array<{ seq: number; lat: number; lng: number; speed?: number; recordedAt: string }> }) =>
    z.object({
      bookingId: z.string().uuid(),
      points: z.array(z.object({
        seq: z.number().int().nonnegative(),
        lat: z.number(), lng: z.number(),
        speed: z.number().optional(),
        recordedAt: z.string(),
      })).max(500),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    if (data.points.length === 0) return { inserted: 0 };
    const { supabase, userId } = context as any;
    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    if (!drv) throw new Error("driver profile not found");
    const rows = data.points.map(p => ({
      booking_id: data.bookingId, driver_id: drv.id,
      seq: p.seq, lat: p.lat, lng: p.lng, speed_mps: p.speed, recorded_at: p.recordedAt,
    }));
    // Idempotent-ish: ignore conflicts on (booking_id, seq)
    const { error } = await (supabase as any).from("trip_route_points").upsert(rows, { onConflict: "booking_id,seq", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

// ============ No-show ============
export const submitNoShow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    bookingId: string; arrivalAt: string; waitedSeconds: number; attempts: number;
    arrivalLat?: number; arrivalLng?: number; reason?: string;
  }) => z.object({
    bookingId: z.string().uuid(),
    arrivalAt: z.string(),
    waitedSeconds: z.number().int().nonnegative(),
    attempts: z.number().int().nonnegative(),
    arrivalLat: z.number().optional(),
    arrivalLng: z.number().optional(),
    reason: z.string().max(500).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: settings } = await (supabase as any).from("verification_settings").select("min_waiting_seconds").eq("id", 1).maybeSingle();
    const min = settings?.min_waiting_seconds ?? 300;
    if (data.waitedSeconds < min) throw new Error(`Minimum wait ${min}s not met`);

    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    const { data: a } = await (supabase as any).from("booking_assignments")
      .select("id, driver_id").eq("booking_id", data.bookingId).eq("is_current", true).maybeSingle();
    if (!drv || !a) throw new Error("assignment not found");

    const { error: e1 } = await (supabase as any).from("no_show_reports").insert({
      booking_id: data.bookingId, driver_id: drv.id,
      arrival_at: data.arrivalAt, waited_seconds: data.waitedSeconds, attempts_count: data.attempts,
      arrival_lat: data.arrivalLat, arrival_lng: data.arrivalLng, reason: data.reason,
    });
    if (e1) throw new Error(e1.message);

    await (supabase as any).from("driver_trip_events").insert({
      assignment_id: a.id, driver_id: a.driver_id, event: "no_show", reason: data.reason,
    });
    await (supabase as any).from("booking_assignments")
      .update({ dispatch_status: "cancelled" }).eq("id", a.id);
    return { ok: true };
  });

// ============ Communication metadata ============
export const logCommunication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    bookingId: string; direction: "driver_to_passenger" | "passenger_to_driver";
    channel?: "phone" | "inapp"; durationSec?: number;
    status?: "initiated" | "connected" | "missed" | "failed";
  }) => z.object({
    bookingId: z.string().uuid(),
    direction: z.enum(["driver_to_passenger", "passenger_to_driver"]),
    channel: z.enum(["phone", "inapp"]).optional(),
    durationSec: z.number().int().nonnegative().optional(),
    status: z.enum(["initiated", "connected", "missed", "failed"]).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    const { error } = await (supabase as any).from("communication_events").insert({
      booking_id: data.bookingId,
      driver_id: drv?.id,
      direction: data.direction,
      channel: data.channel ?? "phone",
      duration_sec: data.durationSec ?? 0,
      status: data.status ?? "initiated",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Incidents ============
export const reportIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    bookingId?: string;
    category: "vehicle" | "passenger" | "traffic" | "road_closure" | "lost_property" | "emergency" | "other";
    severity?: "low" | "medium" | "high" | "critical";
    description: string;
  }) => z.object({
    bookingId: z.string().uuid().optional(),
    category: z.enum(["vehicle","passenger","traffic","road_closure","lost_property","emergency","other"]),
    severity: z.enum(["low","medium","high","critical"]).optional(),
    description: z.string().min(3).max(2000),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: drv } = await (supabase as any).from("driver_profiles").select("id").eq("user_id", userId).maybeSingle();
    if (!drv) throw new Error("driver profile not found");
    const { data: row, error } = await (supabase as any).from("incidents").insert({
      booking_id: data.bookingId,
      driver_id: drv.id,
      category: data.category,
      severity: data.severity ?? "medium",
      description: data.description,
    }).select("id").single();
    if (error) throw new Error(error.message);
    if (data.bookingId) {
      const { data: a } = await (supabase as any).from("booking_assignments")
        .select("id, driver_id").eq("booking_id", data.bookingId).eq("is_current", true).maybeSingle();
      if (a) {
        await (supabase as any).from("driver_trip_events").insert({
          assignment_id: a.id, driver_id: a.driver_id, event: "incident", reason: data.category,
        });
      }
    }
    return { id: row.id };
  });

// ============ Admin actions ============
// resolveIncident + reviewNoShow now call admin_resolve_incident /
// admin_review_no_show, which authorize via has_role and write the audit
// row inside the same transaction as the mutation. No separate audit call.

import type { Json } from "@/integrations/supabase/types";

export const resolveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "reviewing" | "resolved" | "dismissed"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["reviewing","resolved","dismissed"]),
      notes: z.string().max(2000).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }): Promise<Json | null> => {
    const { supabase } = context as any;
    const { data: next, error } = await (supabase as any).rpc("admin_resolve_incident", {
      _id: data.id, _status: data.status, _notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return next as Json | null;
  });

export const reviewNoShow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "rejected"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["approved","rejected"]),
      notes: z.string().max(2000).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }): Promise<Json | null> => {
    const { supabase } = context as any;
    const { data: next, error } = await (supabase as any).rpc("admin_review_no_show", {
      _id: data.id, _status: data.status, _notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return next as Json | null;
  });

export const updateVerificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pin_enabled?: boolean; qr_enabled?: boolean; nfc_enabled?: boolean; min_waiting_seconds?: number }) =>
    z.object({
      pin_enabled: z.boolean().optional(),
      qr_enabled: z.boolean().optional(),
      nfc_enabled: z.boolean().optional(),
      min_waiting_seconds: z.number().int().min(60).max(1800).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }): Promise<Json | null> => {
    const { supabase } = context as any;
    // Atomic admin RPC: authorizes via has_role, applies mutation and audit
    // write in the same transaction. No direct client write remains.
    const { data: next, error } = await (supabase as any).rpc("admin_upsert_verification_settings", {
      _payload: data as unknown as Json,
    });
    if (error) throw new Error(error.message);
    return next as Json | null;
  });
