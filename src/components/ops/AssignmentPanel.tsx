import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { AssignmentTimeline, type DispatchStatus } from "@/components/ops/AssignmentTimeline";
import { emit } from "@/lib/notifications";
import { toast } from "sonner";
import { advanceAssignment } from "@/lib/dispatch.functions";
import { adminAssignDriver, adminRemoveAssignment } from "@/lib/admin.functions";

interface Driver { id: string; full_name: string; employee_id: string; availability_status: string; assigned_vehicle_id: string | null; }
interface Vehicle { id: string; name: string; license_plate: string; }
interface Assignment { id: string; booking_id: string; driver_id: string | null; vehicle_id: string | null; dispatch_status: DispatchStatus; }

export function AssignmentPanel({ bookingId }: { bookingId: string }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [current, setCurrent] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false);

  const assignFn = useServerFn(adminAssignDriver);
  const removeFn = useServerFn(adminRemoveAssignment);
  const advanceFn = useServerFn(advanceAssignment);

  async function load() {
    const [d, v, a] = await Promise.all([
      (supabase as any).from("driver_profiles").select("id, full_name, employee_id, availability_status, assigned_vehicle_id").eq("employment_status", "active").order("full_name"),
      (supabase as any).from("vehicles").select("id, name, license_plate").eq("status", "active").order("name"),
      (supabase as any).from("booking_assignments").select("*").eq("booking_id", bookingId).eq("is_current", true).maybeSingle(),
    ]);
    setDrivers((d.data ?? []) as Driver[]);
    setVehicles((v.data ?? []) as Vehicle[]);
    setCurrent((a.data ?? null) as Assignment | null);
  }
  useEffect(() => { load(); }, [bookingId]);

  async function assign(driver_id: string, vehicle_id: string | null) {
    setBusy(true);
    try {
      const row = (await assignFn({ data: { bookingId, driverId: driver_id, vehicleId: vehicle_id } })) as Assignment;
      setCurrent(row);
      const drv = drivers.find(x => x.id === driver_id);
      emit({ type: "driver.assigned", bookingId, driverName: drv?.full_name ?? "Driver" });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function advance(next: DispatchStatus) {
    if (!current) return;
    setBusy(true);
    try {
      await advanceFn({ data: { assignmentId: current.id, next } });
      setCurrent({ ...current, dispatch_status: next });
      if (next === "accepted") emit({ type: "driver.accepted", bookingId, driverName: drivers.find(x=>x.id===current.driver_id)?.full_name ?? "Driver" });
      if (next === "arrived") emit({ type: "driver.arrived", bookingId });
      if (next === "in_progress") emit({ type: "trip.started", bookingId });
      if (next === "completed") emit({ type: "trip.completed", bookingId });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    try {
      await removeFn({ data: { assignmentId: current.id } });
      setCurrent(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  if (current) {
    const drv = drivers.find(d => d.id === current.driver_id);
    const veh = vehicles.find(v => v.id === current.vehicle_id);
    return (
      <div className="space-y-3 rounded-lg border border-border/60 bg-surface/40 p-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Assigned</span>
            <span className="font-medium">{drv?.full_name ?? "—"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{veh?.name ?? "No vehicle"}</span>
            {drv && <StatusPill tone={drv.availability_status as any}>{drv.availability_status.replace("_"," ")}</StatusPill>}
          </div>
          <button onClick={remove} disabled={busy} className="text-[11px] text-destructive hover:underline">Remove</button>
        </div>
        <AssignmentTimeline current={current.dispatch_status} onAdvance={advance} disabled={busy} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-surface/40 p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Assign driver</div>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
        <select id={`drv-${bookingId}`} className="bg-input border border-border/60 rounded px-2 py-2 text-xs">
          <option value="">Select driver…</option>
          {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name} · {d.employee_id} ({d.availability_status})</option>)}
        </select>
        <select id={`veh-${bookingId}`} className="bg-input border border-border/60 rounded px-2 py-2 text-xs">
          <option value="">Select vehicle…</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} · {v.license_plate}</option>)}
        </select>
        <button
          disabled={busy}
          onClick={() => {
            const dEl = document.getElementById(`drv-${bookingId}`) as HTMLSelectElement;
            const vEl = document.getElementById(`veh-${bookingId}`) as HTMLSelectElement;
            if (!dEl.value) { toast.error("Select a driver"); return; }
            assign(dEl.value, vEl.value || null);
          }}
          className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold disabled:opacity-50"
        >
          Assign
        </button>
      </div>
    </div>
  );
}
