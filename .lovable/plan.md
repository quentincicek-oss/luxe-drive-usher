
# Batch 1 Pre-flight Plan — Versioned Booking Policy Foundation

Scope is strictly limited to the schema, secure RPCs, admin UI, and audit logging for cancellation and no-show policies. No existing runtime flow is touched.

## 1. Migration (single file)

`supabase/migrations/<ts>_booking_policies_foundation.sql`

### Tables

**`public.cancellation_policies`** (append-only versioned)
- `id uuid pk default gen_random_uuid()`
- `policy_key text not null` — logical group (e.g. `standard`)
- `version int not null` — server-assigned, monotonically increasing per `policy_key`
- `name text not null`
- `service_type text not null default 'standard'` — check in (`standard`,`airport`)
- `free_cancellation_enabled boolean not null default true`
- `free_cancellation_cutoff_hours int not null default 24` — check `>= 0`
- `late_cancellation_enabled boolean not null default true`
- `fee_type text not null` — check in (`fixed`,`percentage`,`full_fare`,`none`)
- `fee_fixed_cents int` — check `>= 0`; required iff `fee_type='fixed'`
- `fee_percent_bps int` — basis points 0–10000; required iff `fee_type='percentage'`
- `fee_cap_cents int` — check `>= 0`
- `allow_cancellation_inside_cutoff boolean not null default true`
- `admin_review_required boolean not null default true`
- `customer_summary text not null` — non-empty
- `internal_notes text`
- `effective_at timestamptz not null default now()`
- `expires_at timestamptz`
- `active boolean not null default false`
- `created_at timestamptz not null default now()`
- `created_by uuid references auth.users(id)`
- Constraints: `unique(policy_key, version)`; CHECK combinations; CHECK `expires_at is null or expires_at > effective_at`.
- Partial unique index to prevent overlapping active versions per `policy_key`+`service_type`: `unique(policy_key, service_type) where active`.

**`public.no_show_policies`** (append-only versioned)
- Same versioning fields as above, plus:
- `service_type text not null` — check in (`standard`,`airport`)
- `no_show_enabled boolean not null default true`
- `min_wait_seconds int not null` — check `>= 0`
- `required_contact_attempts int not null default 1` — check `>= 0`
- `fee_type` / `fee_fixed_cents` / `fee_percent_bps` / `fee_cap_cents` (same rules)
- `automatic_charge_enabled boolean not null default false`
- `admin_review_required boolean not null default true`
- `customer_summary text not null`
- `internal_notes text`
- `effective_at`, `expires_at`, `active`, `created_at`, `created_by`
- Partial unique index: `unique(policy_key, service_type) where active`.

Both tables have **no `updated_at`** and **no UPDATE grant** — rows are immutable except for `active` toggles routed through RPCs (which perform UPDATE via DEFINER, not via authenticated grants).

### RLS & GRANTs
- Enable RLS on both tables.
- `GRANT SELECT ON public.cancellation_policies, public.no_show_policies TO authenticated;` — SELECT policy restricted to admins for full row; a public view exposes only customer-safe columns.
- `GRANT ALL ON ... TO service_role;`
- No grants to `anon`.
- No `INSERT/UPDATE/DELETE` to `authenticated` — all mutations go through DEFINER RPCs.
- Admin-only SELECT policy: `USING (public.has_role(auth.uid(),'admin'))`.
- Two views `public.v_active_cancellation_policy` and `public.v_active_no_show_policy` expose only customer-safe columns (excluding `internal_notes`, `created_by`); `GRANT SELECT ... TO authenticated` (used by future batches, not wired into runtime yet).

### RPCs (all `SECURITY DEFINER SET search_path = public`, guarded by `has_role(...,'admin')`, invoke `_audit_write`)
- `admin_create_cancellation_policy(_payload jsonb) returns jsonb` — creates version 1 for a new `policy_key`.
- `admin_create_cancellation_policy_version(_policy_key text, _payload jsonb) returns jsonb` — locks max version row `FOR UPDATE`, inserts `version = max+1`, new row inactive.
- `admin_activate_cancellation_policy(_id uuid, _reason text) returns jsonb` — in one transaction deactivates any currently-active row for same `(policy_key, service_type)`, activates `_id`. Uses row-lock on the group.
- `admin_deactivate_cancellation_policy(_id uuid, _reason text) returns jsonb`.
- `admin_list_cancellation_policies() returns setof cancellation_policies` — admin-only.
- Mirror set for `no_show_policies`.
- `get_active_cancellation_policy(_service_type text, _at timestamptz default now()) returns jsonb` — reads active row (safe columns only), invoker-security, returns null if none.
- `get_active_no_show_policy(_service_type text, _at timestamptz default now()) returns jsonb`.
- Payload validation: enum checks, fee-type/value coherence, non-negative numbers, percentage 0–10000 bps, non-empty summary; on failure `RAISE EXCEPTION`.
- Audit action names: `policy.cancellation.created`, `.version_created`, `.activated`, `.deactivated`, and no-show equivalents.

### Seed
Insert three **inactive** version-1 rows (`standard` cancellation, `standard` no-show 15min, `airport` no-show 45min) with placeholder `fee_type='none'` and neutral customer summaries. Not activated — no runtime effect.

## 2. Server functions (new file)

`src/lib/policies.functions.ts` — thin `createServerFn` wrappers with `.middleware([requireSupabaseAuth])` mirroring the pattern in `src/lib/admin.functions.ts`:
- `adminListCancellationPolicies`, `adminCreateCancellationPolicy`, `adminCreateCancellationPolicyVersion`, `adminActivateCancellationPolicy`, `adminDeactivateCancellationPolicy`
- Same six for no-show.
- Zod validation for payloads (mirrors DB CHECKs).

## 3. Admin UI

- New route: `src/routes/admin.policies.tsx` (Operations → Booking Policies).
- New component: `src/components/admin/BookingPoliciesPanel.tsx` with two tabs (Cancellation, No-Show), list of versions per group, "New version", "Activate/Deactivate" (confirm dialog), read-only history, form with validation.
- Prominent banner: *"No financial charge is performed by this settings screen in the current implementation…"*
- Modify `src/components/admin/AdminSidebar.tsx`: add one nav entry `{ to: "/admin/policies", label: "Policies", icon: ScrollText }` between Operations and Settings. No other UI changes.

## 4. Tests / verification

- `bunx tsgo --noEmit` and `bun run build`.
- `supabase--linter` after migration.
- `supabase--read_query` to verify: seed rows present, RLS enabled, GRANTs match spec, `_audit_write` fires (invoke RPCs, then select from `audit_log`).
- Manual admin UI smoke via Playwright: navigate to `/admin/policies` while signed in as admin, create version, activate, verify history.
- Regression: load `/`, `/book`, `/admin`, `/admin/trips`; confirm no schema-level impact on `bookings`, `create_booking`, `advance_assignment`, `verify_booking_pin` (grep-only — no code changes to those).

## 5. Rollback plan

Single reversal script (not executed):
```
DROP VIEW IF EXISTS public.v_active_cancellation_policy, public.v_active_no_show_policy;
DROP FUNCTION IF EXISTS public.admin_create_cancellation_policy(jsonb),
  public.admin_create_cancellation_policy_version(text,jsonb),
  public.admin_activate_cancellation_policy(uuid,text),
  public.admin_deactivate_cancellation_policy(uuid,text),
  public.admin_list_cancellation_policies(),
  public.get_active_cancellation_policy(text,timestamptz),
  -- no-show equivalents --
;
DROP TABLE IF EXISTS public.cancellation_policies, public.no_show_policies;
```
Only touches new objects.

## 6. Risks

- Partial unique index on `active` prevents two active rows per group — must ensure activation RPC deactivates in same tx (uses `FOR UPDATE` + single UPDATE-then-INSERT-of-audit).
- View + `GRANT SELECT` to authenticated is required because future batches will read the active row from passenger context; internal notes stay hidden.
- Sidebar edit is the only touched non-new file.

Proceeding to implement after this plan is on record.
