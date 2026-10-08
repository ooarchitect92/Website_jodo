# Production completion plan — Jodo-inspired education payments SaaS

Status: **implementation plan; not production approval**. Updated 2026-10-08.
Sources of requirements: `Jodo_Dynamic_SaaS_India_Complete_Blueprint_v2` and `Website_Master_Blueprint_v1_3_Final_Consolidated`. The public Jodo website is a feature benchmark only, not an authorization to reuse its assets or proprietary implementations.

## Current repository baseline
This repository already has a Next.js/TypeScript public site and owner UI, a NestJS modular API, PostgreSQL migrations, a durable worker, tests, developer documentation, and portions of tenant/fee/payment functionality. Do **not** start a competing parallel application or overwrite existing working flows. Refer to `docs/acceptance/RELEASE.md` for verified limitations. The capability register and test evidence must remain the source of truth for status.

## Release-critical work packages (in dependency order)
1. **Inventory and traceability**: map every relevant Jodo public journey and both blueprint capability registers to routes, API controllers, persistent entities, role/tenant policies, tests, evidence and activation status. Unknown/private Jodo behaviors remain unknown, not silently invented.
2. **Cross-tenant security**: review and scope every tenant-owned content, leads, campaigns, workflows, media, notifications, exports, jobs and audit/API entry point. Add negative tests for tenant switching, guessed IDs, asynchronous workers, search results, files and cross-tenant exports. Block public multi-tenant activation until the matrix passes.
3. **Complete identity and tenancy**: verified signup, invitations, recovery, session revocation, MFA step-up, role/row/field policy enforcement, maker-checker, tenant suspension/offboarding and limits. All state-changing routes require authorization on the server.
4. **Education fee lifecycle**: cover enrolment, guardians and fee plans, approved concessions, receivable creation, dues, corrections, withdrawals and transfers, reports, receipts and refunds. Preserve immutable financial records and maker-checker boundaries.
5. **Payment-provider activation**: complete **one contracted and approved** partner adapter for hosted one-time payments, independently authorized mandates/eNACH/UPI AutoPay where eligible, pre-debit obligations, callback verification/replay defense, scheduled debit retries, unknown-outcome handling, reconciliation, settlement and refund statuses. Never convert redirects/screenshots into confirmed payment state; provider-confirmed events and settlement evidence are authoritative. Ensure idempotency and balanced entries.
6. **Owner CMS and acquisition**: complete versioned dynamic forms, safe modules, owner publication, consent-aware analytics, attribution, SEO and campaigns. Do not inject marketing tags without applicable authorization and consent. Preserve manual-only deletion requirements and attributable audit events.
7. **Customer/operations portals**: student/payer and institute journeys with tenant/relationship visibility, receipts, payment history, dues, collection operations, discrepancy queues, support, communication preferences and provider-gated messages.
8. **Infrastructure/security**: verified production environment, HTTPS and DNS, secrets and key rotation, object storage with signed access, CI checks, least-privilege databases, backup/restore tests, alerts, incident runbooks, privacy/rights processes, penetration and load tests, and cost controls.
9. **Acceptance**: automated unit/integration/browser/security suites, real partner UAT, dual-control controls, reconciliation fixtures, recovery drills, independently reviewed legal and security gates. Keep a published PASS/FAIL/NOT RUN record for every critical scenario.

## Must-not-fail financial invariants
- Each payment order, mandate, allocation, ledger posting, refund and settlement belongs to exactly one authorized tenant and recorded business context.
- Repeated webhooks or retries do not create duplicate receipts, debits, refunds or ledger entries.
- An order is not paid because a browser returned to a success URL.
- Refunds never exceed externally confirmed, eligible amounts; processing and completed states are distinct.
- Debit submission never exceeds the active mandate amount, date window or authorized schedule.
- Reconciliation differences remain visible until independently resolved; no fabricated settlement.
- Sensitive finance changes require distinct approvers and an append-only audit trail.

## Public site parity vs. original implementation
Cover the public site route families (home, product pages, calculator, demo/contact, resources, case studies, company/legal, mobile navigation) and documented product classes (fee collection, recurring plans, communication, analytics, reconciliation). Use original copy, branding, illustration and proof. Do not claim Jodo customer metrics, partnership logos, certification, testimonials, provider access or exact private feature parity.

## Release decision
**NO-GO** for accepting live payments or sensitive real student data until the above gates are evidenced. Current development/demo modules can be run according to README; they are not a substitute for regulatory, provider, operational and security approval. Update this file and `docs/acceptance/RELEASE.md` when code and tests are merged, recording evidence links rather than optimistic percentages.
