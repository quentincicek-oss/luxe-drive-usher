import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowLeft, UserCog, Car, FileText, CalendarClock, MapPin } from "lucide-react";
import { adminUpsertDriver } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/drivers/$id")({
  head: () => ({ meta: [{ title: "Driver — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: DriverDetail,
});

function DriverDetail() {
  const { id } = Route.useParams();
  const [driver, setDriver] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [unavail, setUnavail] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const upsertDriver = useServerFn(adminUpsertDriver);

  async function load() {
    setBusy(true);
    const [d, a, doc, un] = await Promise.all([
      (supabase as any).from("driver_profiles").select("*").eq("id", id).maybeSingle(),
      (supabase as any).from("booking_assignments")
        .select("id, dispatch_status, is_current, assigned_at, bookings:booking_id(id, pickup, dropoff, pickup_time, status)")
        .eq("driver_id", id).order("assigned_at", { ascending: false }).limit(50),
      (supabase as any).from("driver_documents").select("*").eq("driver_id", id).order("created_at", { ascending: false }).limit(20),
      (supabase as any).from("driver_unavailability").select("*").eq("driver_id", id).order("starts_at", { ascending: false }).limit(10),
    ]);
    setDriver(d.data ?? null);
    setAssignments((a.data ?? []) as any[]);
    setDocuments((doc.data ?? []) as any[]);
    setUnavail((un.data ?? []) as any[]);
    if (d.data?.assigned_vehicle_id) {
      const { data: v } = await (supabase as any).from("vehicles").select("*").eq("id", d.data.assigned_vehicle_id).maybeSingle();
      setVehicle(v ?? null);
    } else setVehicle(null);
    setBusy(false);
  }
  useEffect(() => { load(); }, [id]);

  async function saveEdit() {
    if (!form?.full_name || !form?.employee_id) { toast.error("Name and Employee ID are required"); return; }
    try {
      await upsertDriver({ data: {
        id,
        payload: {
          full_name: form.full_name,
          employee_id: form.employee_id,
          phone: form.phone ?? null,
          email: form.email ?? null,
          photo_url: form.photo_url ?? null,
          license_number: form.license_number ?? null,
          license_expires_at: form.license_expires_at || null,
          employment_status: form.employment_status ?? "active",
          availability_status: form.availability_status ?? "offline",
          assigned_vehicle_id: form.assigned_vehicle_id || null,
          notes: form.notes ?? null,
        },
      } });
      toast.success("Driver updated");
      setEditing(false);
      load();
    } catch (e) { toast.error((e as Error).message); }
  }

  if (busy) return <div className="text-muted-foreground text-sm">Loading driver…</div>;
  if (!driver) return (
    <div className="max-w-md mx-auto text-center py-16">
      <p className="text-muted-foreground text-sm">Driver not found.</p>
      <Link to="/admin/drivers" className="mt-4 inline-flex items-center gap-2 text-sm text-gold hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to drivers
      </Link>
    </div>
  );

  const currentAssignment = assignments.find(a => a.is_current);

  return (
    <div className="space-y-6">
      <Link to="/admin/drivers" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All drivers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">{driver.employee_id}</div>
          <h1 className="font-display text-3xl mt-1">{driver.full_name}</h1>
          <div className="mt-2 text-sm text-muted-foreground">{driver.email ?? "—"} · {driver.phone ?? "—"}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={driver.availability_status as any}>{driver.availability_status.replace("_", " ")}</StatusPill>
          <StatusPill tone={driver.employment_status as any}>{driver.employment_status}</StatusPill>
          <button
            onClick={() => { setForm(driver); setEditing(true); }}
            className="rounded-full border border-border/60 px-4 py-1.5 text-xs hover:border-gold/60 hover:text-gold"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Profile" icon={<UserCog className="h-4 w-4" />}>
          <dl className="text-sm space-y-1.5">
            <Row k="License #">{driver.license_number ?? "—"}</Row>
            <Row k="License expires">{driver.license_expires_at ?? "—"}</Row>
            <Row k="Photo">{driver.photo_url ? <a className="text-gold hover:underline text-xs" href={driver.photo_url} target="_blank" rel="noreferrer">View</a> : "—"}</Row>
            <Row k="Notes"><span className="whitespace-pre-wrap">{driver.notes || "—"}</span></Row>
          </dl>
        </Section>

        <Section title="Current assignment" icon={<MapPin className="h-4 w-4" />}>
          {currentAssignment?.bookings ? (
            <div className="text-sm space-y-1.5">
              <div>{currentAssignment.bookings.pickup} <span className="text-gold mx-1">→</span> {currentAssignment.bookings.dropoff}</div>
              <div className="text-xs text-muted-foreground">{new Date(currentAssignment.bookings.pickup_time).toLocaleString()}</div>
              <StatusPill tone={currentAssignment.dispatch_status as any}>{currentAssignment.dispatch_status.replace("_", " ")}</StatusPill>
              <div className="pt-2">
                <Link to="/admin/trips/$id" params={{ id: currentAssignment.bookings.id }} className="text-xs text-gold hover:underline">Open trip →</Link>
              </div>
            </div>
          ) : <div className="text-sm text-muted-foreground">No active trip.</div>}
        </Section>

        <Section title="Assigned vehicle" icon={<Car className="h-4 w-4" />}>
          {vehicle ? (
            <div className="text-sm space-y-1.5">
              <div className="font-medium">{vehicle.name}</div>
              <div className="font-mono text-xs">{vehicle.license_plate}</div>
              <div className="text-xs text-muted-foreground capitalize">{vehicle.category} · {vehicle.seats} seats</div>
              <Link to="/admin/vehicles/$id" params={{ id: vehicle.id }} className="text-xs text-gold hover:underline">View vehicle →</Link>
            </div>
          ) : <div className="text-sm text-muted-foreground">No vehicle assigned.</div>}
        </Section>
      </div>

      <Section title="Trip history" icon={<CalendarClock className="h-4 w-4" />}>
        {assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No trip history.</div>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Documents" icon={<FileText className="h-4 w-4" />}>
          {documents.length === 0 ? (
            <div className="text-sm text-muted-foreground">No documents uploaded.</div>
          ) : (
            <ul className="text-sm space-y-1.5">
              {documents.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between">
                  <span>{d.kind ?? d.type ?? "Document"}</span>
                  <span className="text-xs text-muted-foreground">{d.expires_at ?? d.uploaded_at ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Availability windows" icon={<CalendarClock className="h-4 w-4" />}>
          {unavail.length === 0 ? (
            <div className="text-sm text-muted-foreground">No time-off scheduled.</div>
          ) : (
            <ul className="text-sm space-y-1.5">
              {unavail.map((u: any) => (
                <li key={u.id} className="flex items-center justify-between">
                  <span>{u.reason ?? "Unavailable"}</span>
                  <span className="text-xs text-muted-foreground">
                    {u.starts_at ? new Date(u.starts_at).toLocaleDateString() : ""}
                    {" – "}
                    {u.ends_at ? new Date(u.ends_at).toLocaleDateString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Reserved for future earnings / payout — display only */}
      <Section title="Earnings & payouts" icon={<UserCog className="h-4 w-4" />}>
        <div className="rounded-lg border border-dashed border-border/50 p-4 text-[11px] text-muted-foreground">
          Driver earnings and Stripe Connect payout history will appear here.
        </div>
      </Section>

      {editing && form && (
        <EditModal onClose={() => setEditing(false)} title="Edit driver">
          <div className="grid sm:grid-cols-2 gap-3">
            <TxtInput label="Full name *"    value={form.full_name ?? ""}         onChange={v => setForm({ ...form, full_name: v })} />
            <TxtInput label="Employee ID *"  value={form.employee_id ?? ""}       onChange={v => setForm({ ...form, employee_id: v })} />
            <TxtInput label="Phone"          value={form.phone ?? ""}             onChange={v => setForm({ ...form, phone: v })} />
            <TxtInput label="Email"          value={form.email ?? ""}             onChange={v => setForm({ ...form, email: v })} />
            <TxtInput label="License #"      value={form.license_number ?? ""}    onChange={v => setForm({ ...form, license_number: v })} />
            <TxtInput label="License expires" type="date" value={form.license_expires_at ?? ""} onChange={v => setForm({ ...form, license_expires_at: v })} />
            <SelInput label="Employment" value={form.employment_status ?? "active"} onChange={v => setForm({ ...form, employment_status: v })}
              options={["active", "inactive", "vacation"]} />
            <SelInput label="Availability" value={form.availability_status ?? "offline"} onChange={v => setForm({ ...form, availability_status: v })}
              options={["available", "assigned", "on_trip", "offline", "vacation"]} />
            <div className="sm:col-span-2">
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Notes</label>
              <textarea rows={3} value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={saveEdit} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </EditModal>
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
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground text-xs uppercase tracking-widest w-28 shrink-0 pt-0.5">{k}</dt>
      <dd className="text-right flex-1">{children}</dd>
    </div>
  );
}
function EditModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
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
function TxtInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
    </div>
  );
}
function SelInput({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm capitalize">
        {options.map(o => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
      </select>
    </div>
  );
}
