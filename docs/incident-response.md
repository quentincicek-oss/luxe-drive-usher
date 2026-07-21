# HarborLine — Incident Response

_Last reviewed: Batch B (2026-07-21)._

## Severity ladder

| Level | Definition                                                | Response time | Comms         |
| ----- | --------------------------------------------------------- | ------------- | ------------- |
| SEV1  | Full outage, data loss, payment failure, security breach  | 15 min        | All channels  |
| SEV2  | Major feature degraded (booking, dispatch, auth)          | 1 h           | On-call + eng |
| SEV3  | Minor feature degraded, workaround available              | 4 h           | Eng channel   |
| SEV4  | Cosmetic, single-user issue                               | Next day      | Ticket        |

## Roles

- **Incident Commander (IC)** — decides scope, coordinates.
- **Comms Lead** — internal + external updates (status page, email).
- **Ops Lead** — infra, database, restore actions.
- **Scribe** — timeline in incident channel.

## Playbook (SEV1 / SEV2)

1. **Detect** — pager, `admin_system_health_snapshot`, or user report.
2. **Declare** — open incident channel, assign IC.
3. **Stabilize** — flip feature flag, throttle, or roll back the offending deploy.
4. **Communicate** — publish status update within 30 min for SEV1.
5. **Recover** — restore from backup runbook if data is affected (`docs/backup-restore.md`).
6. **Verify** — health snapshot green, KPIs recovering, monitoring quiet.
7. **Close** — announce all-clear, schedule post-mortem within 5 business days.

## Post-mortem template

- Summary, impact window, user impact
- Timeline (from `audit_log` + `monitoring_events`)
- Root cause (5-whys)
- What went well / what went poorly
- Action items with owners and dates

## Escalation

- On-call rotation: `#harborline-oncall`.
- Fallback: admin group with MFA — reset via `/admin/recover`.
- Third parties: Stripe (`support@stripe.com`), Google Maps, SMS/email vendors — track responses in the incident channel.

## Data-breach checklist

If personal data is exposed:

1. Contain (rotate keys, disable affected endpoints).
2. Preserve evidence (`audit_log`, `monitoring_events`).
3. Notify DPO within 24 h.
4. Regulatory notice within 72 h (GDPR / applicable jurisdictions).
5. User notice per DPA (`/legal/dpa`).
