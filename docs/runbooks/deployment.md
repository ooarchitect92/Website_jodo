# Deployment, recovery and rollback

## Local / native

1. Install a supported Node.js 22 runtime and PostgreSQL 17 server/client tools.
2. Run `npm ci` and `npm run bootstrap`. Do not overwrite an existing `.env`.
3. Create the PostgreSQL database and privileged migration account; set `MIGRATION_DATABASE_URL`. The migration command provisions a distinct restricted app account using `APP_DB_USER` and `APP_DB_PASSWORD`.
4. Run migrate, seed:demo and create:owner. Seeding is insert-only and rejects production mode.
5. `npm run dev` serves web, API and worker. `npm run build && npm run start:prod` runs the built application.

`npm run preview` uses the static seed for read-only public evaluation only. It cannot save CMS changes or fake form success.

## Compose

Use the README's explicit db → migrate → seed → owner → services order. Tools are in the `tools` profile. Containers read only their selected environment variables; runtime services do not receive the migration URL or bootstrap owner password. The database, media and audit paths use volumes. Never use `docker compose down -v` against retained content. Production volume backup/copy is a separate operation.

Production must use role-specific environment files and service accounts. The root developer `.env` contains migration and provisioning information and is not a production secret-distribution strategy. Do not mount it into public web containers. Use the reverse-proxy template only after setting actual TLS/domain/network restrictions; it is not a valid certificate installation by itself.

## Backup and isolated restore

`npm run backup` uses `pg_dump` custom format and excludes role ownership. The output is sensitive; do not commit it. Back up `.data/media`, reviewed configuration and encryption-key recovery separately, with access controls and independent copies.

Create a separate empty database whose name ends `_restore_verify`, set `RESTORE_VERIFY_URL`, and run `npm run restore:verify`. The tool refuses an existing nonempty target or a non-verification name. It checks restored counts and published-revision references. It does not send queued notifications. Reapply lawful deletions/suppressions before any restored environment is reopened; those full reconciliation workflows remain an explicit gap.

## Rollback

Content rollback publishes a previous compatible revision as an audited action; it never deletes later revisions. Application rollback means selecting the prior code commit/image with schema compatibility reviewed. Database migrations are checksum-verified and are not automatically reversed. Never restore an old database to undo a UI bug while newer leads would be lost.

## Incident actions

First stop affected external processing; preserve the database and audit evidence. Revoke compromised staff sessions. Keep public help and forms available only while their integrity can be guaranteed. Inspect blocked/outbox status and notifications before retrying an uncertain SMTP send. Do not reset the database or seed over real content. A successful restart is not root-cause evidence.

Production monitoring, on-call ownership, RPO/RTO, point-in-time recovery, independent audit storage, TLS/DNS continuity and cloud costs must be approved and demonstrated for the actual deployment. Terraform/Kubernetes and a live hosting environment have not been provisioned.
