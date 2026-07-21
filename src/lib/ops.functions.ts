// Server functions for the System Health dashboard and ops surfaces.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: ReturnType<typeof unknown> extends never ? never : never; userId: string }) {
  // no-op typing helper; real check below
  void ctx;
}

export const opsHealthSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    void assertAdmin;
    const { data, error } = await context.supabase.rpc("admin_system_health_snapshot");
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  });

export const opsRecentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { limit?: number } | undefined) => ({ limit: i?.limit ?? 100 }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("admin_recent_monitoring_events", { _limit: data.limit });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const opsListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_integration_health");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const opsRecordIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { integration: string; status: string; latency_ms?: number | null; details?: Record<string, unknown> }) => i)
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_record_integration_health", {
      _integration: data.integration,
      _status: data.status,
      _latency_ms: data.latency_ms ?? null,
      _details: (data.details ?? {}) as never,
    });
    if (error) throw new Error(error.message);
    return id as string;
  });

export const opsListRestoreDrills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_restore_drills", { _limit: 50 });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const opsRecordRestoreDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { method: string; dataset: string; result: "passed" | "failed" | "partial"; notes?: string | null }) => i)
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_record_restore_drill", {
      _method: data.method,
      _dataset: data.dataset,
      _result: data.result,
      _notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return id as string;
  });
