import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { aiRouterReport, aiChat, aiAnalyze, aiFallbackProbe, aiModelHealth, type AiRouterReport, type ModelHealthRow } from "@/lib/ai.functions";
import { SCENARIOS } from "@/lib/ai/selftest";
import { AiWorkingState } from "@/components/ai/AiWorkingState";
import { useAiProgress } from "@/hooks/useAiProgress";

type TestRow = {
  id: string;
  label: string;
  status: "pending" | "running" | "pass" | "fail";
  detail: string;
  ms: number | null;
};

/** Admin-only diagnostics for the adaptive AI router. Read-only. */
export function AiRouterPanel() {
  const load = useServerFn(aiRouterReport);
  const [report, setReport] = useState<AiRouterReport | null>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chat = useServerFn(aiChat);
  const analyze = useServerFn(aiAnalyze);
  const fallbackProbe = useServerFn(aiFallbackProbe);
  const modelHealth = useServerFn(aiModelHealth);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<ModelHealthRow[] | null>(null);
  const deep = useAiProgress();
  const [deepResult, setDeepResult] = useState<string | null>(null);


  async function reload() {
    setBusy(true);
    try {
      const r = await load({ data: { hours } });
      setReport(r as AiRouterReport);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  async function runSelfTest() {
    setRunning(true);
    const rows: TestRow[] = SCENARIOS.map((s) => ({ id: s.id, label: s.label, status: "pending", detail: "", ms: null }));
    setTests(rows);
    const update = (id: string, patch: Partial<TestRow>) =>
      setTests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    for (const sc of SCENARIOS) {
      update(sc.id, { status: "running" });
      const t0 = Date.now();
      try {
        if (sc.id === "E") {
          const r = await fallbackProbe({});
          const ok = r.fallback_used && /FALLBACK OK/i.test(r.content);
          update(sc.id, {
            status: ok ? "pass" : "fail",
            detail: `${r.model_used} · fallback=${r.fallback_used} · attempts=${r.attempts.length}`,
            ms: Date.now() - t0,
          });
        } else if (sc.id === "J") {
          const results = await Promise.all([1, 2, 3].map(() => chat({ data: sc.payload as never })));
          const ok = results.every((r) => r.content.length > 0);
          update(sc.id, {
            status: ok ? "pass" : "fail",
            detail: `3 concurrent · ${results.map((r) => r.tier_used).join(",")}`,
            ms: Date.now() - t0,
          });
        } else if (sc.kind === "chat") {
          const r = await chat({ data: sc.payload as never });
          const checks: string[] = [];
          if (sc.expect.tier && r.tier_used !== sc.expect.tier) checks.push(`tier=${r.tier_used}`);
          if (sc.expect.summarized && !r.summarized) checks.push("not summarized");
          if (sc.expect.protectedPinned && !r.protected_context_pinned) checks.push("state not pinned");
          if (sc.id === "G" && !/Marcus/i.test(r.content)) checks.push("driver lost in compression");
          update(sc.id, {
            status: checks.length === 0 ? "pass" : "fail",
            detail: checks.length ? checks.join("; ") : `${r.model_used} · ${r.tier_used}${r.summarized ? " · compressed" : ""}`,
            ms: Date.now() - t0,
          });
        } else {
          const r = await analyze({ data: sc.payload as never });
          const checks: string[] = [];
          if (sc.expect.shouldFail) checks.push("expected rejection but call succeeded");
          if (sc.expect.tier && r.tier_used !== sc.expect.tier) checks.push(`tier=${r.tier_used}`);
          if (sc.expect.escalated && !r.escalated) checks.push("did not escalate");
          if (sc.expect.blocked && r.deterministic_decision !== "blocked")
            checks.push("deterministic rules did not block");
          if (sc.expect.minTier === "balanced" && r.tier_used === "fast") checks.push("tier=fast");
          if (!r.reliability) checks.push("no reliability assessment");
          update(sc.id, {
            status: checks.length === 0 ? "pass" : "fail",
            detail: checks.length
              ? checks.join("; ")
              : `${r.model_used} · ${r.tier_used} · reliability ${r.reliability.score} (${r.reliability.band}) · self-conf ${r.model_confidence}` +
                (r.deterministic_decision === "blocked" ? " · RULES BLOCKED" : "") + (r.ai_overridden ? " · AI OVERRIDDEN" : "") + (r.escalated ? " · escalated" : ""),
            ms: Date.now() - t0,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        update(sc.id, {
          status: sc.expect.shouldFail ? "pass" : "fail",
          detail: sc.expect.shouldFail ? `rejected as expected: ${msg.slice(0, 90)}` : msg.slice(0, 140),
          ms: Date.now() - t0,
        });
      }
    }
    setRunning(false);
    await reload();
  }

  async function runModelHealth() {
    try {
      const r = await modelHealth({});
      setHealth(r.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Model health check failed");
    }
  }

  /** Exercises the long-request working state against a real maximum-depth analysis. */
  async function runDeepProbe() {
    if (deep.running) return; // duplicate-submission guard
    setDeepResult(null);
    setError(null);
    try {
      const r = await deep.run((signal) =>
        analyze({
          signal,
          data: {
            question:
              "A guest requests an immediate airport pickup for 6 passengers while the only nearby chauffeur is 55 minutes away and their medical certificate expires tomorrow. Weigh the operational trade-offs and recommend an action.",
            facts: {
              passengers: 6,
              nearest_driver_eta_minutes: 55,
              requested_pickup: "immediate",
              vehicle_capacity: 7,
              driver_certificate_expires: "tomorrow",
            },
            requiredFacts: ["passengers", "nearest_driver_eta_minutes", "requested_pickup", "vehicle_capacity"],
            maxDepth: true,
            purpose: "ui_progress_probe",
          } as never,
        }),
      );
      if (r === null) {
        setDeepResult(deep.timedOut ? "Timed out — no recommendation produced." : "Canceled by operator.");
      } else {
        setDeepResult(`Completed in ${(r.latency_ms / 1000).toFixed(1)}s · reliability ${r.reliability.band}`);
      }
    } catch (e) {
      setDeepResult(e instanceof Error ? e.message : "Deep analysis failed");
    }
    await reload();
  }



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

          {/* Self-test + model drift detection */}
          <div className="mt-5 border-t border-border/40 pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={runSelfTest}
                disabled={running}
                className="rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-obsidian disabled:opacity-50"
              >
                {running ? "Running self-test…" : "Run self-test"}
              </button>
              <button
                onClick={runModelHealth}
                disabled={running}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-sm hover:border-gold/60 disabled:opacity-50"
              >
                Check model availability
              </button>
              {tests.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {tests.filter((t) => t.status === "pass").length} passed ·{" "}
                  {tests.filter((t) => t.status === "fail").length} failed
                </span>
              )}
            </div>

            {tests.length > 0 && (
              <ul className="space-y-1 text-xs" data-testid="ai-selftest-results">
                {tests.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="w-4 font-mono text-muted-foreground">{t.id}</span>
                    <span
                      className={
                        t.status === "pass" ? "text-emerald-400" :
                        t.status === "fail" ? "text-red-400" :
                        t.status === "running" ? "text-gold" : "text-muted-foreground"
                      }
                    >
                      {t.status.toUpperCase()}
                    </span>
                    <span>{t.label}</span>
                    {t.ms != null && <span className="text-muted-foreground">{(t.ms / 1000).toFixed(1)}s</span>}
                    {t.detail && <span className="text-muted-foreground font-mono">{t.detail}</span>}
                  </li>
                ))}
              </ul>
            )}

            {health && (
              <ul className="mt-3 space-y-1 text-xs font-mono" data-testid="ai-model-health">
                {health.map((h) => (
                  <li key={h.model} className={h.available ? "text-muted-foreground" : "text-red-400"}>
                    {h.model} [{h.pin}] — {h.available ? `reachable ${h.latency_ms}ms` : h.note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
