# HostelHub final readiness report

Prepared 25 October 2026 for the local repository at `D:\Hostel` and intended Supabase project `mvbbxgeqtyotfirnjicm`.

## Readiness decision

**Not production-ready or remotely verified.** Phase 9–11 changes in this repository are local. No live database, Auth setting, secret, function, role, storage policy, or production record was changed in these phases.

## Implemented locally

- Admin dashboard combines Phase 2 student/room/bed counts with optional leave, fee, complaint/maintenance, and mess metrics. Cards link to their management pages. Module data is shown as unavailable when the migration/RPC or permitted access is missing; gate presence is not displayed as zero.
- Metric definitions: active students are `students.status = 'active'`; active allocations are the Phase 2 `bed_allocations.status = 'active'` count; available beds are marked available in available rooms and active hostels without an active allocation; unallocated students are active students minus active allocations. The Phase 2 constraints allow at most one active allocation per student and bed. Total rooms/beds include all records. Pending/partial/overdue invoice counts use `fee_invoice_balances.payment_status`. Open complaints exclude resolved and closed statuses. Maintenance counts include open, scheduled, and in-progress tasks. Upcoming visits are scheduled in the next seven days. Mess rating uses the existing default seven-day admin summary.
- Student dashboard adds recent/current leave requests, RLS-scoped fee balances, complaint statuses, published/cancelled menus, the student's recent feedback, and unread in-app notices. Profile and room/bed details continue to come from the student's own profile query.
- `/admin/reports` provides student/admission, occupancy/current allocation, leave history, invoice/balance, payment, complaint/resolution, mess feedback, available operational audit, and gate-access status views. Filters are applied to the data used by display and CSV export. Student directory exports omit email, phone, and guardian fields; payment exports omit reference numbers.
- CSV export includes export time and selected filters; quotes, commas, line breaks, and formula-leading cell values are escaped. Exports stop when a result reaches 20,000 rows and label the result incomplete. The operational audit view is intentionally limited to recent records. No PDF export is implemented.
- Added `admin_operations_metrics(p_from,p_to)`, a fixed-search-path, security-definer, active-admin-guarded aggregate for complaint first staff reply time, resolution duration, open maintenance tasks, and upcoming visits. Date filters apply to complaint response/resolution metrics and task creation counts. It returns aggregate values only. It is covered by a local migration test and is not deployed.
- Complaint response time counts the first student-visible staff reply. Resolution duration uses `resolved_at - created_at`; this is not a substitute for first response time. Gate events remain unavailable to admins because existing Phase 4 RLS permits security staff and the student owner, not admins. Audit records remain split across domain tables; no complete unified audit log exists. No planned-admission calendar is present.

## Modules and deployment status

| Module                                               | Local state                                                                     | Remote state known for this report                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 profiles/Auth roles                          | Migration and auth guards present                                               | Historical deployment report records version `20261018093740` applied; not rechecked now                                                                      |
| Phase 2 student admission, IDs, rooms and allocation | Frontend, Edge Function source, and migrations present                          | Historical report records Phase 2 version `20261018093812` applied. The user's earlier query also showed only Phase 1/2 history; current CLI check is blocked |
| Phase 3 leave                                        | UI, policies, storage, notifications and tests present                          | Not currently verified; earlier user-provided schema query reported Phase 3 tables missing                                                                    |
| Phase 4 gate                                         | UI, gate RPCs, and tests present                                                | Not currently verified; gate RLS is security-role scoped                                                                                                      |
| Phase 5 admission fields and student ID reservation  | Local migrations present                                                        | Not currently verified                                                                                                                                        |
| Phase 6 fees/payments                                | UI, ledger, verification workflow and tests present                             | Not currently verified                                                                                                                                        |
| Phase 7 complaints/maintenance                       | UI, private attachments, staff RPCs and tests present                           | Not currently verified                                                                                                                                        |
| Phase 8 mess                                         | Admin/student pages, feedback, notices, complaint integration and tests present | Not currently verified                                                                                                                                        |
| Phase 9 reporting metrics                            | Dashboard/report integration and a new guarded migration are local              | Not applied; depends on Phase 1 and Phase 7 schema. The app reports it unavailable until deployed                                                             |
| Phase 10 notifications and announcements             | Merged in-app inbox, admin announcement workflow, and guarded migration local   | Not applied or verified; parent email/SMS remains disabled until verification, consent, and provider workflows exist                                           |
| Phase 11 visitors                                     | Visitor desk, student history, staff review, audited RPC migration local       | Not verified; CLI migration inspection blocked. Depends on Phase 3/4 gate schema and Phase 11 migration                                                       |

The repository contains one Edge Function, `student-registration`, with JWT verification enabled in local configuration. A dated historical deployment report says it was deployed active to this project, but that report also found `APP_ORIGIN` missing. Current deployment state could not be queried. No other Edge Functions are present locally.

## Security and data checks

- Frontend calls use the publishable/anon Supabase client; no service-role key is added to frontend code.
- Admin routes remain behind the existing admin `RoleGuard`. The new aggregate RPC checks the active database admin profile itself; it does not trust browser metadata.
- Reports query through the signed-in Supabase client and existing RLS or guarded RPCs. No policy is bypassed to read gate data or internal complaint notes.
- Student data queries rely on existing RLS ownership checks. The student portal does not accept a student ID to select another person's records.
- Local PostgreSQL-compatible migration tests verify role isolation across existing modules and deny a student call to the new admin aggregate RPC. CSV tests cover formula injection and CSV quoting.
- A prior user-provided query reported the intended first admin profile as active with role `admin`; that remote row was not independently re-read during this turn.

## Authentication, SMTP, and invitations

Remote Auth redirect allowlists, signup settings, password policy, SMTP sender, invitation template, and the current `APP_ORIGIN` secret were not inspectable without Supabase CLI authentication. The historical deployment report says `APP_ORIGIN` was absent and SMTP/invitation delivery remained to be configured. Keep the Invite User template's secure `{{ .ConfirmationURL }}` link and verify actual inbox delivery before relying on invitations. Do not paste credentials or app passwords into chat or Vite variables.

## Migrations and exact next steps

Local migrations are present for Phases 1–10. The Phase 9 migration is [`supabase/migrations/20261025140000_phase9_operations_reporting.sql`](supabase/migrations/20261025140000_phase9_operations_reporting.sql); it adds a guarded aggregate RPC and requires Phase 1 admin authorization and Phase 7 complaint/message/maintenance tables. The Phase 10 migration is documented in the addendum below and depends on Phase 1 and Phase 2.

Safely prepare deployment:

1. Authenticate the CLI locally with `npx supabase login`; do not share the token. Re-run `npx supabase migration list --project-ref mvbbxgeqtyotfirnjicm` and inspect the remote catalogs for the expected Phase 1–11 objects.
2. Compare every remote migration version and object with local files. Historical records show only Phase 1 and 2 applied; if that remains true, prepare and review the complete dependency-ordered Phase 3–10 plan. Do not run `db reset`, `migration repair`, or a blind `db push`. Present the exact SQL and receive approval before any live migration.
3. Review the Phase 9 RPC SQL and its tested authorization guard. Apply it only after Phase 1 and Phase 7 are verified remotely and after explicit approval. The other optional reports need their respective existing migrations before the app can use those module metrics.
4. Recheck the first administrator profile and active admin authorization using the trusted Dashboard/SQL Editor. Do not repeat a role update unless it is required and explicitly approved.
5. After approval for configuration changes, set the Edge Function `APP_ORIGIN` to the actual HTTPS frontend origin, add exactly `<APP_ORIGIN>/reset-password` to Auth redirect URLs, verify SMTP and the secure invitation template, then test a student invite and password setup in a non-production workflow.
6. Deploy the frontend with HTTPS and SPA history fallback. Sign in as admin and student, verify dashboard metrics against database counts, test student data isolation, report filters/CSV output, payment verification records, leave/gate policies, complaint details, and published mess menus. Recheck RLS and function status against the intended project before launch.

The current read-only `npx supabase migration list --project-ref mvbbxgeqtyotfirnjicm` attempt was blocked before it could query the project: the CLI tried to write telemetry outside the workspace and the filesystem sandbox denied that write. A prior CLI attempt in this task history returned `AccessTokenRequiredError`. No migration or project mutation was attempted, and no unrelated Supabase project was accessed.

## Verification run

- `npm test`: **64 passed, 0 failed** in the Phase 11 verification run below.
- `npm run lint`: **passed**.
- `npm run build`: **passed**. Vite reports existing Zod package pure-annotation placement warnings and removes those annotations; output completed successfully.
- Read-only Supabase migration listing: **blocked** by CLI telemetry filesystem access; a prior attempt reported missing CLI authentication. Live schema, migration history, RLS behavior, Edge Function version, Auth configuration, and email delivery remain unverified.

## Unresolved limitations

- Phase 3–11 remote migration/deployment status and production behavior require authenticated reinspection.
- Gate presence/event metrics are deliberately unavailable to admin under existing RLS; no security policy was broadened.
- Phase 9 maintenance and response-time aggregates require the new pending Phase 9 migration.
- First staff reply time is based on student-visible staff messages, not assignment/status events. No unified cross-module audit log exists.
- Report record loading is capped at 20,000 rows; the operational audit view shows only its most recent bounded records.
- `APP_ORIGIN`, SMTP, invitation template, and actual student password setup have not been verified in the live project.
- Historical Edge Function deployment status, active admin status, and live policies need current confirmation before launch.

## Phase 10 addendum — Notifications and parent communication

The local notification center reads existing `public.notifications` (Phase 3), `public.complaint_notifications` (Phase 7), and `public.mess_notifications` (Phase 8) plus the Phase 10 `public.announcement_notifications` table. Each query uses the user's normal authenticated Supabase client, so existing recipient-based RLS rules remain the access boundary. `/admin/notifications` and `/student/notifications` show a merged, newest-first feed, exact unread counts, per-item read actions, mark-all-as-read, and older-page navigation. The header bell displays a count and recent updates. Related links route to the relevant module. Missing notification tables are reported as unavailable.

Phase 10 adds an active-admin-guarded in-app announcement workflow. Admins can save and edit drafts, preview, publish once, and archive. Publishing atomically creates a unique notification row for each active student account; the database unique constraint and draft-only publication state make retries safe. The history RPC shows recipient and read counts without exposing recipient contact details. These announcements do not send email or SMS.

The admin page shows parent communication readiness only. Phase 2/5 guardian rows contain phone/email fields but no contact-verification status or consent/preferences. The repository contains no general email/SMS provider sender or retry-safe delivery log. Student registration invitations use Supabase Auth invitation flow and do not establish a general parent-alert service. Consequently, the app sends no guardian messages, exposes no retry/send action, and records no fabricated delivery. Enabling parent communication needs a reviewed schema/verification-consent workflow, an approved server-side provider and secrets configured outside the frontend, idempotent delivery records, and then live configuration and deployment approval.

Provider setup prerequisites: choose an institution-approved email/SMS provider and create its account; obtain provider API credentials and an approved sender identity; complete the provider's sender/brand/number registration required for the target country; configure secrets only as Supabase Edge Function secrets; implement a server-side sender that accepts only allowlisted event types and verified/consented guardians; persist an idempotency key and delivery result; then test with non-production recipients before enabling the workflow. Do not paste credentials into the repository or frontend. Supabase Auth SMTP (if configured) is for Auth emails such as student invitations and is not by itself a general parent-message API. Current remote SMTP configuration was not inspectable, and no SMS provider/account was selected or configured.

The new local migration is [`supabase/migrations/20261025150000_phase10_notifications.sql`](supabase/migrations/20261025150000_phase10_notifications.sql). It depends on Phase 1 admin authorization and Phase 2 student profiles. The merged notification center additionally depends on the corresponding Phase 3, Phase 7, and Phase 8 migrations and their existing RLS policies. Administrators see only their own alerts in the inbox; the Phase 10 announcement history provides aggregate in-app recipient/read counts. Per-recipient cross-module delivery logs and external send/retry support are not implemented.

The project state remains local-only. Remote migration state, SMTP/provider configuration, parent consent/verification, and external delivery were not changed or verified in this phase. The CLI inspection attempt could not complete because the CLI was blocked while trying to write its telemetry file outside the workspace; a prior project-specific read-only inspection was also blocked by unavailable CLI authentication. No remote project was modified.

### Phase 10 verification

- `npm test`: **63 passed, 0 failed**, including notification recipient isolation, active-admin announcement authorization, single-publish behavior, and student-only announcement visibility/read-state checks.
- `npm run lint`: **passed**.
- `npm run build`: **passed**. Vite continues to print the existing Zod dependency pure-annotation warnings; output is generated successfully.
- Manual live inbox/provider/auth checks remain blocked until the correct project access is available and Phase 3/7/8 deployment is independently verified.

## Phase 11 addendum — Visitor management

Local routes now include `/security/visitors`, `/admin/visitors`, `/warden/visitors`, and `/student/visitors`. Security/admin can search active students using a narrow RPC that returns only name and registration ID, register a visit, attest that identity was visually checked without collecting ID numbers/images, and record server-timestamped check-in/out. Admin/warden approve or reject pending visits and mark overdue visits reviewed. Admin/warden can filter by student/visitor search, date, approval, and status, and export the current filtered page to CSV. Exports omit visitor phone numbers and government ID artifacts. Students see only visits tied to their own authenticated student profile; visitor contact details and staff-only rejection notes are omitted from student responses.

The local migration is [`supabase/migrations/20261025160000_phase11_visitor_management.sql`](supabase/migrations/20261025160000_phase11_visitor_management.sql), with review notes in [`supabase/PHASE11_REVIEW.md`](supabase/PHASE11_REVIEW.md). It adds `visitor_visits` and `visitor_events` only; existing gate passes, gate events, student presence, leave requests, and student records are reused unchanged. Both new tables have RLS enabled and no direct authenticated table grants; fixed-search-path RPCs enforce active roles, row locking, state transitions, and server timestamps. Visitor audit rows are appended by those RPCs.

No visitor policy configuration exists locally. The flow therefore requires manager approval for each visit; contact number remains optional. Student advance requests are unavailable. No QR pass was added because the existing QR credential is designed for approved student leave and is not a visitor credential. No visitor email/SMS/in-app alert is sent; configured providers and verified recipient/consent flows are not available. Overdue status is derived from checked-in visits whose scheduled exit time has passed; managers can acknowledge review. There is no background scheduler or external alert for overdue visits.

The migration depends on Phase 1 profiles, Phase 2 students, Phase 3 `private.current_student_id()`, and Phase 4 `private.is_active_security()`/gate schema. The migration aborts if its prerequisites are missing. The Phase 11 CLI migration listing could not be repeated: the local CLI was blocked by an out-of-workspace telemetry write before it could query Supabase. Historical deployment notes and earlier user-provided SQL are not a current remote verification. No Edge Function, live migration, policy, or data was changed.

### Phase 11 verification

- Local Phase 4 database suite now executes the Phase 11 migration and checks unauthorized registration/decision, limited student search, approval roles, identity verification before check-in, server-generated arrival/departure times, duplicate transition rejection, student ownership, and contact privacy.
- `npm test`: **64 passed, 0 failed**; this includes the Phase 11 visitor authorization/privacy/timestamp workflow suite.
- `npm run lint`: **passed**.
- `npm run build`: **passed**. Vite reports the existing Zod pure-annotation warnings; bundle generation succeeds.
- Remote migration status, the selected project's live gate schema/RLS, and authenticated UI operation remain unverified because CLI access is blocked. Apply the reviewed migration only after reconciling the remote migration history and obtaining approval.
