# HarborLine remediation roadmap

Executing the audit's safe fixes in preview only. No publish, no main changes, no live payments.

- [x] 1. Blake concierge migrated to the server-side NVIDIA router; stale gateway path removed
- [x] 2. AI trust boundary: model/tier/system/protectedContext/facts/rules server-authoritative
- [x] 3. Dead unauthenticated `nvidiaChat` endpoint removed
- [x] 4. No-show integrity: server-derived evidence, transitions via `advance_assignment`
- [x] 5. Rate limits on referral/support/incident/legal/no-show endpoints
- [x] 6. Referral replay/double-claim protection (unique index + 23505 handling)
- [x] 7. Stripe sandbox hardening: timing-safe signature, fail-closed idempotency (503 → Stripe retries)
- [x] 8. Least-privilege grants: revoked stray anon table/function privileges
- [x] 9. Driver page metadata (noindex) and modal label accessibility
- [x] 10. Verification: typecheck clean, build OK (repo-wide prettier lint debt pre-exists, untouched)

Blocked (needs credentials or an owner decision):
- Live Stripe key + live webhook secret (no live payment attempted)
- Resend / Twilio credentials for email + SMS delivery
- Batch 2A contract/quarantine rollout decision (columns exist but are unused)
