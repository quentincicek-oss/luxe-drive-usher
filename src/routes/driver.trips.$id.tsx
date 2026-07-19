import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { DriverShell } from "@/components/driver/DriverShell";
import { AssignmentDetailCard } from "@/components/driver/AssignmentDetailCard";
import { WorkflowStepper } from "@/components/driver/WorkflowStepper";
import { NavigateButton } from "@/components/driver/NavigateSheet";
import { VerificationSlot } from "@/components/driver/VerificationSlot";
import type { DispatchStatus } from "@/components/ops/AssignmentTimeline";
import { emit } from "@/lib/notifications";
import { toast } from "sonner";
import { PhoneCall, Radio, AlertTriangle, XCircle, UserX } from "lucide-react";

export const Route = createFileRoute("/_driver/trips/$id")({
  component: TripDetail,
});

const RIDE_LABEL: Record<string, string> = {
  escalade: "Cadillac Escalade",
  suburban: "Chevrolet Suburban",
  denali: "GMC Yukon Denali",
};

function TripDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["driver", "trip", id],
    queryFn: async () => {
      const { data: a } = await (supabase as any)
        .from("booking_assignments")
        .select("id, driver_id, vehicle_id, dispatch_status, booking_id, bookings:booking_id(id, passenger_id, pickup, dropoff, pickup_time, passengers, ride_type, notes, profiles:passenger_id(name))")
        .eq("id", id).maybeSingle();
      if (!a) return null;
      const [vehicle, driver] = await Promise.all([
        a.vehicle_id
          ? (supabase as any).from("vehicles").select("name, license_plate, model_year").eq("id", a.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
        (supabase as any).from("driver_profiles").select("id, user_id").eq("id", a.driver_id).maybeSingle(),
      ]);
      return { ...a, vehicle: vehicle.data, driver: driver.data };
    },
  });

  const a = q.data;

  async function logEvent(event: string, reason?: string) {
    if (!a?.driver_id) return;
    await (supabase as any).from("driver_trip_events").insert({
      assignment_id: a.id,
      driver_id: a.driver_id,
      event,
      reason: reason ?? null,
    });
  }

  async function advance(next: DispatchStatus, event: string, notify?: () => void) {
    if (!a) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("booking_assignments")
        .update({ dispatch_status: next })
        .eq("id", a.id);
      if (error) throw error;
      await logEvent(event);
      notify?.();
      toast.success("Updated");
      q.refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function rejectAssignment() {
    const reason = window.prompt("Reason for rejecting this assignment?");
    if (!reason) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("booking_assignments")
        .update({ dispatch_status: "cancelled", is_current: false })
        .eq("id", a!.id);
      if (error) throw error;
      await logEvent("rejected", reason);
      toast.success("Assignment rejected");
      navigate({ to: "/driver/trips" });
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  async function reportNoShow() {
    if (!window.confirm("Report passenger no-show?")) return;
    await advance("cancelled", "no_show");
  }

  async function reportIncident() {
    const reason = window.prompt("Describe the incident");
    if (!reason) return;
    await logEvent("incident", reason);
    toast.success("Incident logged with dispatch");
  }

  if (q.isLoading) return <DriverShell title="Trip"><div className="text-sm text-muted-foreground">Loading…</div></DriverShell>;
  if (!a) return <DriverShell title="Trip"><div className="text-sm text-muted-foreground">Trip not found.</div></DriverShell>;

  const b = a.bookings ?? {};
  const status: DispatchStatus = a.dispatch_status;
  const firstName = b.profiles?.name || "Passenger";
  const vehicleLabel = a.vehicle
    ? `${a.vehicle.model_year ? a.vehicle.model_year + " " : ""}${a.vehicle.name}${a.vehicle.license_plate ? " · " + a.vehicle.license_plate : ""}`
    : RIDE_LABEL[b.ride_type] || null;

  // Primary action for current status
  const primary = (() => {
    switch (status) {
      case "pending":
      case "assigned":
        return { label: "Accept assignment", onClick: () => advance("accepted", "accepted", () => emit({ type: "driver.accepted", bookingId: b.id, driverName: firstName })) };
      case "accepted":
        return { label: "Start navigating to pickup", onClick: () => advance("en_route", "arrived") };
      case "en_route":
        return { label: "I've arrived", onClick: () => advance("arrived", "arrived", () => emit({ type: "driver.arrived", bookingId: b.id })) };
      case "arrived":
        return verified
          ? { label: "Start trip", onClick: () => advance("in_progress", "started", () => emit({ type: "trip.started", bookingId: b.id })) }
          : { label: "Waiting for passenger", onClick: async () => { await logEvent("waiting"); toast.success("Marked waiting"); } };
      case "in_progress":
        return { label: "Complete trip", onClick: () => advance("completed", "completed", () => emit({ type: "trip.completed", bookingId: b.id })) };
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
          <WorkflowStepper status={status} verified={verified} />
        </div>

        {status === "en_route" && <NavigateButton destination={b.pickup} />}
        {status === "in_progress" && <NavigateButton destination={b.dropoff} />}

        {status === "arrived" && !verified && (
          <VerificationSlot onSkip={() => setVerified(true)} />
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
          <ActionButton icon={PhoneCall} label="Contact passenger" onClick={async () => { await logEvent("passenger_contacted"); toast.success("Logged"); }} />
          <ActionButton icon={Radio} label="Contact dispatch" onClick={async () => { await logEvent("dispatch_contacted"); toast.success("Logged"); }} />
          {(status === "arrived" || status === "en_route") && (
            <ActionButton icon={UserX} label="Passenger no-show" onClick={reportNoShow} tone="warn" />
          )}
          <ActionButton icon={AlertTriangle} label="Report incident" onClick={reportIncident} tone="warn" />
          {(status === "pending" || status === "assigned") && (
            <ActionButton icon={XCircle} label="Reject assignment" onClick={rejectAssignment} tone="danger" />
          )}
        </div>
      </div>
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
// touch
