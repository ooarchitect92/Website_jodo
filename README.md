# Website_jodo

A working, independently implemented recreation of Jodo's public marketing site with an owned CMS, secure staff console, enquiry management and a durable background worker. Built against **Website Master Blueprint v1.3, 7 October 2026**.

**Delivery status:** working development/demo implementation; **not approved for production**, not a claim that every requirement in the 273-page blueprint is complete. See [release status](docs/acceptance/RELEASE.md), the 120-capability [register](docs/acceptance/blueprint-register.json), and [test evidence](docs/evidence/README.md).

## Included

- Next.js / React / strict TypeScript / Tailwind CSS, responsive blue-and-lavender styling and locally stored reference images.
- Home; Flex / Cred / Pay product sections; about; demo contact; calculator; searchable/paginated blog and case-study libraries; article overviews; careers/support/partner/legal/accessibility utility pages; explicit external login choices.
- **42 seeded content records** plus dynamic listing, category, search, consent, sitemap, RSS and administration routes. Original article overviews link to the source publications; original full articles are not republished.
- Owned block editor: edit, reorder, preview, autosave, undo/redo, conflict protection, review, owner approval, publish, schedule, rollback, manual trash and restore. No source-content expiry or permanent-delete API.
- Authenticator MFA; Argon2id password hashes; HttpOnly sessions; role checks; CSRF and origin checks; encrypted submitted contacts; protected audit records.
- Database-committed enquiries, idempotency, staff tasks, stages and explainable declared-fit scores; consent-gated first-party observations; safe campaign links; guided product chat and handoff requests.
- Durable task-workflow timers and simulations; delivery queue; optional SMTP staff notification adapter; local signed audit checkpoints; image validation/re-encoding; exports; SQL migrations; backup/isolated restore tools.

This is **not Jodo's operational payment/lending service**. Student, parent, institute and business login actions point to official external services. The local admin login is solely for this installation. No Jodo passwords, card data, bank credentials or KYC documents are collected.

## Fast visual preview — no database

Install Node.js 22 and Git, then:

```bash
git clone https://github.com/ooarchitect92/Website_jodo.git
cd Website_jodo
npm ci
npm run preview
```

Open `http://localhost:3000`. This is deliberately **read-only**. Forms and administration cannot report success without the real API/database. Use the full installation below for working enquiries and editing.

## Full local application

```bash
npm ci
npm run bootstrap                 # generates unique local secrets; never overwrites .env
docker compose up -d db            # only PostgreSQL; application can run natively
npm run migrate
npm run seed:demo                  # insert-only; never resets existing content
npm run create:owner               # requires the environment values described below
npm run dev
```

Before `create:owner`, set `OWNER_EMAIL` and a unique `OWNER_PASSWORD` (at least 16 characters) in your private `.env`. The command prints a one-time authenticator enrollment secret. Enroll it in an authenticator app; use its six-digit code when signing in. Do not put credentials in Git, screenshots, chat or this README. Remove `OWNER_PASSWORD` after provisioning. There is no shared/default admin password.

Public site: `http://localhost:3000` · Owner console: `http://localhost:3000/admin/` · Development API docs: `http://localhost:4000/docs`.

For a fully native setup, create the PostgreSQL database/owner yourself and update `MIGRATION_DATABASE_URL`. Set a different restricted runtime account in `DATABASE_URL`, `APP_DB_USER` and `APP_DB_PASSWORD`; the migration command provisions it. PostgreSQL client tools are required for backups. See [deployment](docs/runbooks/deployment.md).

## Run everything in Docker

```bash
npm run bootstrap
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
# Add private OWNER_EMAIL / OWNER_PASSWORD to .env first:
docker compose --profile tools run --rm create-owner
docker compose up -d --build web api worker
```

No schema reset or seed runs implicitly at container startup. Ports bind to loopback by default. Production requires a real reverse proxy/TLS, reviewed environment isolation, owner rights/claims approval, a configured notification route, recovery evidence and the remaining blueprint controls.

## Verification

```bash
npm run doctor
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration           # isolated test database only
npm run test:e2e                   # API + built website must be running
npm run backup
npm run restore:verify             # explicit empty *_restore_verify database required
```

The GitHub Actions CI uses synthetic contacts ending in `example.invalid`, a real PostgreSQL service and Chromium. It does not contact Jodo or a real customer. Browser test traces may contain synthetic test data and are not production evidence. See the workflow run rather than assuming a committed workflow has passed.

## Project map

```text
apps/web/          Public website and route-isolated owner console
apps/api/src/      NestJS capability controllers/services, access and persistence
apps/worker/src/   Durable outbox, task workflows, scheduled publication, SMTP
packages/core/src/ Shared schemas, pure domain rules and insert-only seed snapshot
db/migrations/     Ordered, checksum-verified PostgreSQL migrations
scripts/           Bootstrap, provisioning, health, build, backup and restore tools
infra/native/      Reverse-proxy template
.github/workflows/ Reproducible CI
 docs/             Architecture, source provenance, runbooks and acceptance status
```

SQL migrations and `pg` are the single persistence system in this build; Prisma is **not** claimed as implemented. The public site and admin share one Next deployment but have separate routes and API permissions. Redis, Python, GraphQL, SOAP, Kubernetes and live financial integrations are not required or activated.

## Rights and launch boundaries

Jodo trademarks, public reference images and underlying product claims remain attributable to their respective owners. Reference availability does not establish a reuse licence. The site visibly identifies itself as a recreation and defaults to noindex. Obtain the necessary permissions and replace/review claims before public use; do not remove the notice to misrepresent affiliation.

The website content snapshot was checked on 7 October 2026. It is not a promise that the referenced business's figures, policies or services remain current. External contact actions are explicitly labelled; local demonstration leads are stored in this installation, not submitted to Jodo.

See [owner guide](docs/owner-guide.md), [architecture and decisions](docs/architecture.md), [API contract](docs/api.md), [privacy boundaries](docs/privacy.md), and [release gaps](docs/acceptance/RELEASE.md).
