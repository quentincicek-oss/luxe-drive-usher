import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Driver { id: string; full_name: string; employee_id: string; }
interface Assignment { id: string; driver_id: string | null; booking_id: string; dispatch_status: string; }
interface Booking { id: string; pickup_time: string; pickup: string; dropoff: string; }
interface Unavail { id: string; driver_id: string; starts_at: string; ends_at: string; kind: string; }

const DAY_MS = 86400 * 1000;

export function ScheduleGrid() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [unavail, setUnavail] = useState<Unavail[]>([]);
  const [busy, setBusy] = useState(true);
  const [dayOffset, setDayOffset] = useState(0);

  useEffect(() => {
    (async () => {
      setBusy(true);
      const start = new Date(Date.now() + dayOffset * DAY_MS); start.setHours(0,0,0,0);
      const end = new Date(start.getTime() + 7 * DAY_MS);
      const [d, a, u] = await Promise.all([
        (supabase as any).from("driver_profiles").select("id, full_name, employee_id").eq("employment_status","active").order("full_name"),
        (supabase as any).from("booking_assignments").select("id, driver_id, booking_id, dispatch_status").eq("is_current", true),
        (supabase as any).from("driver_unavailability").select("id, driver_id, starts_at, ends_at, kind").gte("ends_at", start.toISOString()).lte("starts_at", end.toISOString()),
      ]);
      const ids = (a.data ?? []).map((x: Assignment) => x.booking_id);
      const bmap: Record<string, Booking> = {};
      if (ids.length) {
        const { data: bs } = await supabase.from("bookings").select("id, pickup_time, pickup, dropoff").in("id", ids).gte("pickup_time", start.toISOString()).lte("pickup_time", end.toISOString());
        (bs ?? []).forEach((b) => { bmap[b.id] = b as Booking; });
      }
      setDrivers((d.data ?? []) as Driver[]);
      setAssignments(((a.data ?? []) as Assignment[]).filter(x => x.driver_id && bmap[x.booking_id]));
      setBookings(bmap);
      setUnavail((u.data ?? []) as Unavail[]);
      setBusy(false);
    })();
  }, [dayOffset]);

  const days = useMemo(() => {
    const start = new Date(Date.now() + dayOffset * DAY_MS); start.setHours(0,0,0,0);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [dayOffset]);

  const byDriverDay = useMemo(() => {
    const map = new Map<string, { jobs: Assignment[]; off: Unavail[] }>();
    for (const d of drivers) for (const day of days) map.set(`${d.id}|${day.toDateString()}`, { jobs: [], off: [] });
    for (const a of assignments) {
      if (!a.driver_id) continue;
      const b = bookings[a.booking_id]; if (!b) continue;
      const key = `${a.driver_id}|${new Date(b.pickup_time).toDateString()}`;
      map.get(key)?.jobs.push(a);
    }
    for (const u of unavail) {
      for (const day of days) {
        if (new Date(u.starts_at) <= day && new Date(u.ends_at) >= day) {
          map.get(`${u.driver_id}|${day.toDateString()}`)?.off.push(u);
        }
      }
    }
    return map;
  }, [drivers, days, assignments, bookings, unavail]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setDayOffset(o => o - 7)} className="rounded-full px-3 py-1.5 text-xs bg-white/5 ring-1 ring-white/10 hover:bg-white/10">← Prev week</button>
        <button onClick={() => setDayOffset(0)} className="rounded-full px-3 py-1.5 text-xs bg-white/5 ring-1 ring-white/10 hover:bg-white/10">Today</button>
        <button onClick={() => setDayOffset(o => o + 7)} className="rounded-full px-3 py-1.5 text-xs bg-white/5 ring-1 ring-white/10 hover:bg-white/10">Next week →</button>
      </div>
      {busy && <div className="text-sm text-muted-foreground">Loading schedule…</div>}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-40">Driver</th>
              {days.map(d => <th key={d.toDateString()} className="text-left px-3 py-2">{d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" })}</th>)}
            </tr>
          </thead>
          <tbody>
            {drivers.map(dr => (
              <tr key={dr.id} className="border-t border-border/40 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-sm">{dr.full_name}</div>
                  <div className="text-[10px] text-muted-foreground">{dr.employee_id}</div>
                </td>
                {days.map(day => {
                  const cell = byDriverDay.get(`${dr.id}|${day.toDateString()}`) ?? { jobs: [], off: [] };
                  return (
                    <td key={day.toDateString()} className="px-2 py-2 space-y-1 border-l border-border/30">
                      {cell.off.map(u => (
                        <div key={u.id} className="rounded bg-violet-500/10 text-violet-300 px-2 py-1 text-[10px] ring-1 ring-violet-500/20 capitalize">{u.kind}</div>
                      ))}
                      {cell.jobs.map(a => {
                        const b = bookings[a.booking_id]!;
                        return (
                          <div key={a.id} className="rounded bg-gold/10 text-gold px-2 py-1 text-[10px] ring-1 ring-gold/25">
                            <div className="tabular-nums">{new Date(b.pickup_time).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                            <div className="truncate text-foreground/80">{b.pickup} → {b.dropoff}</div>
                          </div>
                        );
                      })}
                      {cell.jobs.length === 0 && cell.off.length === 0 && <div className="text-[10px] text-muted-foreground/50">—</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {drivers.length === 0 && !busy && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No active drivers.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
