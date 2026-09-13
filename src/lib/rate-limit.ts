/**
 * Shared per-user rate limiting for server functions.
 *
 * Backed by the `check_and_bump_rate_limit` SECURITY DEFINER RPC, so the
 * counter is server-authoritative and cannot be reset from a client.
 */
type RpcCaller = { rpc: (fn: never, args: never) => Promise<{ data: unknown; error: unknown }> };

export async function enforceRateLimit(
  supabase: unknown,
  userId: string,
  action: string,
  limit: number,
  windowSeconds = 600,
): Promise<void> {
  const { data, error } = await (supabase as RpcCaller).rpc("check_and_bump_rate_limit" as never, {
    _action: action,
    _key: `user:${userId}`,
    _limit: limit,
    _window_seconds: windowSeconds,
  } as never);
  // Fail closed: if the limiter itself is unavailable we refuse the write
  // rather than leaving an abuse-sensitive endpoint unmetered.
  if (error) throw new Error("Service is busy. Please try again in a moment.");
  const row = Array.isArray(data)
    ? (data[0] as { allowed?: boolean; retry_after?: number } | undefined)
    : (data as { allowed?: boolean; retry_after?: number } | null);
  if (row?.allowed === false) {
    throw new Error(`Too many requests. Please try again in ${row.retry_after ?? 60}s.`);
  }
}
