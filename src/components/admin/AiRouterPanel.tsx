import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { aiRouterReport, type AiRouterReport } from "@/lib/ai.functions";

/** Admin-only diagnostics for the adaptive AI router. Read-only. */
export function AiRouterPanel() {
  const load = useServerFn(aiRouterReport);
  const [report, setReport] = useState<AiRouterReport | null>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    load({ data: { hours } })
      .then((r) => { if (alive) { setReport(r as AiRouterReport); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [hours, load]);

  const t = report?.totals ?? {};
  const kpi = [
    { k: "Requests", v: t["requests"] ?? "—" },
    { k: "Failures", v: t["failures"] ?? "—" },
    { k: "Fallbacks", v: t["fallbacks"] ?? "—" },
    { k: "Context trimmed", v: t["trimmed"] ?? "—" },
    { k: "p50 latency", v: t["p50_latency_ms"] != null ? `${t["p50_latency_ms"]} ms` : "—" },
    { k: "p95 latency", v: t["p95_latency_ms"] != null ? `${t["p95_latency_ms"]} ms` : "—" },
  ];

  return (
    <section className="mb-8 rounded-xl border border-border/60 bg-card/40 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-gold">AI Router</h2>
          <p className="text-xs text-muted-foreground">
            Adaptive model routing, fallbacks, and circuit breakers. Metadata only — no prompts or answers are stored.
          </p>
        </div>
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="rounded-lg border border-border/60 bg-input px-2 py-1.5 text-sm"
          aria-label="Time window"
        >
          <option value={1}>Last hour</option>
          <option value={24}>Last 24 hours</option>
          <option value={168}>Last 7 days</option>
        </select>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {busy && !report && <p className="text-sm text-muted-foreground">Loading…</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpi.map((c) => (
              <div key={c.k} className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.k}</div>
                <div className="mt-1 text-base font-semibold">{String(c.v)}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">By model</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-normal">Model</th><th className="text-right font-normal">Req</th><th className="text-right font-normal">Fail</th><th className="text-right font-normal">Avg</th></tr>
                  </thead>
                  <tbody>
                    {report.by_model.length === 0 && (
                      <tr><td colSpan={4} className="py-2 text-muted-foreground">No activity in this window.</td></tr>
                    )}
                    {report.by_model.map((m) => (
                      <tr key={m.model} className="border-t border-border/40">
                        <td className="py-1.5 pr-2 font-mono text-xs">{m.model}</td>
                        <td className="py-1.5 text-right">{m.requests}</td>
                        <td className={"py-1.5 text-right " + (m.failures > 0 ? "text-amber-400" : "")}>{m.failures}</td>
                        <td className="py-1.5 text-right">{m.avg_latency_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Tier chains (verified models)</h3>
                <ul className="space-y-1 text-xs">
                  {report.registry.map((r) => (
                    <li key={r.tier}>
                      <span className="uppercase text-gold">{r.tier}</span>{" "}
                      <span className="font-mono text-muted-foreground">{r.chain.join(" → ")}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Circuit breakers</h3>
                {report.breakers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">All models closed (healthy) on this server instance.</p>
                ) : (
                  <ul className="space-y-1 text-xs font-mono">
                    {report.breakers.map((b) => (
                      <li key={b.model} className={b.open ? "text-red-400" : "text-muted-foreground"}>
                        {b.model} — {b.open ? `open, retries in ${Math.round(b.reopens_in_ms / 1000)}s` : "closed"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {report.by_error.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Errors</h3>
                  <ul className="space-y-1 text-xs font-mono text-amber-400">
                    {report.by_error.map((e) => (
                      <li key={e.error_type}>{e.error_type} × {e.occurrences}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
