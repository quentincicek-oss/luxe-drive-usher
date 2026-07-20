
# Phase H — Trust, Safety & Operational Proof

Per your directive, I performed an architecture review **before** proposing code. Below is the impact analysis, the additive design, and the clarifications I need before implementation.

---

## 1. Architecture review (what exists today, what we reuse)

Already in place — will be **reused, not rebuilt**:

- `bookings`, `booking_assignments` (with `dispatch_status`, `is_current`, history preserved by the `handle_booking_assignment_change` trigger).
- `driver_trip_events` — already captures `accepted`, `arrived`, `waiting`, `started`, `completed`, `no_show`, `incident`, `passenger_contacted`, `dispatch_contacted`, `rejected`. Reason field exists.
- `driver_profiles`, `vehicles` (with `insurance_expires_at`, `registration_expires_at`, `inspection_expires_at`), `driver_unavailability`, `driver_documents`.
- `audit_log` (Phase G) — immutable, admin-only, INSERT via `admin_audit_log()` SECURITY DEFINER RPC.
- `admin_incident_feed`, `admin_fleet_expirations`, `admin_dispatch_overview` RPCs.
- Receipts + OTP verification (`receipt_verifications`), Stripe webhook, referrals — **untouched**.
- Driver workflow UI (`WorkflowStepper`, `VerificationSlot`, `AssignmentDetailCard`, `useDispatchState`) — extended, not replaced.

**Gap map** (what Phase H must add):

| Requirement | Gap | Fill |
|---|---|---|
| Passenger PIN / QR / NFC verification | `VerificationSlot` is UI-only, no server enforcement, no code storage | 4-digit PIN on booking + verification RPC + event |
| Trip lifecycle proof | Events exist per assignment; no unified read model, no "Evidence Package" concept | New `trip_evidence` view + Evidence Package screen (read-only) |
| GPS evidence (arrival / start / end / route) | No location table | New `trip_locations` + `trip_route_points` tables, offline-tolerant batch upload |
| No-show workflow | Event exists, but no waiting timer / arrival-location / attempt log tie-in | Structured `no_show_reports` referencing existing events + GPS |
| Communication logging | `passenger_contacted` / `dispatch_contacted` events exist as flat rows | New `communication_events` table with direction, duration, status |
| Incident reporting expansion | Free-text `reason` on `driver_trip_events` | New `incidents` table with `category`, `severity`, `status`, admin resolution |
| Vehicle compliance warnings | RPC returns expirations; no proactive UI banner or dashboard alerts | Reuse RPC, add banner + admin toast; no schema change |
| Admin verification-method policy | Not present | New `verification_settings` row (single-row config table) |
| Everything auditable | `admin_audit_log` exists | Wrap every new admin mutation |

---

## 2. Additive schema (one migration, no changes to existing tables)

```text
trip_locations         (booking_id, kind: arrival|trip_start|trip_end,
                        lat, lng, accuracy_m, recorded_at, driver_id)
trip_route_points      (booking_id, driver_id, lat, lng, recorded_at, speed_mps, seq)
passenger_verifications(booking_id, method: pin|qr|nfc, verified_at,
                        verified_by_driver_id, evidence jsonb)
booking_pins           (booking_id PK, pin_hash, salt, attempts, locked_until)
no_show_reports        (booking_id, driver_id, arrival_at, waited_seconds,
                        attempts_count, arrival_lat, arrival_lng, reason,
                        admin_status: pending|approved|rejected, admin_notes)
communication_events   (booking_id, driver_id, direction: driver_to_passenger|
                        passenger_to_driver, channel: phone|inapp, duration_sec,
                        status: initiated|connected|missed|failed, started_at)
incidents              (booking_id, driver_id, category, severity, description,
                        photo_urls text[], status: open|reviewing|resolved|dismissed,
                        admin_notes, resolved_by, resolved_at)
verification_settings  (id=1 single row: pin_enabled, qr_enabled, nfc_enabled,
                        min_waiting_seconds default 300)
```

Plus **view** (not a table): `trip_evidence_v` joining booking + assignment + verifications + locations summary + incidents + no-show + receipt + payment status. Read-only.

**Immutability**: every table above has RLS with `INSERT` allowed for the correct actor (driver for own trip, admin for settings), **no `UPDATE`/`DELETE` policies** except for `incidents.status` (admin only) and `no_show_reports.admin_status` (admin only). Those two updates are the only mutable fields — everything else append-only. All admin updates go through server functions that write to `audit_log` in the same call.

**RLS shape**:
- Drivers: `INSERT/SELECT` on rows where `driver_id = (SELECT id FROM driver_profiles WHERE user_id=auth.uid())` and the booking's current assignment is theirs.
- Passengers: `SELECT` only their own booking's verification status + evidence summary (no raw GPS).
- Admins: full `SELECT`, controlled `UPDATE` on the two mutable fields via server fns.

GRANTs follow the mandated pattern (authenticated + service_role; no anon).

---

## 3. Server functions (all `requireSupabaseAuth` + audit-wrapped for admin actions)

`src/lib/trust.functions.ts`:
- `startPassengerVerification({bookingId, method})` — driver-only, logs attempt.
- `submitPin({bookingId, pin})` — driver submits the code the passenger showed, hash-compare, lock after 5 fails, insert `passenger_verifications` + `driver_trip_events('verified')`.
- `recordTripLocation({bookingId, kind, lat, lng, accuracy})` — driver only.
- `uploadRoutePoints({bookingId, points[]})` — bulk insert; idempotent by `(booking_id, seq)`.
- `submitNoShow({bookingId, arrivalAt, attempts, arrivalLoc, reason})` — requires ≥ configured wait + at least one communication event.
- `logCommunication({bookingId, direction, channel, durationSec, status})`.
- `reportIncident({bookingId, category, severity, description})`.
- Admin-only: `resolveIncident`, `reviewNoShow`, `updateVerificationSettings` — each wrapped in `admin_audit_log`.

Reads: TanStack Query directly to Supabase (RLS-scoped).

---

## 4. Client surfaces (additive, no design overhaul)

- **Booking confirmation**: passenger sees a 4-digit PIN card ("Show this to your chauffeur"). Also renders QR (encodes booking id + short-lived HMAC token). NFC prep only.
- **Driver trip screen**: `VerificationSlot` becomes real — 3 tabs (PIN / QR / NFC), gated by admin `verification_settings`. Start-trip button disabled until verified. Waiting timer + "Log call" + "Report No-Show" (enabled after `min_waiting_seconds`). Silent GPS pings every 10s while `en_route`/`in_progress`, queued in IndexedDB when offline, flushed via `uploadRoutePoints`.
- **Admin → Incidents** (existing tab): switch data source from ad-hoc `driver_trip_events` union to new `incidents` table; keep the legacy feed as "Historical events".
- **Admin → Evidence** (new subview under a booking row): read-only Evidence Package — timeline, verification, GPS summary (distance/duration/map static image), no-show report, incidents, receipt link.
- **Admin → Fleet**: compliance banner + row-level red/amber pills already exist; add a dashboard-top warning when any doc expires ≤ 14 days.
- **Admin → Settings**: new "Verification methods" panel (toggle PIN/QR/NFC, wait-time).

**No** changes to Stripe, Concierge, Referrals, Auth, booking creation flow copy, landing, showroom.

---

## 5. Rollout order (each step compiles and preserves prior behavior)

1. Migration (all new tables + view + RLS + GRANTs + `verification_settings` seed row).
2. `trust.functions.ts` (all server fns, audit-wrapped where admin).
3. PIN generation on booking create (trigger on `bookings` INSERT — the only touch to an existing table is via trigger, no column changes) + passenger PIN card component.
4. Real `VerificationSlot` + gated Start-trip button.
5. GPS collector hook + offline queue + upload fn wiring.
6. No-show structured flow (replaces the `window.confirm` prompt).
7. Communication log button + panel.
8. Incident modal + admin incidents table swap.
9. Fleet compliance banner (UI only).
10. Evidence Package admin view.
11. Verification settings admin panel.
12. Typecheck, smoke-test as passenger / driver / admin.

---

## 6. Guardrails re-confirmed

Untouched: `book.tsx` booking submit logic, `payments.functions.ts`, `receipts.functions.ts`, `stripe.*`, `blake.ts`, referral tables/fns, `auth.tsx`, `_authenticated` gate, `AppHeader`, `AuthProvider`. No column added or removed on any existing table. Only new trigger is one `AFTER INSERT` on `bookings` to mint a PIN into the new `booking_pins` table.

---

## 7. Clarifications I need before writing code

1. **Verification default**: Should PIN be the only method enabled at launch (QR/NFC toggles present but off), or all three on by default?
2. **No-show waiting time**: Default I proposed is **5 minutes** after driver marks "arrived". Confirm, or specify per-ride-type (airport vs city)?
3. **GPS retention**: How long should raw `trip_route_points` be kept? I propose **90 days**, then auto-purge via cron; summary in `trip_evidence_v` stays forever. OK?
4. **PIN visibility**: Show PIN to the passenger **immediately on booking confirmation**, or only **T-30 min before pickup**? (Security vs convenience.)
5. **Photos on incidents**: You wrote "photos (future-ready)". Do you want Supabase Storage bucket created now (private, admin+owner-driver read) or truly deferred?

Once these are answered I'll execute steps 1–12 in order, running typecheck between phases, without touching any protected surface.
