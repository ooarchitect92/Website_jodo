# API contract and use cases

Base: same-origin `/api` reverse proxy to the NestJS API. Public content reads only published, non-trashed records. Admin controllers require an active MFA-created session and server-side role checks. State-changing browser requests require the configured Origin. Authenticated writes also require `X-CSRF-Token` returned by `/v1/auth/me`. Sessions are HttpOnly cookies, not localStorage bearer tokens.

Nest Swagger exposes implemented routes at `/docs` in non-production mode. Shared runtime schemas in `packages/core/src/contracts.ts` are the field-validation source of truth. Full generated-client/DTO completeness is not claimed.

| Route                                                           | Purpose                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GET /health/live, /health/ready                                 | Process and actual database readiness                                   |
| GET /v1/public/site                                             | Allowlisted public settings/indexing state                              |
| GET /v1/public/pages, /v1/public/pages/by-path?path=/.../       | Published content only                                                  |
| POST /v1/auth/login                                             | Email, password, six-digit OTP; rate limiting and replay guard          |
| GET /v1/auth/me; POST /v1/auth/logout                           | Session reauthorization and revocation                                  |
| GET/POST /v1/admin/content                                      | List and create structured drafts                                       |
| GET /v1/admin/content/:id                                       | Authorized draft/revision view                                          |
| PATCH /v1/admin/content/:id/draft                               | `{expectedVersion, body}`; stale edits return 409                       |
| POST /v1/admin/content/:id/action                               | review, approve, publish, schedule, rollback, unpublish, trash, restore |
| PATCH /v1/admin/settings/:key                                   | Version-checked navigation, brand and form-copy settings                |
| POST /v1/forms/demo/submissions                                 | Explicit structured enquiry; UUID Idempotency-Key required              |
| GET /v1/admin/leads; POST /:id/stage; POST /export              | Protected lead view, stage transition and owner export                  |
| GET /v1/consent; POST /v1/consent/choices                       | Versioned choice; future collection denied after withdrawal             |
| POST /v1/events; POST /v1/attribution/touches                   | Strict optional observation collection, not business authority          |
| POST /v1/chat/start, /messages, /leads, /handoff; GET /messages | Scoped guided chat and durable explicit capture                         |
| GET/POST /v1/admin/media                                        | Public-safe raster upload and registered asset metadata                 |
| GET /v1/media/:filename                                         | Bounded stored WebP filename only                                       |
| GET /v1/admin/overview, /tasks, /outbox, /audit                 | Actual operating records, not fictional dashboards                      |
| GET/POST /v1/admin/campaigns                                    | Approved campaign links; no spending authority                          |
| GET/POST /v1/admin/workflows; POST /simulate; PATCH /:id        | Draft task workflow, simulation and activation/pause                    |
| POST /v1/privacy/requests; GET /v1/admin/privacy-requests       | Verification-required rights intake                                     |
| GET /v1/admin/conversations, /users, /integrations              | Bounded support/staff/provider status                                   |
| POST /v1/admin/users/:id/revoke-sessions                        | Owner session revocation                                                |
| POST /v1/admin/content-export                                   | Audited source/revision/media/settings export                           |

## Durable form example

Headers: `Content-Type: application/json`, `Idempotency-Key: <new UUID for this enquiry>`. Body fields: name, email, phone, institute, role (Owner/Principal/Finance/Administrator/Other), students (positive integer), city, interest (Flex/Cred/Pay/Not sure), optional message, noticeAccepted=true, marketingOptIn=false, formRevision from current public settings, source=form. No hidden browser claim of IP, qualification, price or trusted campaign identity is accepted.

After commit: `{status:'accepted', receipt:'REQ-...', eventId:'<stored UUID>', replayed:false}`. Same key + same validated request returns the same receipt/event with replayed=true. Same key + different request returns 409. Validation returns 422. Authentication/authorization use 401/403. Abuse budgets use 429. A service failure never returns an accepted receipt and should be retried with the same key.

The receipt is not a public record-lookup credential. Optional downstream delivery is not required for durable acceptance. SMTP accepted/uncertain/disabled states remain distinct; no Ads/Meta attribution or real payment state is implied.
