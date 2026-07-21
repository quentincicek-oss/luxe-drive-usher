import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DispatchKpi } from "@/components/ops/DispatchKpi";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard — HarborLine Admin" },
      { name: "description", content: "HarborLine operations dashboard." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Dashboard,
});

interface Overview {
  new_bookings: number; pending_dispatch: number; assigned_trips: number;
  en_route: number; waiting: number; in_progress: number;
  completed_today: number; cancelled_today: number;
  drivers: { available: number; assigned: number; on_trip: number; offline: number; vacation: number };
}

interface AttentionRow {
  id: string; pickup: string; dropoff: string; pickup_time: string; status: string; paid: boolean | null;
}

function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [attention, setAttention] = useState<AttentionRow[]>([]);
  const [revenue, setRevenue] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [ov, bk] = await Promise.all([
        (supabase as any).rpc("admin_dispatch_overview"),
        supabase
          .from("bookings")
          .select("id, pickup, dropoff, pickup_time, status, paid, price")
          .order("pickup_time", { ascending: true })
          .limit(200),
      ]);
      if (!alive) return;
      setData((ov.data ?? null) as Overview | null);
      const rows = (bk.data ?? []) as (AttentionRow & { price: number | null })[];
      // Attention list: upcoming/in-flight, not completed or cancelled
      const now = Date.now();
      const active = rows.filter(r => r.status !== "completed" && r.status !== "cancelled");
      setAttention(active.slice(0, 6));
      // Revenue today: sum of price for paid bookings created/started today
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const rev = rows.reduce((sum, r) => {
        const t = new Date(r.pickup_time).getTime();
        if (r.paid && t >= startOfDay.getTime() && t < startOfDay.getTime() + 24 * 3600 * 1000) {
          return sum + (Number(r.price) || 0);
        }
        return sum;
      }, 0);
      setRevenue(rev);
      void now;
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const activeTrips = (data?.assigned_trips ?? 0) + (data?.en_route ?? 0) + (data?.waiting ?? 0) + (data?.in_progress ?? 0);
  const todaysTrips = (data?.new_bookings ?? 0) + (data?.pending_dispatch ?? 0) + activeTrips + (data?.completed_today ?? 0);
  const driversOnline = (data?.drivers.available ?? 0) + (data?.drivers.assigned ?? 0) + (data?.drivers.on_trip ?? 0);

  return (
    <div className="space-y-8">
      {/* Heading */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Overview</div>
          <h1 className="font-display text-3xl sm:text-4xl mt-1">Dispatch Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live operations summary. Updates every 20 seconds.
          </p>
        </div>
      </div>

      {/* Primary KPIs — the essentials only */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DispatchKpi label="Today's trips"     value={todaysTrips || "—"} tone="gold" />
        <DispatchKpi label="Active trips"      value={activeTrips || "—"} tone="sky" />
        <DispatchKpi label="Pending dispatch"  value={data?.pending_dispatch ?? "—"} tone="amber" />
        <DispatchKpi label="Drivers online"    value={driversOnline || "—"} tone="emerald" />
        <DispatchKpi label="Completed today"   value={data?.completed_today ?? "—"} tone="emerald" />
        <DispatchKpi label="Cancelled today"   value={data?.cancelled_today ?? "—"} />
        <DispatchKpi label="New bookings"      value={data?.new_bookings ?? "—"} tone="gold" />
        <DispatchKpi label="Revenue today"     value={revenue ? `$${revenue.toFixed(0)}` : "—"} tone="gold" hint="Paid bookings" />
      </div>

      {/* Needs attention */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl">Needs attention</h2>
          <Link to="/admin/trips" className="text-xs text-gold hover:underline inline-flex items-center gap-1">
            All trips <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
          {attention.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nothing needs attention right now.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {attention.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/trips/$id"
                    params={{ id: r.id }}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-white/[0.03] transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {r.pickup} <span className="text-gold mx-1">→</span> {r.dropoff}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(r.pickup_time).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusPill tone={(r.status as any) ?? "muted"}>{r.status.replace("_", " ")}</StatusPill>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Fleet snapshot */}
      <section>
        <div className="mb-3">
          <h2 className="font-display text-xl">Fleet availability</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <DispatchKpi label="Available" value={data?.drivers.available ?? "—"} tone="emerald" />
          <DispatchKpi label="Assigned"  value={data?.drivers.assigned ?? "—"}  tone="gold" />
          <DispatchKpi label="On trip"   value={data?.drivers.on_trip ?? "—"}   tone="sky" />
          <DispatchKpi label="Offline"   value={data?.drivers.offline ?? "—"} />
          <DispatchKpi label="Vacation"  value={data?.drivers.vacation ?? "—"} />
        </div>
      </section>
    </div>
  );
}
