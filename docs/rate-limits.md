# Rate limiting

HarborLine enforces per-action rate limits in Postgres via
`public.check_and_bump_rate_limit(action, key, limit, window_seconds)`.
The function is `SECURITY DEFINER`, atomic, and returns `{allowed, remaining,
retry_after}`. The underlying table `public.rate_limits` is service-role only.

## Standard buckets

| Action key                       | Limit | Window   | Key strategy              | Enforced in |
|----------------------------------|-------|----------|---------------------------|-------------|
| `auth_signin_password`           | 10    | 15 min   | `user:<id>` or `email:*`  | client-side hint + server RPC before password submission |
| `auth_password_reset`            | 5     | 60 min   | `email:*`                 | `admin.login` + `auth` |
| `admin_mfa_recovery_attempt`     | 5     | 10 min   | `user:<id>`               | `admin_consume_recovery_code` (DB) |
| `booking_create`                 | 20    | 60 min   | `user:<id>`               | Booking server function |
| `support_message_send`           | 30    | 10 min   | `user:<id>`               | Support server function |
| `admin_provision_user`           | 15    | 60 min   | `user:<admin-id>`         | `admin_provision_user_finalize` |
| `blake_concierge_prompt`         | 40    | 10 min   | `user:<id>` or `ip:*`     | `/api/blake` |

## How to add a new limit

1. Add a row to the table above and pick a stable `action` name.
2. In the relevant server function, call the RPC via
   `context.supabase.rpc('check_and_bump_rate_limit', { ... })` and throw a
   user-facing error when `allowed = false`, echoing `retry_after` seconds.
3. Never trust a client-supplied `key`; derive it from `context.userId` or a
   verified email.

## Notes

- Limits are per-window (fixed window), not sliding — acceptable for anti-abuse.
- Windows reset lazily on next call; nothing runs on a schedule.
- The bucket table grows unboundedly by (action,key). Add a periodic prune job
  once the pilot moves to full production.
