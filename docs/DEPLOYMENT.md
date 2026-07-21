# HarborLine — Deployment & Environment Reference

_Last updated: Batch D closure_

## Runtime overview

- **Frontend / server routes**: TanStack Start on a Cloudflare Worker (edge).
- **Database, auth, storage**: Lovable Cloud (Supabase).
- **Payments**: Stripe (via Lovable connector gateway — sandbox live).
- **Email**: Resend REST API (provider abstraction, no-op if unconfigured).
- **SMS**: Twilio REST API (provider abstraction, no-op if unconfigured).
- **Maps / geocoding**: Google Maps (connector-managed).
- **AI concierge (“Blake”)**: Lovable AI Gateway (GPT-5.5).

## Public URLs

| Purpose | URL |
| --- | --- |
| Production (published) | `https://luxe-drive-usher.lovable.app` |
| Production (stable ID) | `https://project--4c768501-ca6a-49a7-8679-995ba488489e.lovable.app` |
| Preview (stable ID) | `https://project--4c768501-ca6a-49a7-8679-995ba488489e-dev.lovable.app` |
| Public health probe | `GET /api/public/health` |
| Stripe webhook | `POST /api/public/payments/webhook?env=sandbox` |

Custom domain: not yet configured. See **Custom Domain Readiness** below.

## Environment variables

### Client-visible (safe in bundle — prefixed `VITE_`)

| Name | Source | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Lovable Cloud | auto-generated |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Lovable Cloud | auto-generated |
| `VITE_SUPABASE_PROJECT_ID` | Lovable Cloud | auto-generated |
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID` | Google Maps connector | auto-generated |
| `VITE_PAYMENTS_CLIENT_TOKEN` | **NOT CONFIGURED** | Required by Stripe embedded checkout on the passenger client. Blocking end-to-end pilot until set. |

### Server-only (secrets — never expose to bundle)

| Name | Purpose | Status |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server DB access | Auto-managed |
| `LOVABLE_API_KEY` | Gateway + AI | Auto-managed |
| `STRIPE_SANDBOX_API_KEY` | Stripe sandbox (via gateway) | **Configured** |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Stripe webhook signing | **Configured** |
| `STRIPE_LIVE_API_KEY` | Stripe live | Not configured — required for go-live |
| `PAYMENTS_LIVE_WEBHOOK_SECRET` | Stripe live webhook | Not configured — required for go-live |
| `RESEND_API_KEY` | Transactional email | **Not configured** — emails safe no-op |
| `EMAIL_FROM` | e.g. `HarborLine <notify@harborline.com>` | Required alongside RESEND_API_KEY |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS | **Not configured** — SMS safe no-op |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY` | Autocomplete + geocoding | Auto-managed via connector |

### Adding provider credentials

Use the workspace **Secrets** panel (or ask the Lovable agent to run `add_secret`). Never commit secrets to the repo.
Do **not** rename Supabase or Lovable keys — they are managed and rotation happens via dedicated tools.

## Configuration separation (production vs test)

- Stripe: `env` query param on the webhook (`?env=sandbox` or `?env=live`) selects credentials.  
  `bookings.stripe_session_id` and `stripe_refunds.environment` record which environment produced each row.
- Email/SMS: single provider per environment. There is no "test-mode" flag on Resend/Twilio; use a dedicated sandbox project or test recipients.
- All rate-limit buckets are keyed by `(action, bucket_key)` — no environment leak between projects.

## Webhook / callback / CORS review

| Endpoint | Auth model | Notes |
| --- | --- | --- |
| `POST /api/public/payments/webhook` | Stripe signature (HMAC-SHA256, 5-min window, idempotent via `stripe_events`) | Public prefix bypasses auth — signature verified inside handler. |
| `GET /api/public/health` | None | Returns JSON `{ status, timestamp }`. Safe. |
| `POST /api/blake` | Lovable AI Gateway (server-side key) | Rate-limited via `monitoring_capture` bucket. |
| OAuth `redirect_uri` | Full same-origin URL, `/auth` (public) | Never protected routes. |

All server functions use `requireSupabaseAuth` where user context is required; no CORS needed (same-origin).

## Custom domain readiness

The app is currently on `luxe-drive-usher.lovable.app`. To attach `harborline.com` (or similar):

1. Publish the project (already done).
2. Project Settings → Domains → Connect existing domain (or Buy new domain).
3. Add DNS A records for the root and `www`: `A @ 185.158.133.1`, `A www 185.158.133.1`.
4. Add TXT record `_lovable` = value shown in the setup dialog.
5. Wait up to 72h for propagation. SSL provisioning is automatic.
6. If Cloudflare-proxied, enable "Domain uses Cloudflare or a similar proxy" in the connect dialog.
7. After the domain goes **Active**, update:
   - Google OAuth authorized redirect URIs (Cloud → Supabase Auth → Google).
   - Stripe webhook endpoint URL (Stripe Dashboard when moving to live).
   - `EMAIL_FROM` domain (must match a Resend-verified sender).

## Rate limiting

Server-side only. All checks use `check_and_bump_rate_limit(action, key, limit, window_seconds)`. Client throttling is
not relied on. Instrumented call sites:

| Action | Bucket | Limit / window |
| --- | --- | --- |
| `password_reset` | email address | 5 per hour |
| `admin_signin_failed` | email address | 10 per hour |
| `admin_provisioning` | admin user id | 20 per hour |
| `blake_message` | user id | 60 per hour |
| `monitoring_capture` | source | 60 per minute |

## Failure modes

- Missing `RESEND_API_KEY` → send call returns `{ status: "skipped_no_provider" }`, logged in `email_deliveries`, no exception.
- Missing Twilio credentials → SMS call returns `{ status: "skipped_no_provider" }`, logged in `sms_deliveries`.
- Missing Stripe live keys → live webhook rejects (`env=live`); sandbox continues to function.
- Missing `VITE_PAYMENTS_CLIENT_TOKEN` → embedded checkout fails at client init; server-side session still creates.

## Restore drills

Logged in `restore_drills`. Run at least monthly per Batch B runbook.
