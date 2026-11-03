# Supabase expansion — proposed, not applied

**Deployment update — 18 October 2026:** the user approved both reviewed migrations for `mvbbxgeqtyotfirnjicm`; both were applied and verified, and `student-registration` was deployed. See [DEPLOYMENT_REPORT.md](DEPLOYMENT_REPORT.md). Earlier pending-approval statements below are retained as historical context.

## Phase 2 inspection update — 18 October 2026

The current application configuration points to `mvbbxgeqtyotfirnjicm` (project name `Hostel`). Read-only MCP inspection found no public tables, migrations, private/public functions, storage buckets or Edge Functions. The older project-creation proposal below is historical and does not describe the current configured project. No project was created or changed during Phase 2 implementation.

The existing Phase 1 migration remains unchanged. Phase 2 adds `migrations/20261018093812_phase2_student_management.sql`. The statement that neither migration had been applied is historical and was superseded by the deployment report. Review `PHASE2_REVIEW.md` for the concrete database approval record and `../PHASE2_DELIVERY.md` for implementation, verification and deployment instructions.

## Historical proposal (retained for context)

Status: Supabase MCP is connected and authenticated and supports project creation. The user requires a NEW project named `hostelhub`. Existing project `bwyobyctblekffzeylan` is explicitly excluded: do not use, resume, inspect further, modify, or delete it.

Creation proposal awaiting user confirmation: organization `ginaro_store` (`cjinzfxuqvqiztkflpet`), verified plan `free`, requested region Mumbai (`ap-south-1`, supported by the creation tool), quoted project cost 0 per month. Region capacity and creation quota are not yet verified by a creation attempt. Do not switch region, upgrade the plan, or alter the old project if creation is refused. No new project has been created and no remote changes have been made. Database migrations require separate user approval after creation and inspection.

This plan is preliminary. Inspect the authorized development project before preparing the exact SQL diff. Obtain user approval for that concrete migration plan before applying major database changes. Do not overwrite existing objects or delete data without explicit approval.

## 1. Read-only discovery

- Verify project reference, organization, development environment and permissions.
- Inventory schemas, tables, columns, indexes, foreign keys, functions, triggers, grants, RLS policies, migration history, storage buckets/policies, Edge Functions and enabled extensions.
- Compare the existing local profiles migration to live state. Do not rerun it blindly or rewrite an applied migration.
- Inspect metadata and aggregate counts where needed; avoid downloading private student records.
- Surface collisions and required policy changes explicitly in the approval plan.

## 2. Proposed schema additions

Preserve the single-campus model unless inspection or user requirements establish otherwise.

| Area | Proposed objects and invariants |
| --- | --- |
| Profiles and roles | Preserve profiles, fixed role validation, active-account checks, and immutable client role/status fields. Trusted role changes only; do not infer roles from user metadata. |
| Hostel scope | Hostels and explicit warden-to-hostel assignments for scoped operational access. |
| Students | Student records linked one-to-one to profiles; institution identifiers unique; sensitive guardian/contact fields isolated from gate verification responses. |
| Rooms and beds | Rooms belong to hostels; beds belong to rooms; unique room/bed identifiers within their parent. |
| Allocations | Referential integrity and database-enforced prevention of overlapping active allocations for both student and bed; transactional allocation/release operations. |
| Leave requests | Student owner, day/night type, valid time ranges, controlled status transitions, reviewer and review timestamps. Approval fields cannot be supplied by students. |
| Gate movements | Append-only entry/exit events linked to students and authorized passes; server timestamps, actor IDs and idempotency keys; serialize transitions to prevent duplicate exits/entries. |
| Notifications | Recipient-scoped read access; recipient can mark read only. Trusted creation and separate delivery/outbox records for retries. |
| Audit logs | Server-generated actor/action/target/timestamp records; no browser insert/update/delete; restricted admin reads and no credential/request-body dumps. |

## 3. RLS and grants

- Anonymous users: no application-table access.
- Students: own permitted profile/student fields, own allocation, own requests, own movement history and own notifications. No authority over allocation, approvals or recorded gate events.
- Wardens: only assigned-hostel operational data and minimal student identity needed for gate work. No access to role management, guardian contacts, general audits or unrelated hostels. Admins approve leave by default.
- Admins: campus administration access; sensitive state transitions through validated operations, not unrestricted client writes.
- Use private authorization helpers with pinned search paths to avoid recursive policies. Enforce ownership, active status and field-level permissions at the database layer.
- Audit mutations and maintain business invariants in the same database transaction. Future Edge Functions must not bypass these checks merely because they hold a service key.

## 4. Private storage

Proposed buckets: `student-avatars`, `leave-documents`, `complaint-images`.

- All private, with MIME-type and size limits, generated object names and ownership-scoped paths.
- Leave document access tied to the actual request owner and authorized reviewers, not merely a caller-chosen directory.
- Wardens receive minimal gate verification data, not leave attachments by default.
- Complaint images remain deny-by-default until a complaint ownership model is approved and implemented; no broad authenticated-user policy as a shortcut.
- Use authorized downloads or short-lived signed URLs; do not save public URLs for private objects.
- If a bucket already exists, inspect and present any configuration/policy differences before changing it.

## 5. Trusted operations and Edge Functions

Prepare only operations supported by the final schema: student invitations, admin-controlled role/active-status changes, and a notification delivery worker. Use transactional database operations for allocations, leave decisions and gate recording; expose Edge Function wrappers only where external services or secret-bearing operations require them.

Validate caller identity, active role and scope server-side. Use input validation, allowed origins, rate limits, idempotency and structured errors. Store service credentials exclusively in server secrets. Do not create a public first-admin endpoint.

First administrator: verified Auth user created/invited through trusted project administration, then promoted by an explicit UUID-scoped SQL operation. A reusable provisioning mechanism must refuse ambiguous targets and never accept public signup requests.

## 6. Verification and handoff

- Review exact migration files, affected objects, data effects and rollback/recovery considerations with the user before application.
- Apply approved migrations only to the confirmed development project.
- Test anonymous, admin, student, warden and inactive identities, including cross-student and cross-hostel denial, role escalation attempts, attachment isolation, concurrent allocation/gate events and audit immutability.
- Run function checks and application lint, tests and build. Report any checks requiring credentials that could not run.

Manual inputs/settings likely remaining: development project authorization; email/password provider and disabled public signup; exact Site URL and recovery/invitation redirect allowlist; SMTP provider credentials and verified sender domain; SMS provider selection, server-side credentials, sender/template setup and test destination; verified first-admin identity and invitation/password completion. Do not paste secrets into chat or frontend environment variables. The final checklist must reflect what was actually accessible and configured.
