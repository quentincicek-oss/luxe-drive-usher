import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowRight, Search } from "lucide-react";

export const Route = createFileRoute("/admin/trips")({
  head: () => ({
    meta: [
      { title: "Trips — HarborLine Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: TripsList,
});

interface Row {
  id: string;
  pickup: string; dropoff: string;
  pickup_time: string;
  status: string;
  paid: boolean | null;
  price: number | null; suggested_price: number | null;
  passenger_id: string;
  passenger?: { name: string | null; surname: string | null; email: string | null };
  assignment?: {
    dispatch_status: string;
    driver?: { full_name: string | null; employee_id: string | null } | null;
    vehicle?: { name: string | null; license_plate: string | null } | null;
  } | null;
}

const STATUS_FILTERS = [
  "all", "requested", "assigned", "in_progress", "completed", "cancelled",
] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const DATE_FILTERS = ["all", "today", "upcoming", "past"] as const;
type DateFilter = typeof DATE_FILTERS[number];

function TripsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [dateF, setDateF] = useState<DateFilter>("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, pickup, dropoff, pickup_time, status, paid, price, suggested_price, passenger_id")
        .order("pickup_time", { ascending: false })
        .limit(500);
      if (!alive) return;
      const list = (bookings ?? []) as Row[];

      const passengerIds = Array.from(new Set(list.map(r => r.passenger_id).filter(Boolean)));
      const bookingIds = list.map(r => r.id);

      const [profilesRes, assignRes] = await Promise.all([
        passengerIds.length
          ? supabase.from("profiles").select("id, name, surname, email").in("id", passengerIds)
          : Promise.resolve({ data: [] as any[] }),
        bookingIds.length
          ? (supabase as any)
              .from("booking_assignments")
              .select("booking_id, dispatch_status, is_current, driver:driver_id(full_name, employee_id), vehicle:vehicle_id(name, license_plate)")
              .in("booking_id", bookingIds)
              .eq("is_current", true)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (!alive) return;

      const profileMap = new Map<string, any>();
      for (const p of (profilesRes.data ?? [])) profileMap.set(p.id, p);
      const assignMap = new Map<string, any>();
      for (const a of (assignRes.data ?? [])) assignMap.set(a.booking_id, a);

      const enriched = list.map((r) => ({
        ...r,
        passenger: profileMap.get(r.passenger_id) ?? null,
        assignment: assignMap.get(r.id) ?? null,
      }));
      setRows(enriched);
      setBusy(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);
    return rows.filter(r => {
      const effectiveStatus = r.assignment?.dispatch_status ?? r.status;
      if (statusF !== "all" && effectiveStatus !== statusF) return false;
      if (dateF !== "all") {
        const t = new Date(r.pickup_time).getTime();
        if (dateF === "today" && (t < startOfDay.getTime() || t >= endOfDay.getTime())) return false;
        if (dateF === "upcoming" && t < startOfDay.getTime()) return false;
        if (dateF === "past" && t >= startOfDay.getTime()) return false;
      }
      if (!s) return true;
      const passengerName = r.passenger ? `${r.passenger.name ?? ""} ${r.passenger.surname ?? ""}`.trim() : "";
      const hay = [
        r.id.slice(0, 8),
        r.pickup, r.dropoff,
        passengerName, r.passenger?.email ?? "",
        r.assignment?.driver?.full_name ?? "", r.assignment?.driver?.employee_id ?? "",
        r.assignment?.vehicle?.name ?? "", r.assignment?.vehicle?.license_plate ?? "",
        effectiveStatus,
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [rows, dq, statusF, dateF]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Operations</div>
        <h1 className="font-display text-3xl mt-1">Trips</h1>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search trip, passenger, driver, vehicle…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/60 bg-input text-sm focus-luxe"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Status" value={statusF} setValue={(v) => setStatusF(v as StatusFilter)} options={STATUS_FILTERS} />
          <FilterGroup label="Date" value={dateF} setValue={(v) => setDateF(v as DateFilter)} options={DATE_FILTERS} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Trip</th>
                <th className="text-left px-4 py-3">Passenger</th>
                <th className="text-left px-4 py-3">Driver</th>
                <th className="text-left px-4 py-3">Vehicle</th>
                <th className="text-left px-4 py-3">Pickup → Dropoff</th>
                <th className="text-left px-4 py-3 whitespace-nowrap">Pickup time</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {busy && (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
              )}
              {!busy && filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No trips found.</td></tr>
              )}
              {!busy && filtered.map((r) => {
                const passengerName = r.passenger
                  ? `${r.passenger.name ?? ""} ${r.passenger.surname ?? ""}`.trim() || (r.passenger.email ?? "—")
                  : "—";
                const effectiveStatus = r.assignment?.dispatch_status ?? r.status;
                return (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">#{r.id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{passengerName}</td>
                    <td className="px-4 py-3">{r.assignment?.driver?.full_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.assignment?.vehicle
                        ? <span>{r.assignment.vehicle.name} · <span className="font-mono">{r.assignment.vehicle.license_plate}</span></span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <div className="truncate">{r.pickup}</div>
                      <div className="truncate text-xs text-muted-foreground"><span className="text-gold mr-1">↓</span>{r.dropoff}</div>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">{new Date(r.pickup_time).toLocaleString()}</td>
                    <td className="px-4 py-3"><StatusPill tone={(effectiveStatus as any) ?? "muted"}>{String(effectiveStatus).replace("_", " ")}</StatusPill></td>
                    <td className="px-4 py-3">
                      <StatusPill tone={r.paid ? "paid" : "unpaid"}>{r.paid ? "Yes" : "No"}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/admin/trips/$id"
                        params={{ id: r.id }}
                        className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                      >
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
      <div className="text-[11px] text-muted-foreground">{filtered.length} trip{filtered.length === 1 ? "" : "s"}</div>
    </div>
  );
}

function FilterGroup({ label, value, setValue, options }: {
  label: string; value: string; setValue: (v: string) => void; options: readonly string[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface/50 p-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground px-2">{label}</span>
      {options.map(o => (
        <button
          key={o}
          onClick={() => setValue(o)}
          className={
            "rounded-md px-2.5 py-1 text-xs capitalize transition " +
            (value === o ? "bg-gold/15 text-gold" : "text-muted-foreground hover:text-foreground")
          }
        >
          {o.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}
