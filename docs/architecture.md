# Architecture and implementation decisions

Reference: Website Master Blueprint v1.3. Site scope: public Jodo reference recreation + owner-operated marketing/content/enquiry platform, single deployment, one database, English/India presentation. The business/legal owner, production domain, traffic target, lead response commitment, rights approval and hosting budget are **not yet supplied**.

## Request and business paths

Browser → Next.js server-rendered public route → NestJS public-content API → PostgreSQL published revision. Unpublished revisions do not enter public queries. Published content is fetched without a shared cache in this initial release, so edits become visible on the next request. The read-only preview explicitly uses the bundled seed; it is not an outage fallback pretending to be the live CMS.

Structured form/chat confirmation → NestJS runtime schema validation → idempotency advisory lock → encrypted lead + safe audit + stable-event outbox in one database transaction → receipt after commit. The worker creates an idempotent staff task and queues optional SMTP notification. Disabled/uncertain integrations are shown as blocked, not delivered. CRM stages and qualification remain separate from the deterministic declared-fit score.

Owner → password + TOTP → HttpOnly server session → per-request role/CSRF checks → optimistic-concurrency draft edit → review → owner approval → immutable published revision. Manual trash retains source history; restore returns to draft. Scheduled publication and task workflows use durable PostgreSQL state. No worker chooses content for deletion.

## Decisions and deviations

| Decision | Choice and reason                                                                                                                     | Remaining boundary                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ADR-001  | One Next app with route-isolated public/admin components. Reduces deployment overhead without moving business rules into the browser. | Separate origins/deployments can be introduced later.                                                           |
| ADR-002  | NestJS capability files and shared schema library; modular monolith.                                                                  | Files are not dozens of empty module directories. Module extraction can follow growth.                          |
| ADR-003  | `pg` plus checksum-verified SQL migrations rather than Prisma. One migration source, explicit transaction/constraint control.         | Reviewed deviation from blueprint default ORM; no Prisma claim.                                                 |
| ADR-004  | PostgreSQL outbox/task timers, no Redis dependency.                                                                                   | At-least-once external effects, not exactly-once. SMTP uncertainty requires operator reconciliation.            |
| ADR-005  | Local image storage with validation and re-encoding.                                                                                  | S3/CDN/private-resource adapters remain unimplemented.                                                          |
| ADR-006  | Guided, deterministic, topic-selected product chat.                                                                                   | No generative model, arbitrary transcript collection or live agent messaging. Handoff creates a task only.      |
| ADR-007  | Contact/analytics purpose separation; basic blocking before choice.                                                                   | Advertising, replay, IP geolocation and browser coordinates remain disabled.                                    |
| ADR-008  | Independent reference site, not financial-system replication.                                                                         | No payment, loan underwriting, mandates, real fees, KYC or customer entitlements.                               |
| ADR-009  | No permanent-purge endpoint.                                                                                                          | Safer interim boundary, not completion of the blueprint's two-person purge workflow.                            |
| ADR-010  | Full-dependency container runtime and non-root account.                                                                               | Image minimisation, digest policy, production resource sizing and managed infrastructure remain operating work. |
| ADR-011  | Dynamic public reads with no-cache for publication correctness.                                                                       | Field performance, CDN invalidation and multi-instance optimization need separate evidence.                     |

## Data responsibilities

`content/revisions/form_revisions`: protected structured source and immutable published versions. `users/sessions`: local MFA staff identity and revocation. `leads/lead_activities`: encrypted submitted fields and controlled stages. `consent/consent_history/acquisition/events`: restricted permission evidence and permitted observations. `outbox/notifications/tasks/workflows/workflow_runs`: durable asynchronous work. `media/settings/campaigns`: owner-operated site configuration. `chats/chat_messages`: scoped guided chat. `privacy_requests`: verification-required operator queue. `audit`: append-oriented actor/action/object records.

Runtime database role cannot DELETE/TRUNCATE source content or UPDATE/DELETE historical audit/revisions. The migration owner is privileged; production must keep its credentials and SQL privileges away from web/API/worker service accounts. A local audit chain/checkpoint does not protect against an administrator rewriting every copy. Independent trusted storage is an unresolved launch requirement.

## Operational defaults

Production is not approved. External ad/CRM/payment destinations are not active. Native and Compose command paths are supplied. Production TLS/DNS/account ownership, monitoring delivery, key recovery, provider contracts, retention schedules and second-person owner acceptance must be configured and demonstrated independently of source code delivery.
