# Phase 2 database approval

Prepared 18 October 2026. **Approved and applied on 18 October 2026.** See [deployment results](DEPLOYMENT_REPORT.md). The proposal below is retained as the reviewed approval record.

## Target and discovery

The app's configured project is **Hostel**, reference `mvbbxgeqtyotfirnjicm`, region Singapore (`ap-southeast-1`). Read-only MCP inspection found no public tables, migration history, public/private functions, buckets or Edge Functions. The historical creation proposal in SETUP_PLAN.md references a different project and is superseded for this implementation. No other project was inspected or changed.

## Exact changes for approval

Apply, in order:

1. `migrations/20261018093740_phase1_profiles.sql` — existing, unchanged prerequisite. Creates profiles, role/access helpers, Auth profile/email triggers and RLS. Backfills existing email Auth users with the **student** role; it does not infer or create an administrator. A verified administrator UUID must be promoted separately using the existing README procedure.
2. `migrations/20261018093812_phase2_student_management.sql` — Phase 2 migration. Creates students, guardians, hostels, rooms, beds, bed_allocations and student_registrations; an RLS-respecting directory view; transactional management/registration RPCs; private policy helpers; validation triggers; unique/lookup indexes; the private student-avatars bucket and its policies; and Realtime publication entries for students, rooms, beds and allocations.

No existing table is dropped, no student records are seeded, no existing migration is rewritten, and no Auth account is created by the Phase 2 migration. Both scripts are transactional. Re-inspect for drift immediately before applying: they intentionally fail on unexpected object collisions rather than silently replacing existing objects.

## Data and access rules

- A hostel row represents a unique hostel name/block pair; room numbers are unique within that pair. Bed numbers are unique within a room.
- Partial unique indexes enforce one active allocation per student and per bed. Row locks and database triggers serialize allocation/availability changes. Bed count cannot exceed room capacity. Failed transfers roll back the prior-bed release.
- Archive retains student/guardian/history records, releases active allocation and disables the Phase 1 profile. Restore re-enables access but does not reclaim a former bed.
- Admin reads use the existing `private.is_active_admin()` helper. Mutations use the narrowly scoped `manage_phase2` RPC, with a fresh database role check. No blanket student-management write grants are given to browser clients.
- Active students read their own student and guardian records, allocation history and current room/hostel. Column grants allow only phone and photo-path updates. Wardens have no new management or student-data access.
- All seven new tables have RLS. The directory view uses `security_invoker=true`. Privileged definer functions live in `private`, with empty search paths, caller checks and explicit execution grants. Service-only registration RPCs are not executable by anon/authenticated.
- Storage is private, limited to JPEG/PNG/WebP and 5 MB. Paths start with an existing student UUID. Students cannot access another student's folder. Signed URLs last five minutes.
- Registration jobs reserve a request ID, unique email/student number and a fixed Auth UUID. Leases prevent simultaneous processing; token checks reject stale workers. Retry preserves the account and never deletes an unrelated Auth identity. A pending request can be corrected or assigned a replacement bed before completion.
- `sent` means Supabase accepted the invitation request; it is not proof of inbox delivery. `accepted` follows Auth email confirmation. No plaintext password is generated or emailed.

## Operational effects and recovery

This is a single-campus authorization model, matching Phase 1. A successfully committed admission retains its bed if SMTP fails, and the administrator resends the invitation from the profile. An interrupted Auth creation leaves a durable, unconfirmed reserved account attached to its request; retry reconciles it using the fixed UUID. There is no automatic destructive cleanup.

If a migration fails, its transaction rolls back. After real admissions exist, recover with a forward migration or verified backup; do not drop the student tables as a rollback shortcut. The two migrations are separate transactions, so successful Phase 1 setup remains if Phase 2 fails.

Approval requested: apply these two reviewed migrations to `mvbbxgeqtyotfirnjicm`. Edge deployment, APP_ORIGIN, SMTP, redirect allowlist and administrator provisioning are separate setup steps described in PHASE2_DELIVERY.md. No live migration or deployment has run yet.
