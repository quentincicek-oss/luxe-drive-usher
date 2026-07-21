import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowRight, Search } from "lucide-react";

export const Route = createFileRoute("/admin/drivers")({
  head: () => ({
    meta: [
      { title: "Drivers — HarborLine Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DriversList,
});

interface Driver {
  id: string; full_name: string; employee_id: string;
  phone: string | null; email: string | null;
  employment_status: string; availability_status: string;
  assigned_vehicle_id: string | null;
}

function DriversList() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tripCounts, setTripCounts] = useState<Record<string, { today: number; current: string | null }>>({});
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [statusF, setStatusF] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      const { data } = await (supabase as any)
        .from("driver_profiles")
        .select("id, full_name, employee_id, phone, email, employment_status, availability_status, assigned_vehicle_id")
        .order("full_name");
      if (!alive) return;
      const list = (data ?? []) as Driver[];
      setDrivers(list);

      const ids = list.map(d => d.id);
      if (ids.length) {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const { data: assigns } = await (supabase as any)
          .from("booking_assignments")
          .select("driver_id, dispatch_status, is_current, bookings:booking_id(pickup_time)")
          .in("driver_id", ids);
        const counts: Record<string, { today: number; current: string | null }> = {};
        for (const d of ids) counts[d] = { today: 0, current: null };
        for (const a of (assigns ?? [])) {
          const t = a.bookings?.pickup_time ? new Date(a.bookings.pickup_time).getTime() : 0;
          if (t >= startOfDay.getTime() && t < startOfDay.getTime() + 24 * 3600 * 1000) counts[a.driver_id].today += 1;
          if (a.is_current && ["accepted", "en_route", "arrived", "in_progress"].includes(a.dispatch_status)) {
            counts[a.driver_id].current = a.dispatch_status;
          }
        }
        if (alive) setTripCounts(counts);
      }
      setBusy(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return drivers.filter(d => {
      if (statusF !== "all" && d.availability_status !== statusF) return false;
      if (!s) return true;
      return (
        d.full_name.toLowerCase().includes(s) ||
        d.employee_id.toLowerCase().includes(s) ||
        (d.phone ?? "").toLowerCase().includes(s) ||
        (d.email ?? "").toLowerCase().includes(s)
      );
    });
  }, [drivers, dq, statusF]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Fleet</div>
        <h1 className="font-display text-3xl mt-1">Drivers</h1>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, employee ID, email, phone…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/60 bg-input text-sm focus-luxe"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface/50 p-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground px-2">Status</span>
          {["all", "available", "assigned", "on_trip", "offline", "vacation"].map(o => (
            <button key={o} onClick={() => setStatusF(o)}
              className={"rounded-md px-2.5 py-1 text-xs capitalize transition " + (statusF === o ? "bg-gold/15 text-gold" : "text-muted-foreground hover:text-foreground")}>
              {o.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Driver</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Current trip</th>
                <th className="text-left px-4 py-3">Today</th>
                <th className="text-left px-4 py-3">Employment</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {busy && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!busy && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No drivers.</td></tr>}
              {!busy && filtered.map(d => {
                const tc = tripCounts[d.id] ?? { today: 0, current: null };
                return (
                  <tr key={d.id} className="border-t border-border/40 hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.full_name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{d.employee_id}</div>
                    </td>
                    <td className="px-4 py-3"><StatusPill tone={d.availability_status as any}>{d.availability_status.replace("_", " ")}</StatusPill></td>
                    <td className="px-4 py-3">
                      {tc.current
                        ? <StatusPill tone={tc.current as any}>{tc.current.replace("_", " ")}</StatusPill>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{tc.today}</td>
                    <td className="px-4 py-3"><StatusPill tone={d.employment_status as any}>{d.employment_status}</StatusPill></td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/admin/drivers/$id" params={{ id: d.id }} className="inline-flex items-center gap-1 text-xs text-gold hover:underline">
                        View <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground">{filtered.length} driver{filtered.length === 1 ? "" : "s"}</div>
    </div>
  );
}
