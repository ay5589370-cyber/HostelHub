# Phase 11 — Visitor Management Review

Status: local migration and frontend only. No live database or security policy was changed.

## Migration

`20261025160000_phase11_visitor_management.sql` adds visitor-specific visit records and append-only event history. It reuses the existing `students`, `profiles`, `auth.uid()`, and Phase 4 `private.is_active_security()` authorization helper. It does not alter gate passes, gate events, student presence, leave requests, or the student schema.

Required migration dependencies:

- Phase 1 profiles and `private.set_updated_at()`.
- Phase 2 students and profile relationships.
- Phase 3 `private.current_student_id()`.
- Phase 4 gate authorization helper and the existing gate schema.

The migration aborts if the required objects are absent. Review/reconcile remote migration history first; do not assume Phase 3–4 are applied. A local CLI migration listing was blocked before querying the remote project by the CLI telemetry filesystem restriction. The intended project is `mvbbxgeqtyotfirnjicm`; no other project was queried or changed.

## Permission model

- Security and active admins may search only active students by name or registration ID and see the minimum host identity needed for gate operations.
- Security and admins register visitors, verify an ID in person, and check visitors in/out. Actual entry/exit timestamps and verifying staff IDs are always written by server-side RPCs using `now()`.
- Admins and wardens approve or reject visits and mark overdue visits reviewed. All actions append an audit event.
- Students can list only their own visit records and student-visible status history. Visitor contact number, staff names, and staff-only rejection notes are omitted from their responses.
- RLS is enabled on both new tables. Authenticated clients have no direct table privileges; reads and mutations go through fixed-search-path, authorization-checked RPCs. The service role retains server-side table access.
- No government ID number/image is stored. Only a boolean verification state, timestamp, and staff actor are kept.
- Active arrivals cannot be checked in twice or checked out unless their record is in `checked_in`. Each transition locks the visit row.

## Policy and delivery limits

No visitor policy table or advance-request workflow exists. The new desk flow conservatively makes every registered visit pending admin/warden approval before security can check it in. This policy should be confirmed before live use. Contact number is optional because no local policy determines when it is required. Student-initiated visitor requests are not enabled.

No QR visitor pass was added. The existing student gate-pass QR is tied to leave requests and should not be reused as a visitor credential. No email/SMS/in-app visitor alert is sent: the available provider/verification path is insufficient for sensitive visitor events. Students can see their own visit status in the portal.

CSV export is available to admins/wardens for the current filtered page only. It excludes visitor contact numbers and government ID artifacts, and uses the existing CSV escaping/formula-injection protections.

## Verification

The Phase 4 PostgreSQL-compatible test suite applies the Phase 11 migration after Phases 1–5 and exercises role checks, limited student search, pending approval, security-vs-manager permissions, identity verification, server-side timestamps, duplicate check-in/out rejection, and student ownership/privacy. Run `npm test`, `npm run lint`, and `npm run build` after final edits. These local tests do not prove remote migration status or live RLS behavior.
