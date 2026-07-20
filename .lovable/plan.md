# Phase G — Enterprise Dispatch & Fleet Operations

## 1. Business Model Alignment (recap before code)

HarborLine = closed executive fleet. Admins are the ONLY dispatch authority. Drivers execute; passengers request. Every mutation in this phase is admin-only, server-verified via `has_role(auth.uid(),'admin')`, and permanently logged.

## 2. Scope Boundaries (untouched)

- Booking creation flow (`book.tsx`), Stripe/payments, Referrals, AI Concierge, Auth, Driver App (`_driver.*`), existing schema for `bookings` / `booking_assignments` / `driver_profiles` / `vehicles`.
- Additive only: 1 new table (`audit_log`), 3 new admin RPCs, and a rewrite of the **admin console presentation layer** (routes + components under `src/routes/admin.*` and `src/components/dispatch/*`). Data model already covers 90% of requirements from Phase E.

## 3. What already exists (reuse, don't rebuild)

- Tables: `bookings`, `booking_assignments` (with `dispatch_status`, `is_current`, history preserved), `driver_profiles` (with `availability_status`, `employment_status`), `vehicles`, `driver_unavailability`, `driver_trip_events`, `driver_documents`, `ride_reviews`, `referrals`, `chat_messages`.
- Components: `StatusPill`, `AssignmentTimeline`, `DispatchKpi`, `AssignmentPanel`, `admin_dispatch_kpis()` RPC.
- Trigger `handle_booking_assignment_change` already syncs driver availability + enforces one current assignment per booking.

**Gap to close**: audit log, incident aggregation view, fleet expirations view, richer KPIs, professional multi-section admin UI.

## 4. Additive Schema (one migration)

**`audit_log`** — immutable admin actions
- `id`, `actor_id` (admin uuid), `actor_email` (snapshot), `action` (text, e.g. `assignment.create`, `assignment.reassign`, `assignment.remove`, `driver.suspend`, `driver.activate`, `vehicle.update`, `booking.cancel`), `entity_type`, `entity_id`, `previous jsonb`, `next jsonb`, `reason` text, `created_at`.
- RLS: admins SELECT; INSERT via SECURITY DEFINER RPC only; no UPDATE/DELETE policies (immutable).

**RPCs** (all `SECURITY DEFINER`, admin-gated):
- `admin_audit_log(_action, _entity_type, _entity_id, _previous, _next, _reason)` → inserts row, snapshots actor email from `profiles`.
- `admin_dispatch_overview()` → returns jsonb with all dashboard counters (new/pending/assigned/en_route/waiting/in_progress/completed_today/cancelled_today) + driver-status buckets in one round trip.
- `admin_fleet_expirations()` → vehicles with insurance/registration/inspection dates + traffic-light status.
- `admin_incident_feed(_limit)` → union of `driver_trip_events` (no_show|incident), cancelled bookings, low-rating reviews (`rating<=3`), ordered by created_at desc.

No table alterations. No trigger changes.

## 5. Route Architecture (admin surface refactor)

Split monolithic `src/routes/admin.tsx` into a layout + tabs. Keep the URL `/admin` as overview.

```
src/routes/
  admin.tsx                        (layout: sidebar nav + <Outlet/>)
  admin.index.tsx                  (/admin      — Dispatch Overview / KPI board)
  admin.dispatch.tsx               (/admin/dispatch — live booking board + assignment)
  admin.bookings.$id.tsx           (/admin/bookings/:id — single operational screen)
  admin.fleet.tsx                  (/admin/fleet — vehicles + expirations)
  admin.drivers.tsx                (/admin/drivers — roster, status, suspend/activate)
  admin.schedule.tsx               (/admin/schedule — driver day/week schedule)
  admin.incidents.tsx              (/admin/incidents — incident + complaint feed)
  admin.audit.tsx                  (/admin/audit — immutable audit trail, filterable)
```

All routes gated by existing `_authenticated` layout + in-component `role==='admin'` guard (same pattern as current `admin.tsx`). No new gate primitive.

## 6. Component Library (new, under `src/components/dispatch/`)

Reuse `StatusPill`, `DispatchKpi`, `AssignmentTimeline`, `SectionCard`. Add:

- `DispatchLayout.tsx` — sidebar + header + `<Outlet/>`, dense enterprise chrome.
- `BookingBoard.tsx` — column/table hybrid grouped by `dispatch_status`; each row → `BookingRow` with driver, vehicle, pickup ETA, payment pill, quick-actions.
- `AssignmentDrawer.tsx` — slide-over from a booking row; hosts `AssignmentPanel` + audit-writing wrappers + confirmation sheets.
- `DriverRosterTable.tsx` — sortable table: driver, employee id, status pill, active-assignment count, upcoming-count, actions (suspend/activate/set-unavailable).
- `FleetTable.tsx` — vehicle rows with expiration traffic-light chips (green >30d, amber ≤30d, red expired) computed client-side from `admin_fleet_expirations()`.
- `ScheduleGrid.tsx` — driver rows × time columns for today+7d; blocks = assignments or unavailability; read-only in v1.
- `IncidentFeed.tsx` — vertical feed of incident cards (no-show, incident, cancellation, low rating) with entity links.
- `AuditTable.tsx` — filterable log with diff view for `previous`/`next`.
- `ConfirmSheet.tsx` — generic confirmation modal for every destructive/dispatch action (required by spec).
- `FiltersBar.tsx` — shared filter primitives (date range, driver, vehicle, customer, airport, status, payment, referral source).

## 7. Server Functions (`src/lib/dispatch.functions.ts`)

All `.middleware([requireSupabaseAuth])` + server-side re-verify admin role via `has_role`. Each mutation wraps its Supabase write and calls `admin_audit_log` with `previous`/`next` snapshots in the SAME server call.

- `assignBookingDriver({ bookingId, driverId, vehicleId, reason? })`
- `reassignBookingDriver({ bookingId, driverId, vehicleId, reason })`
- `removeBookingAssignment({ bookingId, reason })`
- `advanceAssignmentStatus({ assignmentId, next, reason? })` (admin override path; drivers still use `driver.functions.ts`)
- `suspendDriver({ driverId, reason })` / `activateDriver({ driverId })`
- `setDriverUnavailability({ driverId, starts_at, ends_at, kind, reason })`
- `updateVehicle({ vehicleId, patch, reason })` (status, expirations, notes)
- `cancelBooking({ bookingId, reason })`

Read helpers use TanStack Query directly against Supabase (no server fn needed) for realtime-friendly polling; heavy aggregations use the new RPCs.

## 8. UX Principles

- Dense but calm: 13–14px base, generous line-height, single accent (gold) on active state + primary CTA only.
- One primary action per drawer; every mutation opens `ConfirmSheet` with a reason field where applicable.
- No decorative animation. State changes use opacity + slide only.
- Persistent sidebar with 8 sections; keyboard shortcuts (`g d` dispatch, `g f` fleet…) — optional stretch, only if trivial.
- All strings via `useI18n()` under new `admin.*` namespace (EN + TR populated; others fall back).

## 9. Guardrails

- No edits to `bookings`, `booking_assignments`, `driver_profiles`, `vehicles`, `driver_*`, `referral*`, `receipt*`, `stripe*`, `payments*`, `blake.ts`, `book.tsx`, `history.tsx`, `_driver.*`, `AuthProvider`, `AppHeader` (except adding an `Admin` label styling — optional).
- Existing `admin.tsx` gets converted to a layout; its previous tab content is redistributed to the new child routes with **zero behavior loss**.

## 10. Implementation Order (each step compiles + preserves prior behavior)

1. **Migration** — `audit_log` + 4 RPCs + GRANTs + RLS.
2. **Server functions** — `dispatch.functions.ts` with audit-wrapped mutations.
3. **Layout split** — convert `admin.tsx` to layout, move current content to `admin.index.tsx` unchanged (baseline preserved).
4. **Dispatch board** — `admin.dispatch.tsx` + `BookingBoard` + `AssignmentDrawer` + `ConfirmSheet`.
5. **Booking detail** — `admin.bookings.$id.tsx` with full operational panels + timeline.
6. **Fleet** — `admin.fleet.tsx` + `FleetTable` with expiration RPC.
7. **Drivers** — `admin.drivers.tsx` + `DriverRosterTable` + suspend/activate/unavailability flows.
8. **Schedule** — `admin.schedule.tsx` + `ScheduleGrid` (read-only).
9. **Incidents** — `admin.incidents.tsx` + `IncidentFeed`.
10. **Audit** — `admin.audit.tsx` + `AuditTable` + `FiltersBar`.
11. **i18n** — additive `admin.*` keys (EN + TR).
12. **Verify** — typecheck; smoke test as admin in preview; confirm no regressions in booking/driver/passenger paths.

---

Approve to proceed with Step 1 (migration).
