// HarborLine monitoring abstraction.
// A thin wrapper over the `monitoring_capture` RPC so we can later swap the
// sink (e.g. Sentry, Datadog) without touching call sites.

import { supabase } from "@/integrations/supabase/client";

export type Severity = "debug" | "info" | "warning" | "error" | "fatal";

type Ctx = Record<string, unknown>;

const MAX_QUEUE = 50;
type Breadcrumb = { at: number; source: string; message: string; ctx?: Ctx };
const breadcrumbs: Breadcrumb[] = [];

function pushBreadcrumb(b: Breadcrumb) {
  breadcrumbs.push(b);
  if (breadcrumbs.length > MAX_QUEUE) breadcrumbs.splice(0, breadcrumbs.length - MAX_QUEUE);
}

export function addBreadcrumb(source: string, message: string, ctx?: Ctx) {
  pushBreadcrumb({ at: Date.now(), source, message, ctx });
}

function requestId(): string {
  try {
    return (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  } catch { return String(Date.now()); }
}

async function send(severity: Severity, source: string, message: string, context: Ctx) {
  try {
    const payload: Ctx = { ...context, breadcrumbs: breadcrumbs.slice(-10) };
    await supabase.rpc("monitoring_capture", {
      _severity: severity,
      _source: source.slice(0, 128),
      _message: String(message).slice(0, 4000),
      _context: payload as never,
      _request_id: requestId(),
    });
  } catch {
    // Never throw from monitoring
  }
}

export function captureMessage(source: string, message: string, ctx: Ctx = {}, severity: Severity = "info") {
  return send(severity, source, message, ctx);
}

export function captureException(source: string, err: unknown, ctx: Ctx = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  return send("error", source, message, { ...ctx, stack });
}

// Install client-side global hooks (idempotent).
let installed = false;
export function installClientMonitoring() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    void captureException("window.error", e.error ?? e.message, { filename: e.filename, lineno: e.lineno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    void captureException("window.unhandledrejection", e.reason);
  });
}
