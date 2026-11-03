# Phase 3 migration review — approval required

**Target only:** `Hostel` (`mvbbxgeqtyotfirnjicm`). The reviewed migration is [20261021074458_phase3_leave_management.sql](migrations/20261021074458_phase3_leave_management.sql). It has not been applied to any Supabase project.

## Prerequisites confirmed

- Remote migration history contains Phase 1 (`20261018093740`) and Phase 2 (`20261018093812`).
- The current project has the Phase 2 `profiles`, `students`, `guardians`, `hostels`, `rooms`, `beds`, and `bed_allocations` schema, trusted admin helper functions, RLS, and the private `student-avatars` bucket.
- No Phase 3 leave tables, notification table, or `leave-documents` bucket currently exist remotely.

## Exact database changes

The migration is additive. It creates:

- `hostel_leave_policies`, with safe default limits of 16 day-out hours and 72 night-out hours.
- `leave_requests`, including a unique request number and idempotency nonce.
- `leave_request_documents`, `leave_request_history`, and in-app `notifications`.
- A private `leave-documents` bucket, limited to PDF/JPEG/PNG/WebP and 5 MB per object.
- Indexes for request queues, student history, status/departure filtering, document lookup, and notifications.
- Database validation triggers: future departure, chronological return, non-empty reason/destination, policy duration, emergency contact, and conflicting active request rejection.
- Trusted, authenticated RPCs: `submit_leave`, `review_leave`, `cancel_leave`, `register_leave_document`, `refresh_leave_overdue`, and `phase3_dashboard`.
- History/notification/timestamp triggers and Realtime publication for requests and in-app notifications.

## Security and data safety checks

- Every new application table has RLS enabled. Anonymous and authenticated roles receive no unrestricted table permissions.
- A student may read only their own requests, history, documents, and notifications. Storage paths are validated as `<student UUID>/<request UUID>/<random UUID>.<extension>` before any UUID casts, preventing malformed paths from bypassing the policy.
- Direct browser inserts and status updates are prohibited. Request creation, decision, cancellation, and document metadata registration use trusted server-side functions that derive the actor from `auth.uid()`.
- Administrative decisions require `private.is_active_admin()`, which uses the trusted Phase 1 profiles role. No role is read from user-editable auth metadata.
- Student submission is idempotent by unique nonce and serialized with a transaction-scoped advisory lock. Reviewer decisions lock the request row before changing it, so a second decision cannot silently overwrite the first.
- The migration does not contain `DROP`, `TRUNCATE`, destructive `DELETE`, or data-rewriting `UPDATE` statements. Existing Phase 1/2 tables and records are not altered.

## Local verification

The complete Phase 1 → Phase 2 → Phase 3 chain runs in the PostgreSQL-compatible PGlite test harness. The test covers student isolation, student inability to approve, administrator-only review, mandatory rejection remarks, idempotent retry, conflict rejection, and request history. `npm run build` succeeds.

## Manual configuration after approval

- Apply the migration to the approved development project only.
- Ensure Realtime is enabled for the `supabase_realtime` publication (the migration adds the two Phase 3 tables).
- External email/SMS delivery is intentionally not configured; only in-app notifications are created.
- Set `APP_ORIGIN` for the existing Phase 2 `student-registration` Edge Function before production invitation redirects.

Approval authorizes only this migration on `mvbbxgeqtyotfirnjicm`.
