# HarborLine — Release Checklist

Run through this before publishing any production release.

## Pre-flight

- [ ] Typecheck clean (`tsgo` in CI).
- [ ] Production build clean.
- [ ] No new critical security findings.
- [ ] All new tables have GRANTs, RLS, and policies scoped to `auth.uid()` or `has_role()`.
- [ ] All new SECURITY DEFINER functions set `search_path = public`.
- [ ] Audit log entries added for every admin mutation.

## Data

- [ ] Migrations idempotent (safe to re-run).
- [ ] Backfills batched (no >10s statements in production).
- [ ] New PII flows documented in `/legal/privacy`.

## Feature flags & rollout

- [ ] New user-visible features gated for staged rollout when risky.
- [ ] Fallback path tested.

## Observability

- [ ] `monitoring.captureException` on all new server-side entry points.
- [ ] New integrations recorded in **System Health → Integrations**.
- [ ] Runbook updated if incident surface area changed.

## Legal / consent

- [ ] Cookie consent categories still accurate.
- [ ] Terms / Privacy / DPA revisions bumped and re-accepted where required.

## Ops

- [ ] Last restore drill within 45 days.
- [ ] MFA enforced for all admin accounts.
- [ ] Rate-limit buckets reviewed for new endpoints.

## Post-deploy

- [ ] Smoke test: unauthenticated home, sign-in, book, admin dashboard, health.
- [ ] Health snapshot green for 15 min post-deploy.
- [ ] Announce release notes in `#harborline-releases`.
