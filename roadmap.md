# HarborLine remediation roadmap

Executing the audit's safe fixes in preview only. No publish, no main changes, no live payments.

- [ ] 1. Blake concierge migrated to the server-side NVIDIA router; stale gateway path removed
- [ ] 2. AI trust boundary: model/tier/system/protectedContext/facts/rules server-authoritative
- [ ] 3. Dead unauthenticated `nvidiaChat` endpoint removed
- [ ] 4. No-show integrity: server-derived evidence, transitions via `advance_assignment`
- [ ] 5. Rate limits on referral/support/incident/legal/no-show endpoints
- [ ] 6. Referral replay/double-claim protection (unique constraint)
- [ ] 7. Stripe sandbox hardening: timing-safe signature, fail-closed idempotency
- [ ] 8. Least-privilege grants: revoke stray anon table/function privileges
- [ ] 9. Driver page metadata (noindex) and modal label accessibility
- [ ] 10. Verification: typecheck, lint, build, targeted tests

Blocked (needs credentials or an owner decision):
- Live Stripe key + live webhook secret (no live payment attempted)
- Resend / Twilio credentials for email + SMS delivery
- Batch 2A contract/quarantine rollout decision (columns exist but are unused)
