import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowLeft, Car, FileText, Wrench, History } from "lucide-react";
import { adminUpsertVehicle, adminDeleteVehicle } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/vehicles/$id")({
  head: () => ({ meta: [{ title: "Vehicle — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: VehicleDetail,
});

function VehicleDetail() {
  const { id } = Route.useParams();
  const [vehicle, setVehicle] = useState<any>(null);
  const [driver, setDriver] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const upsertVehicle = useServerFn(adminUpsertVehicle);
  const deleteVehicle = useServerFn(adminDeleteVehicle);

  async function load() {
    setBusy(true);
    const [v, d, a] = await Promise.all([
      (supabase as any).from("vehicles").select("*").eq("id", id).maybeSingle(),
      (supabase as any).from("driver_profiles").select("id, full_name, employee_id").eq("assigned_vehicle_id", id).maybeSingle(),
      (supabase as any).from("booking_assignments")
        .select("id, dispatch_status, assigned_at, is_current, bookings:booking_id(id, pickup, dropoff, pickup_time, status)")
        .eq("vehicle_id", id).order("assigned_at", { ascending: false }).limit(50),
    ]);
    setVehicle(v.data ?? null);
    setDriver(d.data ?? null);
    setAssignments((a.data ?? []) as any[]);
    setBusy(false);
  }
  useEffect(() => { load(); }, [id]);

  async function save() {
    if (!form?.name || !form?.license_plate) { toast.error("Name and plate required"); return; }
    try {
      await upsertVehicle({ data: {
        id,
        payload: {
          name: form.name,
          category: form.category ?? "other",
          license_plate: form.license_plate,
          vin: form.vin ?? null,
          model_year: form.model_year ?? null,
          seats: form.seats ?? 6,
          status: form.status ?? "active",
          insurance_expires_at: form.insurance_expires_at || null,
        },
      } });
      toast.success("Vehicle saved");
      setEditing(false); load();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function remove() {
    if (!confirm("Delete this vehicle?")) return;
    try {
      await deleteVehicle({ data: { id } });
      toast.success("Vehicle deleted");
      window.history.back();
    } catch (e) { toast.error((e as Error).message); }
  }

  if (busy) return <div className="text-muted-foreground text-sm">Loading vehicle…</div>;
  if (!vehicle) return (
    <div className="max-w-md mx-auto text-center py-16">
      <p className="text-muted-foreground text-sm">Vehicle not found.</p>
      <Link to="/admin/vehicles" className="mt-4 inline-flex items-center gap-2 text-sm text-gold hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to vehicles
      </Link>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link to="/admin/vehicles" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All vehicles
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">{vehicle.license_plate}</div>
          <h1 className="font-display text-3xl mt-1">{vehicle.name}</h1>
          <div className="mt-2 text-sm text-muted-foreground capitalize">{vehicle.category}{vehicle.model_year ? ` · ${vehicle.model_year}` : ""} · {vehicle.seats} seats</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={vehicle.status as any}>{vehicle.status}</StatusPill>
          <button onClick={() => { setForm(vehicle); setEditing(true); }} className="rounded-full border border-border/60 px-4 py-1.5 text-xs hover:border-gold/60 hover:text-gold">Edit</button>
          <button onClick={remove} className="rounded-full border border-border/60 px-4 py-1.5 text-xs hover:border-rose-500/60 hover:text-rose-300">Delete</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Specifications" icon={<Car className="h-4 w-4" />}>
          <dl className="text-sm space-y-1.5">
            <Row k="VIN">{vehicle.vin ?? "—"}</Row>
            <Row k="Category" className="capitalize">{vehicle.category}</Row>
            <Row k="Model year">{vehicle.model_year ?? "—"}</Row>
            <Row k="Seats">{vehicle.seats}</Row>
          </dl>
        </Section>

        <Section title="Documents" icon={<FileText className="h-4 w-4" />}>
          <dl className="text-sm space-y-1.5">
            <Row k="Insurance">{vehicle.insurance_expires_at ?? "—"}</Row>
          </dl>
        </Section>

        <Section title="Assigned driver" icon={<Wrench className="h-4 w-4" />}>
          {driver ? (
            <div className="text-sm space-y-1.5">
              <div className="font-medium">{driver.full_name}</div>
              <div className="text-xs font-mono text-muted-foreground">{driver.employee_id}</div>
              <Link to="/admin/drivers/$id" params={{ id: driver.id }} className="text-xs text-gold hover:underline">Open driver →</Link>
            </div>
          ) : <div className="text-sm text-muted-foreground">No driver assigned.</div>}
        </Section>
      </div>

      <Section title="Assignment history" icon={<History className="h-4 w-4" />}>
        {assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No assignments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Route</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => (
                  <tr key={a.id} className="border-t border-border/40">
                    <td className="py-2 text-xs tabular-nums whitespace-nowrap">{a.bookings?.pickup_time ? new Date(a.bookings.pickup_time).toLocaleString() : "—"}</td>
                    <td className="py-2">{a.bookings?.pickup} <span className="text-gold mx-1">→</span> {a.bookings?.dropoff}</td>
                    <td className="py-2"><StatusPill tone={a.dispatch_status as any}>{a.dispatch_status.replace("_", " ")}</StatusPill></td>
                    <td className="py-2 text-right">
                      {a.bookings?.id && (
                        <Link to="/admin/trips/$id" params={{ id: a.bookings.id }} className="text-xs text-gold hover:underline">View</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {editing && form && (
        <Modal onClose={() => setEditing(false)} title="Edit vehicle">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Name *"          value={form.name ?? ""}          onChange={v => setForm({ ...form, name: v })} />
            <Select label="Category"       value={form.category ?? "other"} onChange={v => setForm({ ...form, category: v })}
              options={["escalade", "suburban", "denali", "other"]} />
            <Input label="License plate *" value={form.license_plate ?? ""} onChange={v => setForm({ ...form, license_plate: v })} />
            <Input label="VIN"             value={form.vin ?? ""}           onChange={v => setForm({ ...form, vin: v })} />
            <Input label="Model year"      type="number" value={String(form.model_year ?? "")} onChange={v => setForm({ ...form, model_year: v ? Number(v) : null })} />
            <Input label="Seats"           type="number" value={String(form.seats ?? 6)}       onChange={v => setForm({ ...form, seats: Number(v) })} />
            <Select label="Status"         value={form.status ?? "active"}  onChange={v => setForm({ ...form, status: v })}
              options={["active", "maintenance"]} />
            <Input label="Insurance expires" type="date" value={form.insurance_expires_at ?? ""} onChange={v => setForm({ ...form, insurance_expires_at: v })} />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={save} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-surface/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-gold/70">{icon}</span>}
        <h3 className="font-display text-base">{title}</h3>
      </div>
      {children}
    </section>
  );
}
function Row({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground text-xs uppercase tracking-widest w-28 shrink-0 pt-0.5">{k}</dt>
      <dd className={"text-right flex-1 " + (className ?? "")}>{children}</dd>
    </div>
  );
}
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
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm capitalize">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
