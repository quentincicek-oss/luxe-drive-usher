// Server functions for the System Health dashboard and ops surfaces.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const opsHealthSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_system_health_snapshot");
    if (error) throw new Error(error.message);
    return (data ?? {}) as unknown as Record<string, unknown>;
  });

export const opsRecentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { limit?: number } | undefined) => ({ limit: i?.limit ?? 100 }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("admin_recent_monitoring_events", { _limit: data.limit });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as Array<Record<string, unknown>>;
  });

export const opsListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_integration_health");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<Record<string, unknown>>;
  });

export const opsRecordIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { integration: string; status: string; latency_ms?: number; details?: Record<string, unknown> }) => i)
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_record_integration_health", {
      _integration: data.integration,
      _status: data.status,
      _latency_ms: data.latency_ms,
      _details: (data.details ?? {}) as never,
    });
    if (error) throw new Error(error.message);
    return String(id ?? "");
  });

export const opsListRestoreDrills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_restore_drills", { _limit: 50 });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<Record<string, unknown>>;
  });

export const opsRecordRestoreDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { method: string; dataset: string; result: "passed" | "failed" | "partial"; notes?: string }) => i)
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_record_restore_drill", {
      _method: data.method,
      _dataset: data.dataset,
      _result: data.result,
      _notes: data.notes,
    });
    if (error) throw new Error(error.message);
    return String(id ?? "");
  });
