import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  id: string; actor_email: string | null; action: string; entity_type: string;
  entity_id: string | null; previous: unknown; next: unknown; reason: string | null; created_at: string;
}

export function AuditTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    (async () => {
      setBusy(true);
      const { data } = await (supabase as any).from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
      setRows((data ?? []) as Row[]);
      setBusy(false);
    })();
  }, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      r.action.toLowerCase().includes(s) ||
      r.entity_type.toLowerCase().includes(s) ||
      (r.actor_email ?? "").toLowerCase().includes(s) ||
      (r.entity_id ?? "").toLowerCase().includes(s) ||
      (r.reason ?? "").toLowerCase().includes(s),
    );
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, actor, entity…"
        className="w-full max-w-md rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
      {busy && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">When</th>
              <th className="text-left px-4 py-3">Administrator</th>
              <th className="text-left px-4 py-3">Action</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-left px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <>
                <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="border-t border-border/40 cursor-pointer hover:bg-accent/40">
                  <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">{r.actor_email ?? r.id.slice(0,8)}</td>
                  <td className="px-4 py-3 text-xs font-medium text-gold">{r.action}</td>
                  <td className="px-4 py-3 text-xs">{r.entity_type} · {r.entity_id?.slice(0,8) ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-xs">{r.reason ?? "—"}</td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-surface/40">
                    <td colSpan={5} className="px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Previous</div>
                          <pre className="rounded bg-black/40 p-3 text-[11px] overflow-auto max-h-64">{JSON.stringify(r.previous, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Next</div>
                          <pre className="rounded bg-black/40 p-3 text-[11px] overflow-auto max-h-64">{JSON.stringify(r.next, null, 2)}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!busy && filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">No audit records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
