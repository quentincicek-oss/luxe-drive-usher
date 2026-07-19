# Phase F — Professional Driver Application

## 1. Impact Analysis (nothing existing gets modified in behavior)

Reviewed the current codebase before proposing changes:

- `bookings`, `booking_assignments`, `driver_profiles`, `vehicles`, `driver_unavailability` already exist from Phase E. All dispatch state transitions, RLS, triggers and the `handle_booking_assignment_change` availability sync are reusable as-is.
- Admin console (`admin.tsx`), Concierge widget, i18n, auth, Stripe, referrals, receipts, ratings, `AuthProvider` role detection — **untouched**.
- Existing `driver` role in `app_role` enum + `has_role` function are the gate we already need.
- `AssignmentTimeline`, `StatusPill`, `JobCard`, `useDispatchState`, `notifications.ts` are already built and driver-app-ready; Phase F wires them into real routes without changing their APIs.

Only **additive** schema (2 small tables) and **new route files** under `/driver/*`. Zero edits to existing routes/APIs except: (a) `AppHeader` gets an optional "Driver" link when role=driver, (b) `AuthProvider` post-login redirect logic stays the same — we route from the driver landing screen itself.

## 2. Route Architecture (new files only)

```
src/routes/
  _driver.tsx                    (pathless layout — role gate: driver|admin only)
  _driver/index.tsx              (/driver — Home dashboard)
  _driver/trips.tsx              (/driver/trips — upcoming + today list)
  _driver/trips.$id.tsx          (/driver/trips/:id — assignment detail + workflow)
  _driver/documents.tsx          (/driver/documents — read-only license/insurance/ID)
  _driver/profile.tsx            (/driver/profile — read-only profile + status control)
  _driver/denied.tsx             (/driver/denied — professional access-denied screen)
```

Gate logic in `_driver.tsx`: if `role !== 'driver' && role !== 'admin'` → render `<DeniedScreen />` (never leak driver UI). Admins allowed for QA.

## 3. New Schema (additive migration)

Two small tables:

**`driver_documents`** — one row per document per driver
- `driver_id`, `kind` (`license|insurance|company_id|medical|other`), `document_number`, `issued_at`, `expires_at`, `file_url` (nullable), `status` (`valid|expiring|expired`), `notes`
- Admin-managed only. Drivers can `SELECT` their own. RLS + GRANT to authenticated + service_role.

**`driver_trip_events`** — append-only audit log for driver actions
- `assignment_id`, `driver_id`, `event` (`accepted|rejected|arrived|waiting|started|completed|no_show|incident|dispatch_contacted|passenger_contacted`), `reason`, `payload jsonb`, `created_at`
- Driver can INSERT own; SELECT own; admin SELECT all.

No changes to existing tables. Availability continues to sync via existing trigger on `booking_assignments`.

## 4. Component Hierarchy (new, under `src/components/driver/`)

Reuse existing `JobCard`, `useDispatchState`, `StatusPill`, `AssignmentTimeline`, `SectionCard`. Add:

- `DriverShell.tsx` — layout with bottom tab bar (Home / Trips / Docs / Profile), safe-area padding, offline banner
- `DriverStatusPicker.tsx` — 8 statuses (Available, Assigned, Driving to Pickup, Waiting, On Trip, Offline, Break, Vacation) with confirmation sheet
- `AssignmentDetailCard.tsx` — passenger first name, pickup, dropoff, pickup time, flight, notes, refreshments, accommodations, vehicle, ETA
- `WorkflowStepper.tsx` — 10-step vertical stepper (New → Reviewed → Accepted → Navigating → Arrived → Waiting → Verified → Started → Completed → Archived)
- `ActionButton.tsx` — large touch target (min 56px), single primary action per screen, confirmation sheet
- `NavigateSheet.tsx` — opens Google Maps (`https://www.google.com/maps/dir/?api=1&destination=...`) or Apple Maps (`maps://?daddr=...`) via `<a>` links
- `VerificationSlot.tsx` — placeholder UI for PIN / NFC / QR (disabled with "Coming soon" chip; wired to `passenger_verified` step)
- `RejectReasonSheet.tsx`, `NoShowSheet.tsx`, `IncidentSheet.tsx` — modal forms that write to `driver_trip_events`
- `DocumentRow.tsx` — read-only doc row with expiration pill (green >30d, amber ≤30d, red expired)
- `OfflineBanner.tsx` + `useOnlineStatus.ts` — `navigator.onLine` + `online/offline` events
- `useDriverSync.ts` — TanStack Query with `networkMode: 'offlineFirst'`, mutation retry queue via `queryClient.getMutationCache()` and `onlineManager`

## 5. State Management

- **Server state**: TanStack Query. Query keys: `['driver','me']`, `['driver','assignments','today']`, `['driver','assignments','upcoming']`, `['driver','assignment',id]`, `['driver','documents']`. All loaders prime via `ensureQueryData`; components use `useSuspenseQuery`.
- **Mutations**: `advanceAssignment`, `rejectAssignment`, `reportNoShow`, `reportIncident`, `updateDriverStatus`. Each via `createServerFn` in `src/lib/driver.functions.ts` with `requireSupabaseAuth` middleware; server-side re-verifies caller is the assigned driver.
- **Offline**: mutations use `networkMode: 'offlineFirst'` + `retry: 3` with exponential backoff; queued when offline, flushed on `online` event. Reads fall back to cached data with staleness banner.
- **Notification bus**: extend existing `src/lib/notifications.ts` with driver-facing event types (`assignment.new`, `assignment.updated`, `trip.cancelled`, `passenger.delay`, `dispatch.message`, `document.expiring`). Adapters remain toast-only; push transport deferred.

## 6. Workflow Enforcement

`WorkflowStepper` reads `booking_assignments.dispatch_status` and exposes only the single next legal action. Server function `advanceAssignment(assignmentId, nextStatus)` validates the transition against the same 10-step ladder server-side — no client can skip steps.

Verification step (`passenger_verified`) is currently auto-passed with a UI placeholder showing the three future methods (PIN/NFC/QR) as disabled; a feature flag `VERIFICATION_REQUIRED = false` in `src/lib/driver.constants.ts` flips on later without any UI rewrite.

## 7. UX Principles

- 56px min tap targets, 17px base type, no decorative animation
- One primary action per screen, sticky at bottom with safe-area inset
- Gold accent used sparingly (primary CTA only); dispatch surfaces stay neutral
- Offline banner slides down from top when `!navigator.onLine`
- Bottom tab bar (Home / Trips / Docs / Profile) with 44px icons
- All strings pass through existing `useI18n()` under new `driver.*` namespace (EN + TR populated; ES/PT/ZH/IT fall back to EN then translated)

## 8. Guardrails (explicitly untouched)

- `src/routes/index.tsx`, `auth.tsx`, `book.tsx`, `history.tsx`, `admin.tsx`
- `src/routes/api/blake.ts`, `src/routes/api/public/payments/webhook.ts`
- `src/lib/payments.functions.ts`, `receipts.functions.ts`, `referrals.functions.ts`, `stripe*`
- All existing tables, enums, triggers, RLS policies
- Concierge widget, referral card, receipts, ratings — unchanged

## 9. Explicitly NOT built (per constraints)

Live GPS, realtime tracking, PIN/NFC/QR verification logic, push notifications. UI slots + architecture only.

## 10. Implementation Order (each step ships working, typechecks clean)

1. **Migration** — `driver_documents` + `driver_trip_events` with RLS + GRANTs
2. **Server functions** — `src/lib/driver.functions.ts` (advance, reject, no-show, incident, status)
3. **Layout + gate** — `_driver.tsx`, `DriverShell`, `denied.tsx`, `OfflineBanner`
4. **Home** — `/driver` dashboard with today/upcoming + status picker + vehicle card
5. **Trips list + detail** — `/driver/trips`, `/driver/trips/$id` with `WorkflowStepper`, all action sheets, navigation launcher
6. **Documents** — `/driver/documents` read-only with expiration pills
7. **Profile** — `/driver/profile` read-only + status control
8. **i18n keys** — additive `driver.*` namespace (EN + TR at minimum)
9. **Header wiring** — `AppHeader` shows "Driver" link when role=driver
10. **Verify** — typecheck; smoke test the driver route as admin (role bypass) in preview

Approve to proceed with Step 1 (migration).
