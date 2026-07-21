# HarborLine — Backup & Restore Runbook

_Last reviewed: Batch B (2026-07-21)._

## Backups (managed)

Lovable Cloud performs continuous physical backups of the Postgres cluster:

- **Point-in-time recovery (PITR)** — up to the last 7 days at second granularity.
- **Daily snapshots** — retained for 7 days.
- **WAL streaming** — enabled by default.

No manual backup action is required for the primary database. Object storage
buckets (driver documents, receipts) are versioned; deletion is soft and
recoverable within 30 days.

## Logical export (weekly)

An administrator MUST take a weekly logical export for offline retention:

1. From an admin workstation with `psql` and `pg_dump` installed:
   ```bash
   pg_dump --no-owner --no-acl --schema=public \
     --file=harborline-$(date -u +%F).sql "$HARBORLINE_DB_URL"
   ```
2. Encrypt the file with `age` or GPG using the ops key.
3. Upload to the cold-storage bucket `harborline-backups/`.
4. Record the drill via **Admin → System Health → Restore Drills** with
   method `logical`.

## Restore procedures

### 1. Point-in-time recovery (data corruption in last 7 days)

1. Open Lovable Cloud → Backend → Backups.
2. Choose "Restore to point in time" and select the timestamp _before_ the incident.
3. Provision a restore project (do not overwrite production).
4. Verify integrity: `SELECT count(*)` against `bookings`, `profiles`, `user_roles`.
5. Cut over by swapping the connection string in Lovable Cloud env once verified.
6. Record via **Admin → System Health → Restore Drills** as `pitr` / `passed|partial|failed`.

### 2. Snapshot restore (full loss)

1. Restore latest daily snapshot to a fresh project.
2. Replay any application-level events from `audit_log` if needed.
3. Follow steps 4–6 above.

### 3. Logical restore (offline copy)

1. Provision a fresh Postgres instance.
2. `psql "$TARGET_DB_URL" -f harborline-YYYY-MM-DD.sql`.
3. Re-create Data API grants and RLS policies (bundled in project migrations).
4. Record the drill.

## Restore drill cadence

- **Monthly**: PITR drill against a scratch project.
- **Quarterly**: Full logical restore end-to-end.
- **Annually**: Tabletop exercise covering full-loss recovery.

Every drill MUST be logged in `restore_drills` via the Admin dashboard.
The System Health page surfaces the last drill timestamp — if it exceeds 45 days it will show as stale.

## RPO / RTO targets

| Scenario                | RPO   | RTO   |
| ----------------------- | ----- | ----- |
| Row-level corruption    | 5 s   | 30 m  |
| Full-database loss      | 24 h  | 4 h   |
| Region loss (offline)   | 7 d   | 24 h  |
