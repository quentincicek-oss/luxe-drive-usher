import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Search } from "lucide-react";
import { StatusPill } from "@/components/ops/StatusPill";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({ meta: [{ title: "Customers — HarborLine Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: CustomersList,
});

interface Customer {
  id: string; name: string | null; surname: string | null; email: string | null; phone: string | null;
  is_suspended: boolean | null; is_test_account: boolean | null; created_at: string;
  preferred_language: string | null;
}

function CustomersList() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      // Passengers only: profiles that appear in bookings (or all profiles minus admin/driver roles).
      // Simplest: list profiles that are not linked to driver_profiles or user_roles admin.
      const [profRes, roleRes, drvRes] = await Promise.all([
        supabase.from("profiles").select("id, name, surname, email, phone, is_suspended, is_test_account, created_at, preferred_language").order("created_at", { ascending: false }).limit(500),
        (supabase as any).from("user_roles").select("user_id, role").in("role", ["admin", "driver"]),
        (supabase as any).from("driver_profiles").select("user_id"),
      ]);
      if (!alive) return;
      const excluded = new Set<string>();
      for (const r of (roleRes.data ?? [])) if (r.user_id) excluded.add(r.user_id);
      for (const d of (drvRes.data ?? [])) if (d.user_id) excluded.add(d.user_id);
      const list = ((profRes.data ?? []) as Customer[]).filter(p => !excluded.has(p.id));
      setRows(list);

      const ids = list.map(l => l.id);
      if (ids.length) {
        const { data: bk } = await supabase.from("bookings").select("passenger_id").in("passenger_id", ids);
        const c: Record<string, number> = {};
        for (const b of (bk ?? [])) c[b.passenger_id] = (c[b.passenger_id] ?? 0) + 1;
        if (alive) setCounts(c);
      }
      setBusy(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => {
      const name = `${r.name ?? ""} ${r.surname ?? ""}`.trim().toLowerCase();
      return name.includes(s) || (r.email ?? "").toLowerCase().includes(s) || (r.phone ?? "").toLowerCase().includes(s);
    });
  }, [rows, dq]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold/60">Directory</div>
        <h1 className="font-display text-3xl mt-1">Customers</h1>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/60 bg-input text-sm focus-luxe"
        />
      </div>

      <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Phone</th>
                <th className="text-left px-4 py-3">Bookings</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {busy && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!busy && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No customers.</td></tr>}
              {!busy && filtered.map(r => {
                const name = `${r.name ?? ""} ${r.surname ?? ""}`.trim() || (r.email ?? "—");
                return (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{name}</div>
                      {r.is_test_account && <div className="text-[10px] uppercase tracking-widest text-amber-300">Test account</div>}
                    </td>
                    <td className="px-4 py-3">{r.email ?? "—"}</td>
                    <td className="px-4 py-3">{r.phone ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{counts[r.id] ?? 0}</td>
                    <td className="px-4 py-3">
                      {r.is_suspended
                        ? <StatusPill tone="cancelled">Suspended</StatusPill>
                        : <StatusPill tone="active">Active</StatusPill>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/admin/customers/$id" params={{ id: r.id }} className="inline-flex items-center gap-1 text-xs text-gold hover:underline">
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
      <div className="text-[11px] text-muted-foreground">{filtered.length} customer{filtered.length === 1 ? "" : "s"}</div>
    </div>
  );
}
