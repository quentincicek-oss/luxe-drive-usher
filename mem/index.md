# Project Memory

## Core
Production chauffeur platform. Optimize for correctness, security, auditability — never speed.
Before every batch: re-read prior batch reports, audits, business rules, architectural constraints.
Stay strictly inside authorized batch scope. No silent business-logic changes. On conflict: STOP and report.
Never claim "implemented / completed / production ready" without verified evidence in code.
Every batch ends with: self-review, red-team review (malicious passenger/driver/admin/attacker/fraudster), regression review of prior batches, and a Production Readiness Score section.
Preserve existing booking, driver, Stripe, admin, PIN, GPS, Blake flows unless explicitly approved for change.
Guard against: privilege escalation, IDOR, race conditions, replay, forged timestamps, client trust, RLS bypass, RPC misuse, payment/refund/chargeback abuse.
Blake is HarborLine concierge only — never general assistant; never invent bookings/prices/policies/refunds; refuse out-of-scope.
Use only the four status labels: VERIFIED COMPLETE / PARTIAL / FAILED / NOT TESTED.

## Memories
- [Engineering protocol](mem://protocol/engineering-protocol) — Full mandatory protocol text: business rules, Blake scope, security, red-team, readiness score format
