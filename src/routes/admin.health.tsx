import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  opsHealthSnapshot, opsRecentEvents, opsListIntegrations, opsRecordIntegration,
  opsListRestoreDrills, opsRecordRestoreDrill,
  type HealthSnapshot, type MonitoringRow, type IntegrationRow, type RestoreDrillRow,
} from "@/lib/ops.functions";

export const Route = createFileRoute("/admin/health")({
  head: () => ({ meta: [
    { title: "System Health — HarborLine" },
    { name: "description", content: "HarborLine system health, integrations, and restore drills." },
  ]}),
  component: SystemHealth,
});

function StatusDot({ status }: { status: string }) {
  const color =
    status === "healthy" ? "bg-emerald-500" :
    status === "degraded" ? "bg-amber-500" :
    status === "down" ? "bg-red-500" : "bg-slate-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={status} />;
}

function SystemHealth() {
  const { user, role, loading } = useAuth();
  const nav = useNavigate();

  const snapshot = useServerFn(opsHealthSnapshot);
  const recent = useServerFn(opsRecentEvents);
  const listInt = useServerFn(opsListIntegrations);
  const recordInt = useServerFn(opsRecordIntegration);
  const listDrills = useServerFn(opsListRestoreDrills);
  const recordDrill = useServerFn(opsRecordRestoreDrill);

  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [events, setEvents] = useState<MonitoringRow[]>([]);
  const [ints, setInts] = useState<IntegrationRow[]>([]);
  const [drills, setDrills] = useState<RestoreDrillRow[]>([]);
  const [busy, setBusy] = useState(true);

  // Integration form
  const [iName, setIName] = useState("");
  const [iStatus, setIStatus] = useState<"healthy" | "degraded" | "down" | "unknown">("healthy");
  const [iLatency, setILatency] = useState<string>("");

  // Drill form
  const [dMethod, setDMethod] = useState("pitr");
  const [dDataset, setDDataset] = useState("bookings");
  const [dResult, setDResult] = useState<"passed" | "failed" | "partial">("passed");
  const [dNotes, setDNotes] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) { nav({ to: "/admin/login" }); return; }
    if (role !== null && role !== "admin") { toast.error("Admin access required"); nav({ to: "/admin/login" }); }
  }, [user, role, loading, nav]);

  async function refresh() {
    setBusy(true);
    try {
      const [s, e, i, d] = await Promise.all([
        snapshot({}), recent({ data: { limit: 100 } }),
        listInt({}), listDrills({}),
      ]);
      setSnap(s as HealthSnapshot);
      setEvents(e as MonitoringRow[]);
      setInts(i as IntegrationRow[]);
      setDrills(d as RestoreDrillRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load health data");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { if (role === "admin") void refresh(); /* eslint-disable-next-line */ }, [role]);

  async function submitIntegration(e: React.FormEvent) {
    e.preventDefault();
    if (!iName.trim()) return;
    try {
      await recordInt({ data: {
        integration: iName.trim(),
        status: iStatus,
        latency_ms: iLatency ? Number(iLatency) : undefined,
        details: {},
      }});
      toast.success("Integration health recorded");
      setIName(""); setILatency("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record");
    }
  }

  async function submitDrill(e: React.FormEvent) {
    e.preventDefault();
    try {
      await recordDrill({ data: { method: dMethod, dataset: dDataset, result: dResult, notes: dNotes || undefined }});
      toast.success("Restore drill recorded");
      setDNotes("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record");
    }
  }

  return (
    <main className="min-h-dvh bg-obsidian">
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-gold">System Health</h1>
            <p className="text-sm text-muted-foreground">Observability, integration status, and restore drills.</p>
          </div>
          <div className="flex gap-2">
            <Link to="/admin" className="rounded-lg border border-border/60 px-3 py-2 text-sm hover:border-gold/60">← Admin</Link>
            <button onClick={refresh} disabled={busy}
              className="rounded-lg bg-gold px-3 py-2 text-sm font-medium text-obsidian disabled:opacity-50">
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>
        </header>

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {[
            { k: "Events / 1h", v: snap?.events_1h ?? "—" },
            { k: "Errors / 1h", v: snap?.errors_1h ?? "—" },
            { k: "Fatal / 1h", v: snap?.fatal_1h ?? "—" },
            { k: "Bookings / 24h", v: snap?.bookings_24h ?? "—" },
            { k: "Stripe errors / 24h", v: snap?.stripe_errors_24h ?? "—" },
            { k: "Last restore drill", v: snap?.last_restore_drill ? new Date(snap.last_restore_drill).toLocaleDateString() : "Never" },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.k}</div>
              <div className="mt-1 text-lg font-semibold">{String(c.v)}</div>
            </div>
          ))}
        </div>

        {/* Integrations */}
        <section className="mb-8">
          <h2 className="font-display text-xl text-gold mb-3">Integrations</h2>
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left px-3 py-2">Integration</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Latency</th><th className="text-left px-3 py-2">Checked</th></tr>
              </thead>
              <tbody>
                {ints.length === 0 && (<tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No integration health recorded yet.</td></tr>)}
                {ints.map((r) => (
                  <tr key={r.integration} className="border-t border-border/40">
                    <td className="px-3 py-2 font-medium">{r.integration}</td>
                    <td className="px-3 py-2"><StatusDot status={r.status} /> <span className="ml-2 capitalize">{r.status}</span></td>
                    <td className="px-3 py-2">{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(r.checked_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={submitIntegration} className="mt-3 flex flex-wrap gap-2 items-end">
            <label className="text-xs text-muted-foreground">Integration
              <input value={iName} onChange={(e) => setIName(e.target.value)} placeholder="stripe, google_maps, twilio…"
                className="block mt-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">Status
              <select value={iStatus} onChange={(e) => setIStatus(e.target.value as typeof iStatus)}
                className="block mt-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm">
                <option value="healthy">healthy</option><option value="degraded">degraded</option>
                <option value="down">down</option><option value="unknown">unknown</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Latency (ms)
              <input value={iLatency} onChange={(e) => setILatency(e.target.value)} inputMode="numeric" placeholder="optional"
                className="block mt-1 w-32 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </label>
            <button className="rounded-lg bg-gold px-3 py-2 text-sm font-medium text-obsidian">Record</button>
          </form>
        </section>

        {/* Restore drills */}
        <section className="mb-8">
          <h2 className="font-display text-xl text-gold mb-3">Restore Drills</h2>
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Method</th><th className="text-left px-3 py-2">Dataset</th><th className="text-left px-3 py-2">Result</th><th className="text-left px-3 py-2">Notes</th></tr>
              </thead>
              <tbody>
                {drills.length === 0 && (<tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No restore drills recorded. See docs/backup-restore.md.</td></tr>)}
                {drills.map((d) => (
                  <tr key={d.id} className="border-t border-border/40">
                    <td className="px-3 py-2 text-muted-foreground">{new Date(d.performed_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{d.method}</td>
                    <td className="px-3 py-2">{d.dataset}</td>
                    <td className="px-3 py-2 capitalize">{d.result}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-xs">{d.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={submitDrill} className="mt-3 flex flex-wrap gap-2 items-end">
            <label className="text-xs text-muted-foreground">Method
              <select value={dMethod} onChange={(e) => setDMethod(e.target.value)}
                className="block mt-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm">
                <option value="pitr">Point-in-time recovery</option>
                <option value="snapshot">Snapshot</option>
                <option value="logical">Logical dump</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Dataset
              <input value={dDataset} onChange={(e) => setDDataset(e.target.value)}
                className="block mt-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">Result
              <select value={dResult} onChange={(e) => setDResult(e.target.value as typeof dResult)}
                className="block mt-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm">
                <option value="passed">passed</option><option value="partial">partial</option><option value="failed">failed</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex-1 min-w-64">Notes
              <input value={dNotes} onChange={(e) => setDNotes(e.target.value)}
                className="block mt-1 w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </label>
            <button className="rounded-lg bg-gold px-3 py-2 text-sm font-medium text-obsidian">Record drill</button>
          </form>
        </section>

        {/* Recent monitoring events */}
        <section>
          <h2 className="font-display text-xl text-gold mb-3">Recent Monitoring Events</h2>
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Severity</th><th className="text-left px-3 py-2">Source</th><th className="text-left px-3 py-2">Message</th></tr>
              </thead>
              <tbody>
                {events.length === 0 && (<tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No events captured.</td></tr>)}
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 uppercase text-xs">{e.severity}</td>
                    <td className="px-3 py-2">{e.source}</td>
                    <td className="px-3 py-2 truncate max-w-lg">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
