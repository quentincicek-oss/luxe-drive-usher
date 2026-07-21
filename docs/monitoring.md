# HarborLine — Monitoring & Analytics

## Monitoring (`src/lib/monitoring.ts`)

Client-side wrapper over the `monitoring_capture` RPC. All captured events land
in `public.monitoring_events` and surface in **Admin → System Health**.

```ts
import { captureException, captureMessage, addBreadcrumb, installClientMonitoring } from "@/lib/monitoring";

installClientMonitoring(); // once, at app bootstrap

addBreadcrumb("booking", "user opened checkout", { bookingId });
try { /* ... */ }
catch (err) { captureException("booking.checkout", err, { bookingId }); }

captureMessage("payments", "stripe webhook processed", { eventId }, "info");
```

Severity levels: `debug | info | warning | error | fatal`. Rate limited to
60 events / minute per user via `check_and_bump_rate_limit`.

Server-side code should use `context.supabase.rpc("monitoring_capture", …)`
inside `createServerFn` handlers.

### Sinks

The abstraction sends to Lovable Cloud only. To add an external sink (Sentry,
Datadog), extend `send()` in `src/lib/monitoring.ts` — call sites do not
change.

## Analytics (`src/lib/analytics.ts`)

Fires only when the user has granted the `analytics` cookie category via the
CookieConsent banner. Events land in `public.analytics_events`.

```ts
import { track, page, analyticsAllowed } from "@/lib/analytics";

page("/book", "Book a ride");
track("booking_created", { rideType: "airport", price });
```

If consent is missing or revoked, calls are silent no-ops. The consent
version is stamped onto every event for auditability.

## Integration health

Recorded via **Admin → System Health → Integrations** or programmatically
through the `admin_record_integration_health` RPC. External uptime checks
should call the public liveness endpoint:

```
GET /api/public/health
```

## System health snapshot

`admin_system_health_snapshot()` returns:

- events / errors / fatal in the last hour
- bookings in the last 24 hours
- stripe error count in the last 24 hours
- last restore drill timestamp
- current integration health

This is the single source of truth for the dashboard KPIs.
