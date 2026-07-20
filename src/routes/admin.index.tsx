import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { toast } from "sonner";
import { StatusPill } from "@/components/ops/StatusPill";
import { DispatchKpi } from "@/components/ops/DispatchKpi";
import { AssignmentPanel } from "@/components/ops/AssignmentPanel";
import { ReferralsPanel } from "@/components/admin/ReferralsPanel";
import { DispatchOverview } from "@/components/dispatch/DispatchOverview";
import { IncidentFeed } from "@/components/dispatch/IncidentFeed";
import { AuditTable } from "@/components/dispatch/AuditTable";
import { FleetExpirations } from "@/components/dispatch/FleetExpirations";
import { ScheduleGrid } from "@/components/dispatch/ScheduleGrid";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { SupportPanel } from "@/components/admin/SupportPanel";
import { AmenitiesPanel } from "@/components/admin/AmenitiesPanel";
import {
  adminSetBookingStatus,
  adminUpsertDriver, adminDeleteDriver,
  adminUpsertVehicle, adminDeleteVehicle,
  adminUpsertDiscount, adminDeleteDiscount,
} from "@/lib/admin.functions";

interface Booking {
  id: string; passenger_id: string; pickup: string; dropoff: string; pickup_time: string;
  ride_type: string; status: string; price: number | null; suggested_price: number | null;
  passengers: number; created_at: string;
}
interface DiscountRule { id: string; min_miles: number; max_miles: number; flat_off: number; percent_off: number; active: boolean; }
interface Driver {
  id: string; user_id: string | null; employee_id: string; full_name: string; phone: string | null; email: string | null;
  photo_url: string | null; license_number: string | null; license_expires_at: string | null;
  employment_status: string; availability_status: string; assigned_vehicle_id: string | null; notes: string | null;
}
interface Vehicle {
  id: string; name: string; category: string; license_plate: string; vin: string | null;
  model_year: number | null; seats: number; status: string; insurance_expires_at: string | null;
}
interface Kpis {
  todays_bookings: number; upcoming_bookings: number; completed_trips_7d: number;
  drivers_available: number; drivers_busy: number; drivers_offline: number;
  upcoming_airport_pickups: number;
}

type Tab = "overview" | "dispatch" | "schedule" | "bookings" | "users" | "drivers" | "vehicles" | "fleet" | "incidents" | "audit" | "referrals" | "discounts" | "concierge";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin — HarborLine" }, { name: "description", content: "HarborLine operations dashboard." }] }),
  component: Admin,
});

function Admin() {
  const { user, role, loading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; session_id: string; role: string; content: string; user_language: string; created_at: string }>>([]);
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  useEffect(() => { document.title = `${t("admin.console")} — ${t("brand.name")}`; }, [t]);
  useEffect(() => {
    if (loading) return;
    if (!user) { nav({ to: "/admin/login" }); return; }
    if (role !== null && role !== "admin") { toast.error(t("admin.accessRequired")); nav({ to: "/admin/login" }); }
  }, [user, role, loading, nav, t]);

  async function refresh() {
    setBusy(true);
    const [b, d, m, dr, vh, kp] = await Promise.all([
      supabase.from("bookings").select("*").order("pickup_time", { ascending: false }).limit(300),
      supabase.from("discount_rules").select("*").order("min_miles"),
      supabase.from("chat_messages").select("id, session_id, role, content, user_language, created_at").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("driver_profiles").select("*").order("full_name"),
      (supabase as any).from("vehicles").select("*").order("name"),
      (supabase as any).rpc("admin_dispatch_kpis"),
    ]);
    setBookings((b.data ?? []) as Booking[]);
    setDiscounts((d.data ?? []) as DiscountRule[]);
    setMessages((m.data ?? []) as typeof messages);
    setDrivers((dr.data ?? []) as Driver[]);
    setVehicles((vh.data ?? []) as Vehicle[]);
    setKpis((kp.data ?? null) as Kpis | null);
    setBusy(false);
  }
  useEffect(() => { if (role === "admin") refresh(); }, [role]);

  const setBookingStatus = useServerFn(adminSetBookingStatus);
  const upsertDiscountFn = useServerFn(adminUpsertDiscount);
  const deleteDiscountFn = useServerFn(adminDeleteDiscount);

  async function updateStatus(id: string, status: string) {
    try {
      await setBookingStatus({ data: { bookingId: id, status } });
      toast.success(t("admin.statusUpdated"));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function addDiscount() {
    try {
      await upsertDiscountFn({ data: { id: null, payload: { min_miles: 0, max_miles: 25, flat_off: 10, percent_off: 5, active: true } } });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function deleteDiscount(id: string) {
    try {
      await deleteDiscountFn({ data: { id } });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  }

  const filteredBookings = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(b =>
      b.pickup.toLowerCase().includes(q) ||
      b.dropoff.toLowerCase().includes(q) ||
      b.ride_type.toLowerCase().includes(q) ||
      b.status.toLowerCase().includes(q),
    );
  }, [bookings, deferredSearch]);

  const filteredDrivers = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(d =>
      d.full_name.toLowerCase().includes(q) ||
      d.employee_id.toLowerCase().includes(q) ||
      (d.phone ?? "").toLowerCase().includes(q) ||
      (d.email ?? "").toLowerCase().includes(q),
    );
  }, [drivers, deferredSearch]);

  const filteredVehicles = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.license_plate.toLowerCase().includes(q) ||
      (v.vin ?? "").toLowerCase().includes(q),
    );
  }, [vehicles, deferredSearch]);

  if (loading || !user || role !== "admin") return <div className="min-h-screen bg-obsidian" />;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview",  label: "Overview" },
    { key: "dispatch",  label: "Dispatch" },
    { key: "schedule",  label: "Schedule" },
    { key: "bookings",  label: t("admin.tabs.bookings") },
    { key: "users",     label: "Users" },
    { key: "drivers",   label: "Drivers" },
    { key: "vehicles",  label: "Vehicles" },
    { key: "fleet",     label: "Fleet health" },
    { key: "incidents", label: "Incidents" },
    { key: "audit",     label: "Audit log" },
    { key: "referrals", label: "Referrals" },
    { key: "discounts", label: t("admin.tabs.discounts") },
    { key: "concierge", label: t("admin.tabs.concierge") },
  ];

  return (
    <main className="min-h-dvh bg-obsidian">
      <AppHeader subtitle={t("admin.console")} />

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap gap-1 border-b border-border/60 mb-6">
          {TABS.map((v) => (
            <button key={v.key} onClick={() => setTab(v.key)}
              className={"px-4 py-2.5 text-sm capitalize transition border-b-2 " + (tab === v.key ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {v.label}
            </button>
          ))}
        </div>

        {(tab === "bookings" || tab === "drivers" || tab === "vehicles") && (
          <div className="mb-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full max-w-md rounded-lg border border-border/60 bg-input px-3 py-2 text-sm"
            />
          </div>
        )}

        {busy && <div className="text-muted-foreground text-sm">{t("history.loading")}</div>}

        {/* ============ OVERVIEW ============ */}
        {tab === "overview" && <DispatchOverview />}

        {/* ============ SCHEDULE ============ */}
        {tab === "schedule" && <ScheduleGrid />}

        {/* ============ FLEET HEALTH ============ */}
        {tab === "fleet" && <FleetExpirations />}

        {/* ============ INCIDENTS ============ */}
        {tab === "incidents" && <IncidentFeed />}

        {/* ============ AUDIT ============ */}
        {tab === "audit" && <AuditTable />}

        {/* ============ USERS ============ */}
        {tab === "users" && <UsersPanel />}


        {/* ============ DISPATCH ============ */}
        {tab === "dispatch" && !busy && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DispatchKpi label="Today"           value={kpis?.todays_bookings ?? 0}         tone="gold" />
              <DispatchKpi label="Upcoming"        value={kpis?.upcoming_bookings ?? 0} />
              <DispatchKpi label="Completed (7d)"  value={kpis?.completed_trips_7d ?? 0}      tone="emerald" />
              <DispatchKpi label="Airport Pickups" value={kpis?.upcoming_airport_pickups ?? 0} tone="sky" />
              <DispatchKpi label="Drivers Available" value={kpis?.drivers_available ?? 0}  tone="emerald" />
              <DispatchKpi label="Drivers Busy"      value={kpis?.drivers_busy ?? 0}       tone="sky" />
              <DispatchKpi label="Drivers Offline"   value={kpis?.drivers_offline ?? 0}    tone="amber" />
              <DispatchKpi label="Fleet"             value={vehicles.filter(v=>v.status==="active").length} hint={`${vehicles.length} total`} />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-xl">Today &amp; upcoming</h3>
                <span className="text-xs text-muted-foreground">Click a row to assign a driver</span>
              </div>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3">Pickup time</th>
                      <th className="text-left px-4 py-3">Route</th>
                      <th className="text-left px-4 py-3">Vehicle</th>
                      <th className="text-left px-4 py-3">Pax</th>
                      <th className="text-left px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.filter(b => new Date(b.pickup_time) >= new Date(Date.now() - 24*3600*1000) && b.status !== "completed" && b.status !== "cancelled").map((b) => (
                      <>
                        <tr key={b.id} onClick={() => setOpenBookingId(openBookingId === b.id ? null : b.id)}
                            className="border-t border-border/40 hover:bg-accent/40 cursor-pointer">
                          <td className="px-4 py-3 text-xs tabular-nums">{new Date(b.pickup_time).toLocaleString()}</td>
                          <td className="px-4 py-3">{b.pickup} <span className="text-gold mx-1">→</span> {b.dropoff}</td>
                          <td className="px-4 py-3 capitalize text-xs">{b.ride_type}</td>
                          <td className="px-4 py-3">{b.passengers}</td>
                          <td className="px-4 py-3"><StatusPill tone={(b.status === "completed" ? "completed" : b.status === "cancelled" ? "cancelled" : "pending") as any}>{b.status.replace("_"," ")}</StatusPill></td>
                        </tr>
                        {openBookingId === b.id && (
                          <tr className="bg-surface/30">
                            <td colSpan={5} className="px-4 py-4"><AssignmentPanel bookingId={b.id} /></td>
                          </tr>
                        )}
                      </>
                    ))}
                    {bookings.filter(b => new Date(b.pickup_time) >= new Date(Date.now() - 24*3600*1000) && b.status !== "completed" && b.status !== "cancelled").length === 0 && (
                      <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No pending dispatches</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============ BOOKINGS (existing) ============ */}
        {tab === "bookings" && !busy && (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">{t("admin.table.pickupTime")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.route")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.vehicle")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.pax")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.price")}</th>
                  <th className="text-left px-4 py-3">{t("admin.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((b) => (
                  <tr key={b.id} className="border-t border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-3 text-xs tabular-nums">{new Date(b.pickup_time).toLocaleString()}</td>
                    <td className="px-4 py-3">{b.pickup} <span className="text-gold mx-1">→</span> {b.dropoff}</td>
                    <td className="px-4 py-3 capitalize text-xs">{b.ride_type}</td>
                    <td className="px-4 py-3">{b.passengers}</td>
                    <td className="px-4 py-3 text-gold">${(b.price ?? b.suggested_price ?? 0).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <select value={b.status} onChange={(e) => updateStatus(b.id, e.target.value)}
                        className="bg-input border border-border/60 rounded px-2 py-1 text-xs capitalize">
                        {["requested", "assigned", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {filteredBookings.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">{t("admin.empty.reservations")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ============ DRIVERS ============ */}
        {tab === "drivers" && !busy && (
          <DriversPanel drivers={filteredDrivers} vehicles={vehicles} onRefresh={refresh} />
        )}

        {/* ============ VEHICLES ============ */}
        {tab === "vehicles" && !busy && (
          <VehiclesPanel vehicles={filteredVehicles} onRefresh={refresh} />
        )}

        {/* ============ REFERRALS ============ */}
        {tab === "referrals" && <ReferralsPanel />}

        {/* ============ DISCOUNTS (existing) ============ */}
        {tab === "discounts" && !busy && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-muted-foreground">{t("admin.discounts.subtitle")}</div>
              <button onClick={addDiscount} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ {t("admin.discounts.new")}</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {discounts.map((d) => (
                <div key={d.id} className="rounded-lg border border-border/60 bg-surface p-5 flex items-center justify-between">
                  <div>
                    <div className="font-display text-lg text-gradient-gold">{d.min_miles}–{d.max_miles} {t("admin.discounts.miles")}</div>
                    <div className="text-xs text-muted-foreground mt-1">-${d.flat_off} {t("admin.discounts.flat")} · -{d.percent_off}% {t("admin.discounts.percent")}</div>
                  </div>
                  <button onClick={() => deleteDiscount(d.id)} className="text-xs text-destructive hover:underline">{t("admin.discounts.delete")}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============ CONCIERGE (existing) ============ */}
        {tab === "concierge" && !busy && (
          <div className="space-y-2">
            {messages.length === 0 && <div className="text-muted-foreground text-sm">{t("admin.empty.conversations")}</div>}
            {messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-border/60 bg-surface p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span className="uppercase tracking-widest">{m.role} · {m.user_language}</span>
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm">{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

// ============ DRIVERS PANEL ============
function DriversPanel({ drivers, vehicles, onRefresh }: { drivers: Driver[]; vehicles: Vehicle[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Partial<Driver> | null>(null);
  const upsertDriver = useServerFn(adminUpsertDriver);
  const deleteDriver = useServerFn(adminDeleteDriver);

  async function save() {
    if (!editing?.full_name || !editing.employee_id) { toast.error("Name and Employee ID are required"); return; }
    try {
      await upsertDriver({ data: {
        id: editing.id ?? null,
        payload: {
          full_name: editing.full_name,
          employee_id: editing.employee_id,
          phone: editing.phone ?? null,
          email: editing.email ?? null,
          photo_url: editing.photo_url ?? null,
          license_number: editing.license_number ?? null,
          license_expires_at: editing.license_expires_at || null,
          employment_status: (editing.employment_status ?? "active") as "active" | "inactive" | "vacation",
          availability_status: (editing.availability_status ?? "offline") as "available" | "assigned" | "on_trip" | "offline" | "vacation",
          assigned_vehicle_id: editing.assigned_vehicle_id || null,
          notes: editing.notes ?? null,
        },
      } });
      toast.success("Driver saved"); setEditing(null); onRefresh();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function remove(id: string) {
    if (!confirm("Delete driver?")) return;
    try { await deleteDriver({ data: { id } }); onRefresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{drivers.length} drivers</div>
        <button onClick={() => setEditing({ employment_status: "active", availability_status: "offline" })}
          className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ New Driver</button>
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Contact</th>
              <th className="text-left px-4 py-3">License</th>
              <th className="text-left px-4 py-3">Vehicle</th>
              <th className="text-left px-4 py-3">Employment</th>
              <th className="text-left px-4 py-3">Availability</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(d => {
              const v = vehicles.find(x => x.id === d.assigned_vehicle_id);
              return (
                <tr key={d.id} className="border-t border-border/40 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.full_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{d.employee_id}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{d.phone ?? "—"}</div>
                    <div className="text-muted-foreground">{d.email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{d.license_number ?? "—"}</div>
                    <div className="text-muted-foreground">{d.license_expires_at ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{v ? `${v.name} · ${v.license_plate}` : "—"}</td>
                  <td className="px-4 py-3"><StatusPill tone={d.employment_status as any}>{d.employment_status}</StatusPill></td>
                  <td className="px-4 py-3"><StatusPill tone={d.availability_status as any}>{d.availability_status.replace("_"," ")}</StatusPill></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(d)} className="text-xs text-gold hover:underline mr-3">Edit</button>
                    <button onClick={() => remove(d.id)} className="text-xs text-destructive hover:underline">Delete</button>
                  </td>
                </tr>
              );
            })}
            {drivers.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No drivers</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Edit driver" : "New driver"}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Full name *"    value={editing.full_name ?? ""}         onChange={v => setEditing({ ...editing, full_name: v })} />
            <Input label="Employee ID *"  value={editing.employee_id ?? ""}       onChange={v => setEditing({ ...editing, employee_id: v })} />
            <Input label="Phone"          value={editing.phone ?? ""}             onChange={v => setEditing({ ...editing, phone: v })} />
            <Input label="Email"          value={editing.email ?? ""}             onChange={v => setEditing({ ...editing, email: v })} />
            <Input label="Photo URL"      value={editing.photo_url ?? ""}         onChange={v => setEditing({ ...editing, photo_url: v })} />
            <Input label="License #"      value={editing.license_number ?? ""}    onChange={v => setEditing({ ...editing, license_number: v })} />
            <Input label="License expires" type="date" value={editing.license_expires_at ?? ""} onChange={v => setEditing({ ...editing, license_expires_at: v })} />
            <Select label="Vehicle" value={editing.assigned_vehicle_id ?? ""} onChange={v => setEditing({ ...editing, assigned_vehicle_id: v || null })}
              options={[{ value: "", label: "— None —" }, ...vehicles.map(v => ({ value: v.id, label: `${v.name} · ${v.license_plate}` }))]} />
            <Select label="Employment" value={editing.employment_status ?? "active"} onChange={v => setEditing({ ...editing, employment_status: v })}
              options={["active","inactive","vacation"].map(s => ({ value: s, label: s }))} />
            <Select label="Availability" value={editing.availability_status ?? "offline"} onChange={v => setEditing({ ...editing, availability_status: v })}
              options={["available","assigned","on_trip","offline","vacation"].map(s => ({ value: s, label: s.replace("_"," ") }))} />
            <div className="sm:col-span-2">
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Notes</label>
              <textarea value={editing.notes ?? ""} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                rows={3} className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={save} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ VEHICLES PANEL ============
function VehiclesPanel({ vehicles, onRefresh }: { vehicles: Vehicle[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Partial<Vehicle> | null>(null);
  const upsertVehicle = useServerFn(adminUpsertVehicle);
  const deleteVehicle = useServerFn(adminDeleteVehicle);

  async function save() {
    if (!editing?.name || !editing.license_plate) { toast.error("Name and plate are required"); return; }
    try {
      await upsertVehicle({ data: {
        id: editing.id ?? null,
        payload: {
          name: editing.name,
          category: (editing.category ?? "other") as "escalade" | "suburban" | "denali" | "other",
          license_plate: editing.license_plate,
          vin: editing.vin ?? null,
          model_year: editing.model_year ?? null,
          seats: editing.seats ?? 6,
          status: (editing.status ?? "active") as "active" | "maintenance",
          insurance_expires_at: editing.insurance_expires_at || null,
        },
      } });
      toast.success("Vehicle saved"); setEditing(null); onRefresh();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function remove(id: string) {
    if (!confirm("Delete vehicle?")) return;
    try { await deleteVehicle({ data: { id } }); onRefresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{vehicles.length} vehicles</div>
        <button onClick={() => setEditing({ category: "other", status: "active", seats: 6 })}
          className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ New Vehicle</button>
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Vehicle</th>
              <th className="text-left px-4 py-3">Plate</th>
              <th className="text-left px-4 py-3">VIN</th>
              <th className="text-left px-4 py-3">Year</th>
              <th className="text-left px-4 py-3">Seats</th>
              <th className="text-left px-4 py-3">Insurance</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map(v => (
              <tr key={v.id} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-[11px] text-muted-foreground capitalize">{v.category}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{v.license_plate}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{v.vin ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{v.model_year ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{v.seats}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{v.insurance_expires_at ?? "—"}</td>
                <td className="px-4 py-3"><StatusPill tone={v.status as any}>{v.status}</StatusPill></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditing(v)} className="text-xs text-gold hover:underline mr-3">Edit</button>
                  <button onClick={() => remove(v.id)} className="text-xs text-destructive hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No vehicles</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Edit vehicle" : "New vehicle"}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Name *"          value={editing.name ?? ""}          onChange={v => setEditing({ ...editing, name: v })} />
            <Select label="Category"       value={editing.category ?? "other"} onChange={v => setEditing({ ...editing, category: v })}
              options={["escalade","suburban","denali","other"].map(s => ({ value: s, label: s }))} />
            <Input label="License plate *" value={editing.license_plate ?? ""} onChange={v => setEditing({ ...editing, license_plate: v })} />
            <Input label="VIN"             value={editing.vin ?? ""}           onChange={v => setEditing({ ...editing, vin: v })} />
            <Input label="Model year"      type="number" value={String(editing.model_year ?? "")} onChange={v => setEditing({ ...editing, model_year: v ? Number(v) : null })} />
            <Input label="Seats"           type="number" value={String(editing.seats ?? 6)}       onChange={v => setEditing({ ...editing, seats: Number(v) })} />
            <Select label="Status"         value={editing.status ?? "active"}  onChange={v => setEditing({ ...editing, status: v })}
              options={["active","maintenance"].map(s => ({ value: s, label: s }))} />
            <Input label="Insurance expires" type="date" value={editing.insurance_expires_at ?? ""} onChange={v => setEditing({ ...editing, insurance_expires_at: v })} />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={save} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ small primitives ============
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-surface p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-xl">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
    </div>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm capitalize">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
