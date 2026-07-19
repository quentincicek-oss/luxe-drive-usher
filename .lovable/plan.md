# HarborLine Phase E — Enterprise Driver & Dispatch Operations

## Scope

Build a professional Driver + Dispatch operations layer inside the existing Admin console. No changes to booking logic, payments, Stripe, auth, AI concierge, existing APIs, translations, or existing tables. Only additive schema and additive UI.

## Data Model (additive only — nothing existing modified)

New tables in `public`:

1. `driver_profiles` — one row per hired driver (extends existing `drivers` table, does not replace it)
   - user_id (FK auth.users, unique), employee_id, full_name, phone, email, photo_url, license_number, license_expires_at, employment_status (`active|inactive|vacation`), availability_status (`available|assigned|on_trip|offline|vacation`), assigned_vehicle_id (FK vehicles), notes
2. `vehicles`
   - name, category (`escalade|suburban|denali|other`), license_plate, vin, model_year, seats, status (`active|maintenance`), insurance_expires_at
3. `driver_unavailability` — vacation / maintenance blocks
   - driver_id, starts_at, ends_at, reason (`vacation|maintenance|personal`), note
4. `booking_assignments` — dispatch history (append-only log)
   - booking_id, driver_id, vehicle_id, dispatch_status (`pending|assigned|accepted|en_route|arrived|in_progress|completed|cancelled`), assigned_by, assigned_at, note

RLS: admin full access; driver reads own rows; service_role all. GRANT to authenticated + service_role. No changes to `bookings`, `drivers`, `profiles`, `user_roles`.

Note: existing `bookings.status` enum stays. Dispatch sub-states live in `booking_assignments.dispatch_status` so booking flow is untouched.

## Route Architecture

Extend `src/routes/admin.tsx` tabs → keep `bookings|discounts|concierge`, add `dispatch|drivers|vehicles`. Also split into files:

```
src/routes/admin.tsx                (tabs shell — existing)
src/routes/admin.dispatch.tsx       (new)
src/routes/admin.drivers.tsx        (new)
src/routes/admin.drivers.$id.tsx    (driver profile detail + calendar)
src/routes/admin.vehicles.tsx       (new)
```

All under existing admin gate (role check already there). No new public routes.

## Component Architecture

Reusable enterprise primitives under `src/components/ops/`:

- `DataTable.tsx` — virtualized, sortable, filterable, paginated (uses existing tokens)
- `StatusPill.tsx` — subtle premium status colors (single source of truth)
- `SearchBar.tsx`, `FilterChips.tsx`, `Pagination.tsx`
- `DriverCard.tsx`, `VehicleCard.tsx`
- `AssignmentPanel.tsx` — assign/change/remove driver inside a booking row
- `DriverCalendar.tsx` — week/day list view (not month grid — clean)
- `DispatchKpi.tsx` — metric tile
- `AssignmentTimeline.tsx` — dispatch state ladder (Pending → Assigned → Accepted → En Route → Arrived → In Progress → Completed)

Driver-app-ready primitives under `src/components/driver/` (unused now, wired later):
- `JobCard.tsx`, `JobActionBar.tsx` (Accept/Navigate/Arrived/Start/Complete), `useDispatchState.ts` hook

Notification architecture: `src/lib/notifications.ts` — typed event bus + toast adapter. Events: `driver.assigned|accepted|arrived|trip.started|trip.completed`. No push transport yet.

## Dispatch Workflow

1. Booking exists (unchanged flow).
2. Dispatch tab lists bookings without a live assignment → dispatcher clicks Assign → picks driver + vehicle → row inserted into `booking_assignments` with `dispatch_status='assigned'`.
3. Dispatcher can advance status via `AssignmentTimeline`. Each advance appends a new row (audit log) or updates latest — we update the latest row per booking.
4. Driver availability derived: `driver_profiles.availability_status` synced by trigger when a `booking_assignments` row is created/advanced (`assigned`→assigned, `en_route|arrived|in_progress`→on_trip, `completed|cancelled`→available).

## Dispatch KPIs (Dispatch Center)

Computed via a single SQL view `admin_dispatch_kpis` (SECURITY DEFINER function returning JSON) called from admin loader:
- todays_bookings, upcoming_bookings, completed_trips_7d
- drivers_available, drivers_busy, drivers_offline
- upcoming_airport_pickups (heuristic: pickup ILIKE '%airport%' OR '%JFK%|LGA%|EWR%')

## Performance

- Virtualized tables via `@tanstack/react-virtual` (already in dep tree via router? add if missing).
- Server-side pagination (`range()`) on bookings/drivers.
- `useDeferredValue` for search input.
- `React.memo` on row components.
- Query keys per tab; no cross-tab refetch storms.

## UX Direction

Enterprise, not luxury:
- Compact 32px row height, 13px table type, monospaced IDs, subtle borders.
- Status pills: available=emerald/8%, assigned=gold/10%, on_trip=blue/10%, offline=muted, vacation=violet/10%.
- Keep gold accents only for primary CTAs; drop decorative gradients in ops screens.
- One focal action per screen, sticky action bar on detail pages.

## Implementation Order (incremental, each step ships working)

1. **Migration** — new tables + RLS + trigger + KPI function.
2. **Ops primitives** — `DataTable`, `StatusPill`, `SearchBar`, `Pagination`, `DispatchKpi`.
3. **Drivers** — `admin.drivers.tsx` list + create/edit modal + `admin.drivers.$id.tsx` detail with calendar.
4. **Vehicles** — `admin.vehicles.tsx` list + create/edit modal.
5. **Dispatch** — `admin.dispatch.tsx` with KPI row + today/upcoming tables + `AssignmentPanel` + `AssignmentTimeline`.
6. **Driver-app primitives** — build UI shell only, wire to `useDispatchState` mock, hidden route `/driver/preview` for internal QA.
7. **Notifications module** — event bus + toast adapters, fired from assignment actions.
8. **Admin nav** — extend tab bar in `admin.tsx` shell with new tabs, preserve existing three.

## What stays untouched (guardrails)

- `src/routes/book.tsx`, `src/routes/history.tsx`, `src/routes/index.tsx`, `src/routes/auth.tsx`
- `src/routes/api/blake.ts`, `src/routes/api/public/payments/webhook.ts`
- `src/lib/payments.functions.ts`, `src/lib/receipts.functions.ts`, `src/lib/stripe*`
- `src/lib/i18n.tsx` translations (only additive keys under `admin.dispatch.*`, `admin.drivers.*`, `admin.vehicles.*`)
- All existing tables and enums

## Deliverables checklist

- [ ] Migration approved & applied
- [ ] Ops primitives
- [ ] Driver management (list + detail + calendar)
- [ ] Vehicle management
- [ ] Dispatch Center (KPIs + tables + assignment)
- [ ] Assignment workflow with audit log
- [ ] Driver-app-ready components
- [ ] Notification module
- [ ] Additive i18n keys (EN + TR minimum; ES/PT/ZH/IT filled with EN fallback, then translated)
- [ ] Typecheck clean; existing flows verified via Playwright smoke

Approve to proceed with Step 1 (migration).