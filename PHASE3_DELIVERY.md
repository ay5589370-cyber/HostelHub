# HostelHub Phase 3 Delivery: Day-Out / Night-Out Leave Management

**Deployment Status:** Local implementation and test verification complete. **Live database migration to `mvbbxgeqtyotfirnjicm` is pending explicit approval.**

---

## 1. Features Implemented

### Student Leave Workflow
- **Apply for Leave**:
  - Choice between **Day-Out** (up to 16h) and **Night-Out** (up to 72h) with smart return-time presets.
  - Departure and return date/time pickers with real-time timezone handling and inline error feedback.
  - Destination, emergency contact, and detailed reason inputs.
  - Optional supporting document attachments (PDF, JPEG, PNG, WebP up to 3 files, max 5 MB each).
  - Explicit hostel leave rules confirmation checkbox.
  - **Pre-submission Review Dialog**: Modal preview of all inputs allowing verification before invoking the server-side RPC.
- **My Leave Requests & History**:
  - Request cards displaying request number (`LVR-YYYY-XXXXXX`), leave type, departure/return schedule, destination, submission timestamp, current status pill, and admin remarks.
  - Filterable by status (`pending`, `approved`, `rejected`, `cancelled`, `completed`, `overdue`) and leave type (`day_out`, `night_out`).
  - Searchable by destination, request number, or reason.
  - **Detailed Request Drawer**: Displays full request attributes, student contact, attached documents with secure signed URLs, and complete **Status History & Audit Trail**.
  - **Cancellation Action**: Available strictly on `pending` requests with confirmation prompt and audit logging.

### Administrative Leave Management
- **Metrics Overview Bar**: Live summary cards for **Pending**, **Approved**, **Rejected**, **Upcoming departures**, and **Overdue** requests with one-click quick filtering.
- **Filterable & Searchable Directory Table**: Search by student name/ID, filter by status and leave type, sort by submission date or upcoming departure date, with 20-row pagination.
- **Comprehensive Review Drawer**:
  - Student identity: full name, student ID, course, semester.
  - Bed & Room allocation context: hostel name, block, room number, bed number.
  - Leave details: type, scheduled departure and expected return times, destination, reason, emergency contact, and submission date.
  - Supporting documents list with expiring signed URL access (60-second validity).
  - Full **Status History Audit Trail**: Chronological event timeline showing previous status, new status, reviewer remarks, actor identity, and timestamps.
- **Review Decision Modal**:
  - Decision options: Approve, Reject, and Revoke approval.
  - Inline administrative remarks input directly inside the confirmation dialog portal (never trapped behind modal backdrops).
  - Mandatory rejection reason enforcement (minimum 3 characters).
  - Concurrency collision protection: row-level locking (`FOR UPDATE`) with automatic refresh if an item was already modified.

---

## 2. Routes Added & Integrated

| Route | Role | Component | Description |
|---|---|---|---|
| `/student/leave` | Student | `StudentLeave` | Apply for Day-Out / Night-Out with pre-submission confirmation and view recent 5 requests |
| `/student/leave/history` | Student | `StudentLeave history` | Searchable & filterable view of all past student leave requests with details and audit trail |
| `/admin/leave-requests` | Admin | `LeaveRequests` | Administrative leave queue, metrics cards, filters, review drawer, and approval/rejection actions |

---

## 3. Database Schema & Migration Files

**Migration file**: `supabase/migrations/20261021074458_phase3_leave_management.sql`

### Tables Created
1. `public.hostel_leave_policies`: Per-hostel limits (`max_day_out_hours` default 16, `max_night_out_hours` default 72, `emergency_contact_required` default true, `max_documents` default 3).
2. `public.leave_requests`: Core table with UUID primary key, sequential unique request number (`LVR-YYYY-XXXXXX`), idempotency nonce, student foreign key, departure/return timestamps, destination (2-250 chars), reason (5-2000 chars), emergency contact, status check (`pending`, `approved`, `rejected`, `cancelled`, `completed`, `overdue`), admin remarks, reviewer FK, and review timestamp.
3. `public.leave_request_documents`: Metadata for files uploaded to `leave-documents` private bucket (`object_path`, `original_name`, `content_type`, `byte_size`).
4. `public.leave_request_history`: Audit trail tracking every status change, previous/new status, actor UUID, timestamp, and review remarks.
5. `public.notifications`: In-app notification queue for students (decisions) and administrators (new submissions).

### Security Functions & RPCs
- `private.current_student_id()`: Derives active student record UUID from `auth.uid()`.
- `private.validate_leave_request()`: Trigger enforcing future departure, chronological return, hostel duration policy, emergency contact format, and overlapping active request conflict rejection.
- `private.submit_leave(p_data)`: Atomic submission with student advisory lock, idempotency nonce, auto-generated sequence number, returning `{ id, request_number, student_id, duplicate }`.
- `private.review_leave(p_request_id, p_status, p_remarks)`: Row-locked (`FOR UPDATE`) decision function requiring active admin role, mandatory rejection remarks (>=3 chars), preventing stale/concurrent overwrites.
- `private.cancel_leave(p_request_id)`: Row-locked student cancellation, restricted to own pending requests.
- `private.register_leave_document(p_request_id, p_path, p_original_name, p_content_type, p_byte_size)`: Validates path format, attachment limits, and links metadata.
- `public.phase3_dashboard()`: Aggregates real DB counts for pending, approved, upcoming, overdue leaves, and recent decisions.
- `public.refresh_leave_overdue()`: Service-role maintenance job to mark approved leaves past their return time as `overdue`.

---

## 4. RLS & Storage Policies

- **Row Level Security**: Enabled on all 5 new tables (`hostel_leave_policies`, `leave_requests`, `leave_request_documents`, `leave_request_history`, `notifications`).
  - Anonymous and authenticated users receive no unrestricted table permissions.
  - Direct INSERT/UPDATE on `leave_requests` is revoked; mutations proceed exclusively through trusted security-definer RPCs.
  - `leave_requests_read`: Authenticated users can SELECT only their own requests (`student_id = private.current_student_id()`) or all requests if active admin (`private.is_active_admin()`).
  - `leave_documents_read` & `leave_history_read`: Scoped to requests the caller can access.
  - `notifications_read_self`: Scoped to `recipient_user_id = auth.uid()`.
- **Storage Bucket (`leave-documents`)**:
  - Private bucket (`public = false`), 5,242,880 byte limit (5 MB), allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
  - Path enforced: `<student_id>/<request_id>/<random_uuid>.<extension>`.
  - Student upload policy checks path ownership and ensures request is currently `pending`.
  - Student read policy allows only own request documents; admin read policy allows review access.
  - Downloads use expiring 60-second signed URLs.

---

## 5. Verification Results

### Automated Test Suite: 39 / 39 Tests Passed
Run command: `npm test` (`node --test tests/*.test.js`)

1. `tests/access.test.js`:
   - Active roles routed only to their own dashboard.
   - Missing, inactive, and unrecognized profiles fail closed.
2. `tests/student-validation.test.js`:
   - Student validation rejects invalid dates, emails, phone, semester, and PIN.
   - Avatar validation permits only JPEG, PNG, WebP up to 5 MB.
   - Nonexistent calendar dates rejected.
3. `tests/leave-validation.test.js` (NEW):
   - Day-Out and Night-Out schemas validated.
   - Past departure dates rejected.
   - Return time preceding departure rejected.
   - Missing or short destination/reason rejected.
   - Unconfirmed rules and invalid emergency contacts rejected.
   - Document upload constraints (3 files, 5 MB, allowed types) enforced.
4. `tests/phase2-database.test.js`:
   - Room/bed creation, capacity constraints, bed allocations, transfer rollback, maintenance lock, student archiving/restoration, and registration leases verified on PGlite.
5. `tests/phase3-leave.test.js` (NEW - 16 Specification Scenarios):
   - **✔ 1. Student can submit valid Day-Out request** (Sequence `LVR-YYYY-XXXXXX`, status `pending`).
   - **✔ 2. Student can submit valid Night-Out request** (Up to 72 hours).
   - **✔ 3. Missing destination or reason is rejected** (Database check constraints).
   - **✔ 4. Invalid departure/return times are rejected** (Chronological order enforced).
   - **✔ 5. Past departure dates are rejected according to policy** (Departure must be future).
   - **✔ 6. Disallowed durations are rejected** (Day-Out > 16h, Night-Out > 72h rejected by trigger).
   - **✔ 7. Conflicting requests are handled correctly** (Overlapping active requests blocked).
   - **✔ 8. A student cannot access another student's requests** (RLS isolation verified).
   - **✔ 9. A student cannot approve or reject a request through direct API calls** (Direct update denied, RPC denied).
   - **✔ 10. Unauthorized users cannot review requests** (Warden and anonymous rejected).
   - **✔ 11. Only valid state transitions succeed** (Admin cannot decide already-decided request; student can cancel pending but cannot cancel approved/rejected).
   - **✔ 12. Concurrent approval/rejection attempts are handled safely** (Row locks serialize decisions).
   - **✔ 13. Rejection requires a reason** (Empty remarks rejected by backend logic).
   - **✔ 14. Document access follows Storage authorization policies** (Strict student folder isolation and admin read).
   - **✔ 15. Dashboard counts come from actual database queries** (`phase3_dashboard()` aggregates verified).
   - **✔ 16. Existing authentication, student management, and room management continues to work** (Phase 1 & 2 regression test passed).

### Lint & Build Results
- `npm run lint`: **0 errors, 0 warnings**.
- `npm run build`: **0 compilation errors** (production Vite bundle generated in ~8.8s).

---

## 6. Live Deployment Readiness & Setup Steps

Target Supabase Project: `Hostel` (`mvbbxgeqtyotfirnjicm`)

### What Has NOT Been Applied Remotely Yet:
- The Phase 3 migration `supabase/migrations/20261021074458_phase3_leave_management.sql` has **not** been executed against the live project.
- No live tables or storage buckets for Phase 3 exist remotely yet.

### Post-Approval Live Setup Steps:
1. Apply `supabase/migrations/20261021074458_phase3_leave_management.sql` via Supabase Dashboard SQL Editor or Supabase CLI.
2. Confirm the private bucket `leave-documents` is present in Storage.
3. Confirm tables `leave_requests` and `notifications` are included in `supabase_realtime` publication.
4. Execute `UPDATE public.profiles SET role = 'admin' WHERE id = '<YOUR_AUTH_USER_UUID>'` to establish the first administrator on the remote database.
5. Configure `APP_ORIGIN` secret for Edge Functions if invitation emails are needed.

---

## 7. Manual End-to-End Testing Instructions

1. **Student Leave Submission**:
   - Sign in as an active student resident.
   - Navigate to `/student/leave`.
   - Choose "Apply for Day-Out", select departure time (e.g. tomorrow 09:00) and return time (tomorrow 17:00).
   - Fill in destination ("City Center"), reason ("Doctor appointment"), emergency contact ("9876543210"), and check the hostel rules box.
   - Click "Review & Submit" -> Observe review summary modal -> Click "Confirm & Submit".
   - Verify success toast and new request card under "Recent requests" with status `pending`.
2. **Student Leave Cancellation**:
   - On a pending request card, click "Cancel".
   - Confirm in the dialog -> Verify status changes to `cancelled`.
3. **Admin Review (Approval & Rejection)**:
   - Sign in as an administrator and navigate to `/admin/leave-requests`.
   - Verify summary metrics cards show the pending request count.
   - Click "Review" on a pending request.
   - Inspect student academic information, room/bed allocation, destination, schedule, and reason.
   - Click "Reject" -> Note that confirmation is disabled until a rejection reason (>=3 characters) is entered. Enter reason and confirm.
   - Status updates to `rejected` and audit trail records the transition.
   - For an approved request, observe the option to "Revoke approval" if necessary.
