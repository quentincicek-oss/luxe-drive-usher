import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { aiAnalyze } from "@/lib/ai.functions";
import { AiWorkingState } from "@/components/ai/AiWorkingState";
import { useAiProgress } from "@/hooks/useAiProgress";

/** TEMPORARY verification harness for the AI progress UI. Removed after testing. */
export const Route = createFileRoute("/aiprobe-temp")({
  component: Probe,
  head: () => ({
    meta: [
      { title: "AI progress probe — HarborLine" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function Probe() {
  const analyze = useServerFn(aiAnalyze);
  const progress = useAiProgress();
  const [out, setOut] = useState<string | null>(null);

  async function go() {
    if (progress.running) return;
    setOut(null);
    try {
      const r = await progress.run((signal) =>
        analyze({
          signal,
          data: {
            question:
              "A guest requests an immediate airport pickup for 6 passengers while the only nearby chauffeur is 55 minutes away and their medical certificate expires tomorrow. Weigh the operational trade-offs and recommend an action.",
            facts: { passengers: 6, nearest_driver_eta_minutes: 55, requested_pickup: "immediate", vehicle_capacity: 7 },
            requiredFacts: ["passengers", "nearest_driver_eta_minutes", "requested_pickup", "vehicle_capacity"],
            maxDepth: true,
            purpose: "ui_progress_probe",
          } as never,
        }),
      );
      setOut(r === null ? (progress.timedOut ? "timeout" : "canceled") : `done ${r.latency_ms}ms`);
    } catch (e) {
      setOut(e instanceof Error ? e.message : "failed");
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8 space-y-4">
      <h1 className="font-display text-xl">Progress probe</h1>
      <button onClick={go} disabled={progress.running} data-testid="ai-deep-probe" className="rounded-lg bg-gold px-3 py-1.5 text-sm text-obsidian disabled:opacity-50">
        {progress.running ? "Running…" : "Run deep analysis"}
      </button>
      {progress.running && (
        <AiWorkingState stage={progress.stage} elapsedMs={progress.elapsedMs} slow={progress.slow} onCancel={progress.cancel} />
      )}
      {out && <p data-testid="ai-deep-result" className="text-xs text-muted-foreground">{out}</p>}
    </main>
  );
}
