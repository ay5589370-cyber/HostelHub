# HostelHub Phase 2 delivery

Deployment update, 18 October 2026: both approved migrations are applied to `Hostel` (`mvbbxgeqtyotfirnjicm`), and the registration Edge Function is deployed. APP_ORIGIN and administrator setup remain required. See [deployment report](supabase/DEPLOYMENT_REPORT.md) for current status; the original implementation-stage notes below are historical where they describe deployment as pending.

Registration follow-up, 27 October 2026: the last recorded Edge Function deployment predates the Phase 5 admission payload fields. An older strict Edge schema may reject the newer fields and display the generic invalid-registration response. This is inferred from local schema/deployment chronology; current hosted code was not verified. Local Edge code now reports invalid field paths without values. Phase 5 and ID reservation migrations must be reconciled with remote history, then the function and required `APP_ORIGIN` must be configured/deployed before expecting this local fix to affect the hosted flow.

Temporary-credential update, 27 October 2026: local registration now generates a cryptographically random one-time password, keeps email as the login name, displays the Hostel ID and credentials to the authorized admin, sends no email, and forces password replacement at first sign-in. This behavior is **local only** and depends on the new `20261027100000_temporary_student_credentials.sql` migration plus a matching Edge deployment. The old hosted function may still send an invitation; do not use registration on a live project until the migration dependencies are reconciled and this function is deployed. Marking Auth email confirmed is an administrative bypass of mailbox verification, so verify the student's address before registration and hand over credentials through a trusted channel.

Implemented directly in the existing React/Vite project. Phase 1 authentication, guards, password reset, theme, layout and profile migration are reused. **Local implementation is ready for database review; live activation is pending approval and configuration.**

## Features and routes

| Route                 | Implementation                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/students/new` | Six-step validated registration, personal/academic/contact/guardian fields, photo preview, cascading hostel-block/floor/room/bed selection, review and confirmation, clear partial-failure handling         |
| `/admin/students`     | Real Supabase directory, search, hostel/room/course/status filters, sorting, server-side 20-row pages, photos and account setup status; interrupted-registration retries and replacement bed selection |
| `/admin/students/:id` | Complete profile, guardian details, administrative edits, archive/restore, temporary-password reset, photo replacement and transactional transfer                                                                  |
| `/admin/rooms`        | Hostel/block creation, rooms with generated beds, capacity increases, maintenance control, live occupancy and links to assigned students for transfers                                                      |
| `/student/dashboard`  | Real profile summary, photo, course/semester, current hostel/room/bed, status and guardian contact                                                                                                          |
| `/student/profile`    | Own full profile, phone/photo edits only                                                                                                                                                                    |
| `/admin/dashboard`    | Real active-student/room/occupied/available counts, recent registrations, per-hostel occupancy and Realtime refresh                                                                                         |
| `/reset-password`     | Password reset and enforced first-login password replacement; existing login uses email                                                                                                       |

## Files

New UI: `src/pages/admin/{StudentRegistration,Students,StudentProfile,Rooms}.jsx`, `src/components/common/{StudentAvatar,AllocationPicker,StudentFields}.jsx`, `src/services/students.js`, `src/lib/studentValidation.js`.

Modified UI: `src/routes/{AppRoutes.jsx,navigation.js}`, `src/pages/student/Dashboard.jsx`, `src/pages/admin/Dashboard.jsx`, `src/services/profiles.js`, `src/components/common/ConfirmDialog.jsx`, `src/components/layout/AppSidebar.jsx`, `src/styles/globals.css`, `src/contexts/AuthContext.jsx`. Background refresh for the same signed-in user now preserves mounted forms; errors still clear the profile and fail closed.

New backend: `supabase/migrations/20261018093812_phase2_student_management.sql`, `supabase/functions/student-registration/{index,handler}.ts`, `supabase/config.toml`. The existing Phase 1 SQL content is unchanged. Deploy both Edge source files together.

Verification: `tests/phase2-database.test.js`, `tests/student-validation.test.js`, `supabase/functions/student-registration/index.test.ts`. `package.json` and `package-lock.json` add the embedded PostgreSQL test runtime and pin Supabase to the already installed 2.118.0. `deno.lock` locks Edge dependencies. `.gitignore` excludes CLI temporary files.

Documentation: this file, `supabase/PHASE2_REVIEW.md`, `supabase/SETUP_PLAN.md`, `supabase/functions/README.md`, README Phase 2 note.

## Database, RLS and storage

See `supabase/PHASE2_REVIEW.md` and the migration for exact objects, grants, triggers and policies. The migration contains no seed students. Test records exist only in a disposable embedded PostgreSQL database.

Client roles cannot directly change allocations, student academic fields, roles or status. Admin RPCs verify the live role server-side. Student ownership policies also check active status. Avatar access is scoped to student UUID folders in the private `student-avatars` bucket; files use random names, MIME/size validation and expiring signed URLs. Replacement updates the saved pointer before best-effort cleanup of the old object.

The registration Edge Function authenticates with `getUser(jwt)`, checks the active admin profile, validates Zod input, claims a leased request, checks duplicates and availability, reserves a database-generated unique student ID, provisions a fixed Auth UUID, commits student/guardian/allocation in one transaction, then returns a random temporary password once to the admin. It does not send email. Existing registration jobs and fixed Auth UUIDs prevent duplicate student/account records on retry. The new first-login flag is cleared only through a signed-in student's `auth.uid()`-scoped database function.

## Verification results

- `npm test`: 15 passed (including the enclosing database test). Executes both migrations on embedded PostgreSQL, then checks real grants/RLS, cross-student denial, guardian/file isolation, role escalation denial, capacity/unique allocation rules, transfer rollback, maintenance, archive/restore, leases, stale tokens, transactional registration, idempotent finalization, acceptance tracking and aggregate dashboard counts.
- Deno Edge tests: 6 passed. Authentication/authorization and workflow error paths use isolated Auth/database transport stubs. No email is sent by these tests.
- `npm run lint`: passed.
- `npm run build`: passed. Only dependency annotation warnings from Zod; no compilation errors.
- Deno type checking passed as part of the Edge tests.
- Live Supabase migrations, live Auth invitations, real password setup/login, real Storage upload/download, actual inbox delivery and authenticated browser QA have **not** been tested. Independent-session concurrency/load testing remains pending; local PostgreSQL tests prove constraints and rollback, not production contention behavior.

## Apply and configure after approval

1. Reinspect the configured project for drift. Apply the existing Phase 1 migration followed by the new Phase 2 migration using MCP. Alternatively use Supabase Dashboard SQL Editor in that order; SQL Editor application does not automatically record CLI migration history. Do not blindly run the scripts again.
2. Provision/verify the first admin using the existing README UUID-scoped procedure. Existing Auth users backfilled by Phase 1 start as students. Never infer admin from user metadata or the email address alone.
3. In Supabase Auth settings, enable Email auth, disable public signups if accounts are admin-provisioned, configure Site URL and allow the exact `<APP_ORIGIN>/reset-password` redirect. Use `http://localhost:5173` only for the intended local development origin; production must use its actual HTTPS origin.
4. Configure a verified SMTP sender and provider. Default Supabase email restrictions may prevent invitations to arbitrary students. Do not paste credentials into chat or Vite variables.
5. Add Edge secret `APP_ORIGIN` with the exact browser origin (no trailing slash). Hosted Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; keep them server-only. Deploy `student-registration` after the migrations. `verify_jwt=true` is retained in config and the function also validates the user and role itself. Use the Supabase Dashboard deploy UI or inspect the current CLI command help before deploying.
6. Check the Data API exposes `public`; grants are explicit in the migration. Realtime publication entries are included. Run Supabase Security/Performance Advisors after application.
7. Create real hostel blocks and rooms. Register a consented test student, verify the email inbox, follow the invitation, set a password and sign in. Repeat own/other-user access checks using actual JWTs and test photo replacement.
8. Run two simultaneous allocation requests against one bed in a test environment: exactly one should commit. Verify the losing transaction retains its old assignment. Exercise SMTP failure/resend and expired invitation recovery.
9. Deploy the Vite build with SPA history fallback so invitation and profile URLs work on direct navigation.

## Limits and decisions

- Room capacity can grow; it cannot shrink below generated bed count. No room or student deletion interface is provided. This protects occupancy and allocation history; retiring beds is a future workflow.
- Student account email and institutional ID are fixed after registration in the edit UI. Other personal, academic and guardian fields are admin-editable. An email/identifier correction workflow would need coordinated Auth/database validation.
- A hostel row represents a hostel/block pair, rather than introducing an extra blocks table. Occupancy percentages use all configured beds; available counts exclude maintenance/inactive inventory.
- Confirmed invitation status means the email link was accepted, not proof the user finished choosing a password. The existing password reset flow can recover access.
- Registration retains a reserved Auth account on interruption and retries it; abandoned requests require administrator reconciliation, not automatic deletion. Unknown existing email accounts are never adopted into a new registration.
- Mail submission has at-least-once retry semantics. If a response is lost after sending, a retry may send another invite after the cooldown; it does not create duplicate accounts or allocations.
- Private avatar URLs can remain usable until their five-minute expiry. Old-photo cleanup is best-effort; an object lifecycle/cleanup job can be added later.
- Inventory is fetched in pages to avoid Supabase's default row cap. Very large campuses should add paginated room/bed selection and debounced directory search. Pending-registration attention shows the latest 20 jobs.
- No broad warden permissions, multi-campus authorization, financial flows or fake records were introduced.

## Phase 3 readiness checklist

- [ ] Approve/apply both migrations to the configured project.
- [ ] Provision and verify the administrator role.
- [ ] Deploy the Edge Function and set the exact origin/redirect settings.
- [ ] Configure SMTP and verify invitation delivery plus student login end-to-end.
- [ ] Verify live RLS, Storage access, Realtime and simultaneous allocations with separate JWTs.
- [ ] Run post-migration advisors and resolve any findings.
- [ ] Populate real hostels, blocks and rooms.
- [ ] Define Phase 3 mess-management tables, ownership and policies in a new reviewed migration; reuse students and allocations rather than duplicating them.

## Current API references checked

[Supabase changelog](https://supabase.com/changelog), [inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [Auth invite implementation](https://github.com/supabase/auth/blob/master/internal/api/invite.go), [private Storage downloads](https://supabase.com/docs/guides/storage/serving/downloads), [Edge Function configuration](https://supabase.com/docs/guides/functions/function-configuration), [Edge authentication errors](https://supabase.com/docs/guides/functions/error-codes). The markdown changelog endpoint could not be fetched; the HTML changelog was checked instead.
