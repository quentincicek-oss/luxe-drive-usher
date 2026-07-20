import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DispatchKpi } from "@/components/ops/DispatchKpi";

interface Overview {
  new_bookings: number; pending_dispatch: number; assigned_trips: number;
  en_route: number; waiting: number; in_progress: number;
  completed_today: number; cancelled_today: number;
  drivers: { available: number; assigned: number; on_trip: number; offline: number; vacation: number };
}

export function DispatchOverview() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).rpc("admin_dispatch_overview");
      if (alive) setData(data as Overview | null);
    };
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const d = data;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Operations</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DispatchKpi label="New bookings"     value={d?.new_bookings ?? "—"}     tone="gold" />
          <DispatchKpi label="Pending dispatch" value={d?.pending_dispatch ?? "—"} tone="amber" />
          <DispatchKpi label="Assigned"         value={d?.assigned_trips ?? "—"} />
          <DispatchKpi label="En route"         value={d?.en_route ?? "—"}         tone="sky" />
          <DispatchKpi label="Waiting"          value={d?.waiting ?? "—"}          tone="sky" />
          <DispatchKpi label="In progress"      value={d?.in_progress ?? "—"}      tone="sky" />
          <DispatchKpi label="Completed today"  value={d?.completed_today ?? "—"}  tone="emerald" />
          <DispatchKpi label="Cancelled today"  value={d?.cancelled_today ?? "—"} />
        </div>
      </div>
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Fleet availability</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <DispatchKpi label="Available" value={d?.drivers.available ?? "—"} tone="emerald" />
          <DispatchKpi label="Assigned"  value={d?.drivers.assigned ?? "—"}  tone="gold" />
          <DispatchKpi label="On trip"   value={d?.drivers.on_trip ?? "—"}   tone="sky" />
          <DispatchKpi label="Offline"   value={d?.drivers.offline ?? "—"} />
          <DispatchKpi label="Vacation"  value={d?.drivers.vacation ?? "—"} />
        </div>
      </div>
    </div>
  );
}
