# Privacy, security and data boundaries

## Inventory

| Data                                                                   | Purpose / location                                                 | Access and outgoing destinations                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Name, email, phone, institute, role, city, interest, submitted message | Deliberately submitted enquiry, encrypted `leads.encrypted_fields` | Owner/sales; no contact values in analytics or notification email                    |
| Password hash, encrypted TOTP secret, session token hash               | Staff authentication                                               | Auth service; cookies HttpOnly; no shared default password                           |
| Consent choices, opaque token hash                                     | Required choice evidence                                           | Restricted consent ledger; choice does not enable financial/advertising integrations |
| Allowed campaign fields and route/event IDs                            | Optional first-party analytics after consent                       | Restricted database; no Google/Meta SDKs                                             |
| Guided chat topics and deterministic answers                           | Requested product assistance                                       | Scoped operational session; not converted into a browsing identity                   |
| Audit actor/action/object and safe state changes                       | Accountability                                                     | Owner; append-only role/trigger controls and local signed checkpoints                |
| Validated public images                                                | Approved public site content                                       | Same-origin public delivery; retain rights notes                                     |
| Privacy request email                                                  | Verify and route rights request                                    | Encrypted operator queue; does not confirm account existence                         |

No raw IP visitor profiles, exact coordinates, browser fingerprinting, payment secrets, Jodo credentials, KYC data, real lending decisions or ad audience sync are implemented. Runtime rate limits use a keyed network observation; proxy-derived identity is not trusted. High-volume deployment needs reviewed proxy topology and per-route abuse budgets rather than blindly trusting `X-Forwarded-For`.

## Collection and revocation

No optional behavioral queue is persisted before consent. A visitor can reject optional analytics and submit an enquiry or use guided support. Withdrawal is stored server-side; event ingestion rechecks it. Browser tabs resynchronize through BroadcastChannel, focus, visibility and pageshow. No third-party scripts are loaded for marketing. Event collector schemas reject unknown fields and trusted-business event claims.

Potentially sensitive form, login, privacy and calculator routes are excluded from behavioral event storage. Do not add free-text event parameters, contact information, chat text or raw URL queries. Bounded approved campaign names are untrusted source observations, not proof of ad exposure.

## Unfinished operating controls — production blockers

Retention schedules, legal holds, verified rights execution across processors, purge approval/execution and post-restore deletion reconciliation are not fully implemented. Do not process real customer data until approved data-class schedules and an accountable rights process are configured and tested. Keeping source blogs indefinitely does not justify retaining personal information indefinitely.

MFA login and revocation are implemented; privileged recovery, invitations, step-up flows, independent audit storage, comprehensive rate-limit/load evaluation and formal penetration testing are not complete. CSP is restrictive about destinations but retains inline-script permission for the framework; nonce-based hardening remains work.

Production requirements and applicable law require qualified review. No claim of universal privacy compliance or ISO certification is made for this software.
