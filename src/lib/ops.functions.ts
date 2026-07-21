// Server functions for the System Health dashboard and ops surfaces.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type HealthSnapshot = {
  as_of: string;
  events_1h: number;
  errors_1h: number;
  fatal_1h: number;
  bookings_24h: number;
  stripe_errors_24h: number;
  last_restore_drill: string | null;
  integrations: Array<{ integration: string; status: string; latency_ms: number | null; checked_at: string }>;
};

export type MonitoringRow = {
  id: string;
  severity: string;
  source: string;
  message: string;
  context: Json;
  user_id: string | null;
  request_id: string | null;
  created_at: string;
};

export type IntegrationRow = {
  integration: string;
  status: string;
  latency_ms: number | null;
  details: Json;
  checked_at: string;
};

export type RestoreDrillRow = {
  id: string;
  performed_by: string | null;
  method: string;
  dataset: string;
  result: string;
  notes: string | null;
  performed_at: string;
};

export const opsHealthSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HealthSnapshot> => {
    const { data, error } = await context.supabase.rpc("admin_system_health_snapshot");
    if (error) throw new Error(error.message);
    return data as unknown as HealthSnapshot;
  });

export const opsRecentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { limit?: number } | undefined) => ({ limit: i?.limit ?? 100 }))
  .handler(async ({ data, context }): Promise<MonitoringRow[]> => {
    const { data: rows, error } = await context.supabase.rpc("admin_recent_monitoring_events", { _limit: data.limit });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as MonitoringRow[];
  });

export const opsListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationRow[]> => {
    const { data, error } = await context.supabase.rpc("admin_list_integration_health");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as IntegrationRow[];
  });

export const opsRecordIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { integration: string; status: string; latency_ms?: number; details?: Record<string, Json> }) => i)
  .handler(async ({ data, context }): Promise<string> => {
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
  .handler(async ({ context }): Promise<RestoreDrillRow[]> => {
    const { data, error } = await context.supabase.rpc("admin_list_restore_drills", { _limit: 50 });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RestoreDrillRow[];
  });

export const opsRecordRestoreDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { method: string; dataset: string; result: "passed" | "failed" | "partial"; notes?: string }) => i)
  .handler(async ({ data, context }): Promise<string> => {
    const { data: id, error } = await context.supabase.rpc("admin_record_restore_drill", {
      _method: data.method,
      _dataset: data.dataset,
      _result: data.result,
      _notes: data.notes,
    });
    if (error) throw new Error(error.message);
    return String(id ?? "");
  });
