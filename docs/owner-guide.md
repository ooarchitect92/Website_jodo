# Owner guide

## First access

Provision an individual owner using `npm run create:owner`, store its enrollment secret securely in an authenticator, and sign in at `/admin/`. This is not a Jodo customer login. Four roles are enforced in the API: owner, editor, sales and analyst. The owner CLI can provision the selected `STAFF_ROLE` (default owner). Account invitation/recovery and full role administration are not implemented; do not claim this is a complete identity product.

## Edit and publish

Open **Content & publishing**, search an existing route, and choose **Edit / review**. Page title, description, category, cover and section fields are structured values. Add and reorder approved sections with the labelled buttons. Preview is noninteractive and uses the same block renderer. Routine text/layout edits do not require a source deployment.

Wait for **Saved draft** after autosave or choose **Save now**. This status requires a server acknowledgment. A draft edit never changes the published revision. On conflict, download the unsaved local draft and reload the server revision; the API does not silently overwrite another editor. Local recovery is per-tab, expires after one hour and is cleared at sign-out. Do not use shared unattended devices for confidential drafting.

Supply an action reason. Submit for review, approve as owner, then publish. Schedule uses your browser's selected local date/time and is stored in UTC. Revision rollback is an audited publication action, not deletion of later history. The public page reads the new published revision on its next request.

Manual trash asks for confirmation and a reason. Source content remains indefinitely; there is no yearly or time-in-trash purge. Restore returns to unpublished draft, requiring deliberate review/approval/publication. Permanent purge is not available in this release.

## Manage enquiries

Public form and guided-chat capture use the same backend transaction. Only an actual server receipt means the enquiry was accepted. In **Leads**, inspect synthetic submitted contact fields, declared role/product and the score explanation. Follow the allowed stage transitions. A score is not qualification, a won stage is not a verified payment, and no ad-platform conversion is claimed.

The worker creates staff tasks even when SMTP is disabled. Check **Delivery queue** for blocked, retry and uncertain states. Retry does not manufacture a new lead. Configure an owned SMTP sender only after validating receipt and domain authentication; acceptance by an SMTP server is not proof of inbox delivery.

## Media, campaigns and workflows

Media accepts JPEG, PNG and WebP under 4 MB with alt text and rights notes. Files are decoded and re-encoded to WebP. SVG/document/private uploads are not accepted by this owner upload route. Reference images have separate provenance in `docs/reference/assets.json`.

Campaign links use approved source/medium values and safe internal destinations. Never put personal details or sensitive audience labels into campaign parameters. In this release this does not launch ads or integrate platform reporting.

Task workflows contain tasks, durable delays and a stop-if-contacted step. Simulate before activation; no simulation contacts an external service. Pause prevents further processing/enrollment for that workflow. This is not the full marketing-channel graph builder in the blueprint; automated marketing sends and segments are not implemented.

## Privacy and exports

Visitors can reject analytics and still submit a form. Requests in **Privacy requests** are unverified until the operator checks identity. This queue does not itself complete a lawful deletion/access request. Follow the documented operator process before using real personal information.

Owner exports are audited. Keep exported leads, drafts and backups private. Audit and content exports are separate from publicly viewable source. **Support requests** shows handoff requests, not joined live agents. **Integration status** intentionally lists missing providers rather than displaying decorative connected badges.

## Before production

Complete every critical item in `docs/acceptance/RELEASE.md`. A second operator must repeat editing, conflict, publication/rollback, lead handling, campaign-link, workflow-pause and restore tasks using this guide. Automated browser tests are evidence for software behavior, not a substitute for that human acceptance.
