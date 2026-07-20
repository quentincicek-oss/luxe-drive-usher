import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  adminListAmenities, adminUpsertAmenity, adminDeleteAmenity,
} from "@/lib/amenities.functions";

type Amenity = {
  id: string; code: string; name: string; description: string | null;
  category_id: string | null; category_name: string | null;
  price_delta_cents: number; complimentary: boolean; active: boolean;
  display_order: number; allowed_ride_types: string[];
  internal_cost_cents: number | null; inventory_note: string | null;
};

const RIDE_TYPES = ["escalade", "suburban", "denali"] as const;

export function AmenitiesPanel() {
  const [items, setItems] = useState<Amenity[]>([]);
  const [editing, setEditing] = useState<Partial<Amenity> | null>(null);
  const listFn = useServerFn(adminListAmenities);
  const upsertFn = useServerFn(adminUpsertAmenity);
  const delFn = useServerFn(adminDeleteAmenity);

  const load = useCallback(async () => {
    try {
      const rows = await listFn({});
      setItems((rows ?? []) as unknown as Amenity[]);
    } catch (e) { toast.error((e as Error).message); }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.code || !editing.name) { toast.error("Code and name required"); return; }
    try {
      await upsertFn({ data: {
        id: editing.id ?? null,
        payload: {
          code: editing.code, name: editing.name, description: editing.description ?? null,
          category_id: editing.category_id ?? null,
          price_delta_cents: Number(editing.price_delta_cents ?? 0),
          complimentary: !!editing.complimentary,
          active: editing.active ?? true,
          display_order: Number(editing.display_order ?? 0),
          allowed_ride_types: editing.allowed_ride_types ?? [...RIDE_TYPES],
          internal_cost_cents: editing.internal_cost_cents ?? null,
          inventory_note: editing.inventory_note ?? null,
        },
      } });
      toast.success("Amenity saved");
      setEditing(null); load();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete or deactivate amenity?")) return;
    try { await delFn({ data: { id } }); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{items.length} amenities</div>
        <button onClick={() => setEditing({
          code: "", name: "", price_delta_cents: 0, complimentary: false, active: true,
          allowed_ride_types: [...RIDE_TYPES],
        })}
          className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">
          + New amenity
        </button>
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Code / Name</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Price</th>
              <th className="text-left px-4 py-3">Ride types</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{a.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{a.code}</div>
                </td>
                <td className="px-4 py-3 text-xs">{a.category_name ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {a.complimentary
                    ? <span className="text-emerald-400">Complimentary</span>
                    : <span className="text-gold">${(a.price_delta_cents / 100).toFixed(2)}</span>}
                  {a.internal_cost_cents != null && (
                    <div className="text-[10px] text-muted-foreground">internal ${(a.internal_cost_cents / 100).toFixed(2)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-[11px]">{a.allowed_ride_types.join(", ")}</td>
                <td className="px-4 py-3 text-xs">{a.active ? "Active" : "Inactive"}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditing(a)} className="text-xs text-gold hover:underline mr-3">Edit</button>
                  <button onClick={() => remove(a.id)} className="text-xs text-destructive hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No amenities yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
             onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface border border-border/60 p-6"
               onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg mb-4">{editing.id ? "Edit amenity" : "New amenity"}</div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label-luxe">Code (stable)</div>
                  <input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    className="w-full rounded border border-border/60 bg-input px-2 py-1.5" />
                </div>
                <div>
                  <div className="label-luxe">Name</div>
                  <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full rounded border border-border/60 bg-input px-2 py-1.5" />
                </div>
              </div>
              <div>
                <div className="label-luxe">Description</div>
                <textarea value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2} className="w-full rounded border border-border/60 bg-input px-2 py-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label-luxe">Price (cents)</div>
                  <input type="number" min={0} value={editing.price_delta_cents ?? 0}
                    onChange={(e) => setEditing({ ...editing, price_delta_cents: Number(e.target.value) })}
                    className="w-full rounded border border-border/60 bg-input px-2 py-1.5" />
                </div>
                <div>
                  <div className="label-luxe">Internal cost (cents, optional)</div>
                  <input type="number" min={0} value={editing.internal_cost_cents ?? ""}
                    onChange={(e) => setEditing({ ...editing, internal_cost_cents: e.target.value ? Number(e.target.value) : null })}
                    className="w-full rounded border border-border/60 bg-input px-2 py-1.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={editing.complimentary ?? false}
                    onChange={(e) => setEditing({ ...editing, complimentary: e.target.checked })} />
                  Complimentary (customer sees no charge)
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={editing.active ?? true}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                  Active
                </label>
              </div>
              <div>
                <div className="label-luxe">Allowed ride types</div>
                <div className="flex gap-3 text-xs">
                  {RIDE_TYPES.map((r) => (
                    <label key={r} className="flex items-center gap-1.5">
                      <input type="checkbox"
                        checked={(editing.allowed_ride_types ?? []).includes(r)}
                        onChange={(e) => {
                          const cur = new Set(editing.allowed_ride_types ?? []);
                          if (e.target.checked) cur.add(r); else cur.delete(r);
                          setEditing({ ...editing, allowed_ride_types: [...cur] });
                        }} />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)}
                  className="text-xs text-muted-foreground px-3 py-2">Cancel</button>
                <button onClick={save}
                  className="rounded-md bg-gold-gradient px-4 py-2 text-xs text-primary-foreground">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
