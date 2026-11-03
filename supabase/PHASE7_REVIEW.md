# Phase 7 complaints and maintenance review

Reviewed 1 November 2026 for Supabase project `mvbbxgeqtyotfirnjicm` (Hostel). No production database changes have been applied for Phase 7.

## Current local discovery

- Phase 2 provides `profiles`, `students`, `student_registrations`, `hostels`, `rooms`, `beds`, and `bed_allocations`. Complaints derive the signed-in student from `auth.uid()` and snapshot their active allocation server-side; browser-submitted student/room identifiers are ignored.
- Phase 1's trusted profile roles include `admin`, `student`, and `warden`. Staff access requires an active admin or warden profile, never Auth metadata. Phase 4's `security` role is not required.
- Phase 3 has a private leave-document bucket and in-app notifications, but this migration does not depend on either because they may be pending remotely. A separate private complaints bucket and complaint-scoped notifications are created.
- There was no complaint, maintenance, or complaint attachment schema in the local migrations before Phase 7.
- The connected project was queried directly. Phase 7 is not in the live migration history. `public.complaints`, `public.complaint_submit(jsonb,uuid)`, `public.complaint_staff_list(...)`, `public.complaint_staff_detail(uuid)`, and `public.complaint_add_message(...)` are absent. Supabase API logs show 404 responses for `/rest/v1/complaints` and `/rest/v1/complaint_notifications`, which explains why the complaint UI cannot load or submit against production.
- These checks confirm the exact local Phase 7 migration is the missing backend prerequisite. Re-read the project's history and schema immediately before a live apply; do not apply unrelated pending migrations.

## Exact local proposal

Migration file: [`20261025120000_phase7_complaints.sql`](migrations/20261025120000_phase7_complaints.sql).

The migration is transactional and additive. Its only schema dependencies are Phase 1 `profiles`, `private.is_active_admin()` and Phase 2 `students`, `student_registrations`, `rooms`, `hostels`, `beds`, and `bed_allocations`, plus Supabase's existing `storage` schema and `supabase_realtime` publication infrastructure. It does not depend on Phase 3, Phase 4, Phase 5, the student-ID migration, or Phase 6.

It creates:

- `complaints`, with generated `CMP-00000001` numbers, unique per-student submission nonce, fixed category/status checks, server-derived student and room snapshot, priority, resolution, and staff assignment.
- `complaint_messages`, with distinct student-visible replies and staff-only internal notes; `complaint_events` for status, assignment, priority, submission, resolution, message, and maintenance audit history.
- `complaint_attachments`, metadata registration, and private bucket `complaint-attachments`, limited to JPEG/PNG/WebP and 5 MB per file. Storage paths are `<complaint UUID>/<random UUID>.<extension>`. Metadata registration is one transaction for a batch; failed registrations can clean up only unregistered private objects.
- `complaint_maintenance_tasks`, with one task per complaint, optional assigned admin/warden, schedule, work notes, and optional estimated/actual costs. A currency code is required with a cost; costs never affect student fees.
- `complaint_notifications` for student-visible status, assignment, and staff reply notices.
- Narrow security-definer RPCs for student submission, messages, attachment metadata, staff queue/detail, assignment, transitions, directory, and maintenance workflow.

All new tables have RLS. Students can read their complaint rows, public messages/events, own attachment metadata, and own notices. Column grants prevent students from reading internal staff IDs from complaint rows/events. Staff queue/detail data is returned through active-admin/warden guarded RPCs, because Phase 2 intentionally does not grant wardens broad access to student records. Status/assignment/maintenance writes are only available through guarded RPCs. Complaints are not deleted. Duplicate submissions are idempotent; maintenance has a unique complaint key. Resolved complaints may be closed; closed complaints cannot be reopened or receive further student messages because no reopen policy currently exists.

## Safety and verification

- Local PGlite tests apply Phase 1, Phase 2 and this migration only; they verify ownership, role authorization, internal-note privacy, attachment storage isolation, status transitions, history, notices, and maintenance idempotency. The full local project suite currently passes 94/94 tests; lint and production build also pass.
- This local test does not verify hosted Supabase settings, actual storage signing, live Realtime delivery, SMTP, or production behavior.
- Before any live apply, re-read the exact project's migration history and schema, compare all pending migrations and object dependencies, then review this full SQL file. Do not run `db reset`, `migration repair`, or an unreviewed `db push`.
- No live apply has run. Under the user's production-change safety rule, explicit approval is required for this exact migration before touching the project.
