import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";
import { ArrowRight, Search, Plus } from "lucide-react";
import { adminUpsertVehicle } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: VehiclesList,
});

interface Vehicle {
  id: string; name: string; category: string; license_plate: string; vin: string | null;
  model_year: number | null; seats: number; status: string; insurance_expires_at: string | null;
}

function VehiclesList() {
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Record<string, { id: string; full_name: string }>>({});
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [statusF, setStatusF] = useState("all");
  const [creating, setCreating] = useState<any>(null);
  const upsertVehicle = useServerFn(adminUpsertVehicle);

  async function load() {
    setBusy(true);
    const [v, d] = await Promise.all([
      (supabase as any).from("vehicles").select("*").order("name"),
      (supabase as any).from("driver_profiles").select("id, full_name, assigned_vehicle_id"),
    ]);
    setRows((v.data ?? []) as Vehicle[]);
    const map: Record<string, { id: string; full_name: string }> = {};
    for (const drv of (d.data ?? [])) {
      if (drv.assigned_vehicle_id) map[drv.assigned_vehicle_id] = { id: drv.id, full_name: drv.full_name };
    }
    setDrivers(map);
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return rows.filter(v => {
      if (statusF !== "all" && v.status !== statusF) return false;
      if (!s) return true;
      return v.name.toLowerCase().includes(s) || v.license_plate.toLowerCase().includes(s) || (v.vin ?? "").toLowerCase().includes(s);
    });
  }, [rows, dq, statusF]);

  async function saveNew() {
    if (!creating?.name || !creating?.license_plate) { toast.error("Name and plate required"); return; }
    try {
      await upsertVehicle({ data: {
        id: null,
        payload: {
          name: creating.name,
          category: creating.category ?? "other",
          license_plate: creating.license_plate,
          vin: creating.vin ?? null,
          model_year: creating.model_year ?? null,
          seats: creating.seats ?? 6,
          status: creating.status ?? "active",
          insurance_expires_at: creating.insurance_expires_at || null,
        },
      } });
      toast.success("Vehicle added");
      setCreating(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Fleet</div>
          <h1 className="font-display text-3xl mt-1">Vehicles</h1>
        </div>
        <button
          onClick={() => setCreating({ category: "other", status: "active", seats: 6 })}
          className="inline-flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold"
        >
          <Plus className="h-3.5 w-3.5" /> New vehicle
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, plate, VIN…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/60 bg-input text-sm focus-luxe"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface/50 p-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground px-2">Status</span>
          {["all", "active", "maintenance"].map(o => (
            <button key={o} onClick={() => setStatusF(o)}
              className={"rounded-md px-2.5 py-1 text-xs capitalize transition " + (statusF === o ? "bg-gold/15 text-gold" : "text-muted-foreground hover:text-foreground")}>
              {o}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Vehicle</th>
                <th className="text-left px-4 py-3">Plate</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Assigned driver</th>
                <th className="text-left px-4 py-3">Seats</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {busy && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!busy && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No vehicles.</td></tr>}
              {!busy && filtered.map(v => {
                const drv = drivers[v.id];
                return (
                  <tr key={v.id} className="border-t border-border/40 hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{v.name}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">{v.category}{v.model_year ? ` · ${v.model_year}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{v.license_plate}</td>
                    <td className="px-4 py-3"><StatusPill tone={v.status as any}>{v.status}</StatusPill></td>
                    <td className="px-4 py-3 text-xs">{drv ? drv.full_name : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 tabular-nums">{v.seats}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/admin/vehicles/$id" params={{ id: v.id }} className="inline-flex items-center gap-1 text-xs text-gold hover:underline">
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
      <div className="text-[11px] text-muted-foreground">{filtered.length} vehicle{filtered.length === 1 ? "" : "s"}</div>

      {creating && (
        <Modal onClose={() => setCreating(null)} title="New vehicle">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Name *"          value={creating.name ?? ""}          onChange={v => setCreating({ ...creating, name: v })} />
            <Select label="Category"       value={creating.category ?? "other"} onChange={v => setCreating({ ...creating, category: v })}
              options={["escalade", "suburban", "denali", "other"]} />
            <Input label="License plate *" value={creating.license_plate ?? ""} onChange={v => setCreating({ ...creating, license_plate: v })} />
            <Input label="VIN"             value={creating.vin ?? ""}           onChange={v => setCreating({ ...creating, vin: v })} />
            <Input label="Model year"      type="number" value={String(creating.model_year ?? "")} onChange={v => setCreating({ ...creating, model_year: v ? Number(v) : null })} />
            <Input label="Seats"           type="number" value={String(creating.seats ?? 6)}       onChange={v => setCreating({ ...creating, seats: Number(v) })} />
            <Select label="Status"         value={creating.status ?? "active"}  onChange={v => setCreating({ ...creating, status: v })}
              options={["active", "maintenance"]} />
            <Input label="Insurance expires" type="date" value={creating.insurance_expires_at ?? ""} onChange={v => setCreating({ ...creating, insurance_expires_at: v })} />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setCreating(null)} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={saveNew} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}
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
