/**
 * Model-drift / retirement detector.
 *
 * NVIDIA publishes versioned ids for only some of these models, so availability
 * is probed rather than assumed. Server-only: the provider key is read here and
 * never leaves this module.
 */
import { ALL_MODELS } from "./registry.server";

export interface ModelHealthRow {
  model: string;
  pin: "dated" | "alias";
  available: boolean;
  status: number | null;
  latency_ms: number;
  note: string;
}

export async function probeModels(): Promise<{ checked_at: string; models: ModelHealthRow[] }> {
  const key = process.env["NVIDIA_API_KEY"];
  if (!key) throw new Error("AI provider is not configured");

  const rows: ModelHealthRow[] = [];
  for (const spec of ALL_MODELS) {
    const t0 = Date.now();
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: spec.id, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
      const text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 160);
      rows.push({
        model: spec.id,
        pin: spec.pin,
        available: res.ok,
        status: res.status,
        latency_ms: Date.now() - t0,
        note: res.ok
          ? "reachable"
          : res.status === 404
            ? "not available to this key (retired or renamed)"
            : text || `HTTP ${res.status}`,
      });
    } catch (e) {
      rows.push({
        model: spec.id,
        pin: spec.pin,
        available: false,
        status: null,
        latency_ms: Date.now() - t0,
        note: e instanceof Error ? e.message.slice(0, 160) : "probe failed",
      });
    }
  }
  return { checked_at: new Date().toISOString(), models: rows };
}
