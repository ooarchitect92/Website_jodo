# Verification evidence

All repository fixtures use synthetic data. Local executed evidence includes real PostgreSQL migrations, restricted-role checks, transaction/outbox/concurrency tests, native builds and database backup/restore. GitHub Actions CI adds reproducible installs and real Chromium journeys/screenshots. Inspect each attached run's conclusion and commit.

A browser, an SMTP test server or an internal API test is not evidence that Jodo, a CRM, Google Ads, Meta, DNS, a mail inbox or a production deployment is connected. The managed local browser rejected localhost navigation; that environment-specific limitation is recorded rather than relabelled as a software pass. Browser execution is performed on the repository CI runner instead.

No production contact records, secrets or authenticator enrollment values belong in these reports. The capability and final-scenario registers distinguish implementation from verification; many blueprint scenarios remain not executed.
