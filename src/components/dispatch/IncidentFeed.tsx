import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusPill } from "@/components/ops/StatusPill";

interface Incident {
  kind: "trip_event" | "cancellation" | "low_rating";
  id: string; label: string; reason: string | null; ref_id: string; created_at: string;
}

export function IncidentFeed() {
  const [items, setItems] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<"all" | "trip_event" | "cancellation" | "low_rating">("all");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    (async () => {
      setBusy(true);
      const { data } = await (supabase as any).rpc("admin_incident_feed", { _limit: 200 });
      setItems((data ?? []) as Incident[]);
      setBusy(false);
    })();
  }, []);
  const filtered = filter === "all" ? items : items.filter(i => i.kind === filter);
  const label = (k: Incident["kind"]) => k === "trip_event" ? "Trip event" : k === "cancellation" ? "Cancellation" : "Low rating";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["all","trip_event","cancellation","low_rating"] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${filter===k ? "bg-gold/10 text-gold ring-gold/30" : "bg-white/5 text-muted-foreground ring-white/10 hover:text-foreground"}`}>
            {k === "all" ? "All" : label(k)}
          </button>
        ))}
      </div>
      {busy && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!busy && filtered.length === 0 && <div className="rounded-lg border border-border/60 bg-surface/40 p-8 text-center text-sm text-muted-foreground">No incidents on record.</div>}
      <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-surface/40">
        {filtered.map(i => (
          <li key={`${i.kind}-${i.id}`} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusPill tone={i.kind === "cancellation" ? "cancelled" : i.kind === "low_rating" ? "muted" : "pending"}>{label(i.kind)}</StatusPill>
                <span className="text-sm font-medium capitalize">{i.label.replace(/_/g, " ")}</span>
              </div>
              {i.reason && <p className="mt-1 text-xs text-muted-foreground">{i.reason}</p>}
              <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">ref · {i.ref_id.slice(0,8)}</p>
            </div>
            <div className="text-[11px] tabular-nums text-muted-foreground">{new Date(i.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
