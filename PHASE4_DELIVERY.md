# HostelHub — Phase 4 Delivery: Smart Gate Management & QR Verification

This document summarizes the changes, security architecture, schema migration, and verification results for Phase 4 of the HostelHub Smart Hostel Management System.

---

## 1. Scope & Delivered Features

### 1.1 Security Guard Role & Workspace (`/security/dashboard`)
- Added `'security'` to supported roles in `profiles.role` and `access.js`.
- Security guards access an operational workspace at `/security/dashboard` designed for fast gate throughput.
- Direction selector for **Exit / Departure** vs **Entry / Return**.
- In-browser camera scanner with permission handling and fallback to manual pass-code entry (`GP-XXXX-XXXX`).
- Instant verification result card displaying resident photo, room & bed details, destination, and late curfew alert.
- Live "Currently Outside" roster with one-click return verification.
- Emergency manual security override modal with mandatory audit reason (minimum 5 characters).
- Live real-time gate activity feed.

### 1.2 Cryptographic QR Pass System
- **Issuance**: Only approved leave requests can generate a gate pass via RPC `public.get_or_create_gate_pass(p_leave_request_id uuid)`.
- **Zero Sensitive Data in QR**: QR code payload contains only:
  ```json
  { "v": 1, "pass_id": "uuid", "token": "64-char-hex", "pass_code": "GP-26001000" }
  ```
  No student phone numbers, guardian details, or credentials are embedded in the QR code.
- **SHA-256 Hash Storage**: The database table `public.gate_passes` stores only `token_hash = sha256(raw_token)`. The raw token is returned once to the student client.

### 1.3 State Transitions & Replay Protection
- **Single-Use Exit**: When an exit is verified, `gate_passes.exit_used_at` is stamped, `status` moves to `'used'`, and `student_presence.status` moves to `'outside'`. Replay attempts fail immediately.
- **Controlled Entry**: Entry cannot be verified unless the student is recorded as `'outside'`. When verified, `student_presence.status` returns to `'inside'`, `gate_passes.status` becomes `'completed'`, and `leave_requests.status` becomes `'completed'`.
- **Late Return Detection**: If entry occurs after `expected_return_at`, the system flags an overdue return alert and records it in `leave_request_history`.

### 1.4 Admin Gate Oversight (`/admin/gate`)
- Live campus occupancy breakdown (Inside vs Outside vs Overdue).
- Presence roster searchable by student name or ID, with status filters and "Overdue Only" flag.
- Searchable, immutable gate event audit log (`public.gate_events`).
- Administrative pass revocation modal with mandatory reason.

---

## 2. Database Schema Migration

File: `supabase/migrations/20261021153000_phase4_gate_management.sql`

Key changes:
1. **Role Check Update**:
   ```sql
   alter table public.profiles drop constraint if exists profiles_role_check;
   alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'student', 'warden', 'security'));
   ```
2. **Helper Function**:
   `private.is_active_security() returns boolean`
3. **Tables**:
   - `public.gate_passes` (stores pass metadata, validity window, timestamps, and SHA-256 token hash).
   - `public.gate_events` (immutable audit log for accepted/rejected exits, entries, and manual overrides).
   - `public.student_presence` (live status `'inside'` or `'outside'`, departure/return timestamps, overdue tracker).
4. **RPCs**:
   - `get_or_create_gate_pass(p_leave_request_id uuid)`
   - `verify_gate_scan(p_data jsonb)`
   - `manual_gate_override(p_data jsonb)`
   - `revoke_gate_pass(p_pass_id uuid, p_reason text)`
   - `gate_dashboard_metrics()`
5. **Row Level Security (RLS)**:
   - Security officers and admins have read access across gate records.
   - Students can only read their own passes, events, and presence.
   - All table mutations are restricted to trusted SECURITY DEFINER RPCs.
6. **Supabase Realtime**:
   - Tables `gate_events`, `student_presence`, `gate_passes` added to `supabase_realtime` publication.

---

## 3. Remote Deployment Instructions

> [!IMPORTANT]
> In accordance with project instructions, migrations and edge functions are **not** automatically applied to the remote Supabase project (`mvbbxgeqtyotfirnjicm`). You must review and execute them with explicit approval.

To apply this migration to your remote Supabase project:
```bash
# Push migration using Supabase CLI:
npx supabase db push

# Or apply directly using psql:
psql "<SUPABASE_DB_URL>" -f supabase/migrations/20261021153000_phase4_gate_management.sql
```

---

## 4. Test & Verification Summary

- **Unit Tests**:
  - `tests/access.test.js`: Verified routing and isolation for `security` role alongside admin, warden, and student.
  - `tests/gate-validation.test.js`: Verified pass code schemas, QR payload parsers, manual override schemas, and revocation schemas (6 passed).
- **PGlite Integration Tests**:
  - `tests/phase4-gate.test.js`: Verified end-to-end database lifecycle across migrations 1 through 4 (10 passed).
- **Full Test Suite**: 55 tests passed, 0 failures (`npm test`).
- **Lint**: 0 errors, 0 warnings (`npm run lint`).
- **Production Bundle**: Built cleanly in 10.25s (`npm run build`).
