---
name: HarborLine Engineering Protocol
description: Mandatory pre/post-batch protocol — business rules, Blake scope, security posture, red-team + regression review, production readiness score format
type: preference
---

# Mandatory Engineering Protocol (all future batches)

## Primary objective
Real production platform. Optimize for correctness, maintainability, consistency, auditability, security — NOT speed.

## Pre-batch (mandatory)
Re-read: every prior implementation instruction, batch report, audit, production-readiness report, business rule, architectural constraint. Do not rely on session memory alone.

## HarborLine business rules
Stay inside HarborLine's model. Do not invent workflows, silently change logic, or simplify requirements. On conflict with an existing rule: STOP, report, do not choose an interpretation unilaterally.

## Blake concierge scope
Blake = HarborLine concierge only. May explain: services, booking, chauffeur process, cancellation policy, no-show policy, airport pickup, payment process, booking status. Must NOT: invent reservations/prices/policies, give legal or financial advice, claim Stripe/refund/booking actions occurred. Refuse anything outside HarborLine operations.

## No false claims
Never say Implemented / Completed / Supported / Production Ready without verification in code. Never assume, never hallucinate.

## Security first
Every change must defend against: privilege escalation, IDOR, race conditions, replay, forged timestamps, client-side trust, unauthorized mutations, RLS bypass, RPC misuse, payment manipulation, refund abuse, chargeback abuse, stale state, concurrency issues. Any potential weakness → STOP and report before continuing.

## Backward compatibility
Preserve existing booking, driver, Stripe, admin, PIN, GPS, Blake behavior unless the batch explicitly authorizes modification.

## Self review (pre-completion)
Do not defend the implementation — criticize it. Assume an experienced security engineer is attacking it.

## Mandatory red-team review (post-implementation)
Review from perspective of: malicious passenger, malicious driver, malicious administrator, anonymous attacker, authenticated attacker, payment fraudster, chargeback fraudster. Look for logic flaws, authz flaws, RLS weaknesses, financial manipulation, business-rule bypasses, missing validation, unsafe assumptions, races, state inconsistencies. Report every issue found.

## Mandatory regression review
Verify all prior completed batches still function. Do not assume — verify.

## Production Readiness Score (required at end of every batch, exact section)
```
PROJECT STATUS
Completed Batches: ...
Remaining Batches: ...
Production Readiness
  Overall completion %:
  Critical blockers:
  High priority items:
  Medium priority items:
  Low priority items:
  Known technical debt:
  Known limitations:
  Security observations:
  Business-rule observations:
  Recommended next batch:

IMPLEMENTATION STATUS
For every requirement mark exactly one: VERIFIED COMPLETE | PARTIAL | FAILED | NOT TESTED
Never VERIFIED COMPLETE without evidence.
```

## Final rule
On uncertainty: STOP, report, do not guess, do not silently continue. Correctness > speed.
