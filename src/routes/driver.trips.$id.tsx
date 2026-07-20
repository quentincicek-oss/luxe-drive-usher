import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { DriverShell } from "@/components/driver/DriverShell";
import { AssignmentDetailCard } from "@/components/driver/AssignmentDetailCard";
import { WorkflowStepper } from "@/components/driver/WorkflowStepper";
import { NavigateButton } from "@/components/driver/NavigateSheet";
import { VerificationSlot } from "@/components/driver/VerificationSlot";
import { NoShowModal } from "@/components/driver/NoShowModal";
import { IncidentModal } from "@/components/driver/IncidentModal";
import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";
import { emit } from "@/lib/notifications";
import {
  recordTripLocation, uploadRoutePoints, logCommunication,
} from "@/lib/trust.functions";
import { toast } from "sonner";
import { PhoneCall, Radio, AlertTriangle, XCircle, UserX } from "lucide-react";

export const Route = createFileRoute("/driver/trips/$id")({
  component: TripDetail,
});

const RIDE_LABEL: Record<string, string> = {
  escalade: "Cadillac Escalade",
  suburban: "Chevrolet Suburban",
  denali: "GMC Yukon Denali",
};

function tryGeolocate(): Promise<GeolocationPosition | null> {
  return new Promise((res) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res(p),
      () => res(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );
  });
}

function TripDetail() {
  const { id } = Route.useParams();
  useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showNoShow, setShowNoShow] = useState(false);
  const [showIncident, setShowIncident] = useState(false);
  const seqRef = useRef(0);
  const arrivedAtRef = useRef<Date | null>(null);

  const recordLoc = useServerFn(recordTripLocation);
  const uploadPoints = useServerFn(uploadRoutePoints);
  const logComm = useServerFn(logCommunication);

  const q = useQuery({
    queryKey: ["driver", "trip", id],
    queryFn: async () => {
      const { data: a } = await (supabase as any)
        .from("booking_assignments")
        .select("id, driver_id, vehicle_id, dispatch_status, booking_id, bookings:booking_id(id, passenger_id, pickup, dropoff, pickup_time, passengers, ride_type, notes, profiles:passenger_id(name))")
        .eq("id", id).maybeSingle();
      if (!a) return null;
      const [vehicle, ver, settings] = await Promise.all([
        a.vehicle_id
          ? (supabase as any).from("vehicles").select("name, license_plate, model_year").eq("id", a.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
        (supabase as any).from("passenger_verifications").select("id").eq("booking_id", a.booking_id).limit(1).maybeSingle(),
        (supabase as any).from("verification_settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      return { ...a, vehicle: vehicle.data, verified: !!ver.data, settings: settings.data ?? { pin_enabled: true, qr_enabled: false, nfc_enabled: false, min_waiting_seconds: 300 } };
    },
  });

  const a = q.data;
  const verified = !!a?.verified;
  const status: DispatchStatus | undefined = a?.dispatch_status;

  // GPS breadcrumbs while en_route/in_progress
  useEffect(() => {
    if (!a) return;
    if (status !== "en_route" && status !== "in_progress") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      async (pos) => {
        try {
          await uploadPoints({ data: {
            bookingId: a.booking_id,
            points: [{
              seq: seqRef.current++,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speed: pos.coords.speed ?? undefined,
              recordedAt: new Date().toISOString(),
            }],
          }});
        } catch { /* offline-tolerant: swallow */ }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [status, a?.booking_id]);

  async function logEvent(event: string, reason?: string) {
    if (!a?.driver_id) return;
    await (supabase as any).from("driver_trip_events").insert({
      assignment_id: a.id, driver_id: a.driver_id, event, reason: reason ?? null,
    });
  }

  async function advance(next: DispatchStatus, event: string, notify?: () => void, gpsKind?: "arrival" | "trip_start" | "trip_end") {
    if (!a) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("booking_assignments").update({ dispatch_status: next }).eq("id", a.id);
      if (error) throw error;
      await logEvent(event);
      if (gpsKind) {
        const pos = await tryGeolocate();
        if (pos) await recordLoc({ data: {
          bookingId: a.booking_id, kind: gpsKind,
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }});
        if (gpsKind === "arrival") arrivedAtRef.current = new Date();
      }
      notify?.();
      toast.success("Updated");
      q.refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Update failed");
    } finally { setBusy(false); }
  }

  async function rejectAssignment() {
    if (!window.confirm("Reject this assignment?")) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("booking_assignments")
        .update({ dispatch_status: "cancelled", is_current: false }).eq("id", a!.id);
      if (error) throw error;
      await logEvent("rejected");
      toast.success("Assignment rejected");
      navigate({ to: "/driver/trips" });
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  if (q.isLoading) return <DriverShell title="Trip"><div className="text-sm text-muted-foreground">Loading…</div></DriverShell>;
  if (!a) return <DriverShell title="Trip"><div className="text-sm text-muted-foreground">Trip not found.</div></DriverShell>;

  const b = a.bookings ?? {};
  const firstName = b.profiles?.name || "Passenger";
  const vehicleLabel = a.vehicle
    ? `${a.vehicle.model_year ? a.vehicle.model_year + " " : ""}${a.vehicle.name}${a.vehicle.license_plate ? " · " + a.vehicle.license_plate : ""}`
    : RIDE_LABEL[b.ride_type] || null;

  const primary = (() => {
    switch (status) {
      case "pending":
      case "assigned":
        return { label: "Accept assignment", onClick: () => advance("accepted", "accepted", () => emit({ type: "driver.accepted", bookingId: b.id, driverName: firstName })) };
      case "accepted":
        return { label: "Start navigating to pickup", onClick: () => advance("en_route", "en_route") };
      case "en_route":
        return { label: "I've arrived", onClick: () => advance("arrived", "arrived", () => emit({ type: "driver.arrived", bookingId: b.id }), "arrival") };
      case "arrived":
        return verified
          ? { label: "Start trip", onClick: () => advance("in_progress", "started", () => emit({ type: "trip.started", bookingId: b.id }), "trip_start") }
          : { label: "Waiting for passenger", onClick: async () => { await logEvent("waiting"); toast.success("Marked waiting"); } };
      case "in_progress":
        return { label: "Complete trip", onClick: () => advance("completed", "completed", () => emit({ type: "trip.completed", bookingId: b.id }), "trip_end") };
      default:
        return null;
    }
  })();

  return (
    <DriverShell title="Trip">
      <div className="space-y-5">
        <AssignmentDetailCard
          passengerFirstName={firstName}
          pickup={b.pickup}
          dropoff={b.dropoff}
          pickupTime={b.pickup_time}
          passengers={b.passengers ?? 1}
          notes={b.notes}
          vehicleLabel={vehicleLabel}
        />

        <div className="rounded-2xl border border-border/60 bg-surface p-5">
          <div className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">Workflow</div>
          <WorkflowStepper status={status!} verified={verified} />
        </div>

        {status === "en_route" && <NavigateButton destination={b.pickup} />}
        {status === "in_progress" && <NavigateButton destination={b.dropoff} />}

        {status === "arrived" && (
          <VerificationSlot
            bookingId={a.booking_id}
            settings={a.settings}
            verified={verified}
            onVerified={() => q.refetch()}
          />
        )}

        {primary && (
          <button
            onClick={primary.onClick}
            disabled={busy}
            className="w-full min-h-[56px] rounded-full bg-gold-gradient px-5 py-3 text-sm font-medium text-primary-foreground shadow-gold disabled:opacity-50"
          >
            {primary.label}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={PhoneCall} label="Contact passenger" onClick={async () => {
            await logComm({ data: { bookingId: a.booking_id, direction: "driver_to_passenger", channel: "phone", status: "initiated" } });
            toast.success("Logged");
          }} />
          <ActionButton icon={Radio} label="Contact dispatch" onClick={async () => { await logEvent("dispatch_contacted"); toast.success("Logged"); }} />
          {(status === "arrived" || status === "en_route") && (
            <ActionButton icon={UserX} label="Passenger no-show" onClick={() => setShowNoShow(true)} tone="warn" />
          )}
          <ActionButton icon={AlertTriangle} label="Report incident" onClick={() => setShowIncident(true)} tone="warn" />
          {(status === "pending" || status === "assigned") && (
            <ActionButton icon={XCircle} label="Reject assignment" onClick={rejectAssignment} tone="danger" />
          )}
        </div>
      </div>

      {showNoShow && (
        <NoShowModal
          bookingId={a.booking_id}
          minWaitSeconds={a.settings.min_waiting_seconds}
          arrivedAt={arrivedAtRef.current}
          onClose={() => setShowNoShow(false)}
          onDone={() => { setShowNoShow(false); navigate({ to: "/driver/trips" }); }}
        />
      )}
      {showIncident && (
        <IncidentModal
          bookingId={a.booking_id}
          onClose={() => setShowIncident(false)}
          onDone={() => setShowIncident(false)}
        />
      )}
    </DriverShell>
  );
}

function ActionButton({
  icon: I, label, onClick, tone = "neutral",
}: {
  icon: any; label: string; onClick: () => void; tone?: "neutral" | "warn" | "danger";
}) {
  const cls =
    tone === "danger" ? "text-rose-300 border-rose-500/20"
    : tone === "warn" ? "text-amber-300 border-amber-500/20"
    : "text-foreground border-border/60";
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[56px] items-center justify-center gap-2 rounded-xl border bg-white/[0.02] px-3 text-xs hover:bg-white/5 ${cls}`}
    >
      <I className="h-4 w-4" /> {label}
    </button>
  );
}
