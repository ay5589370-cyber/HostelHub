# Phase 1 and Phase 2 deployment — 18 October 2026

Target: **Hostel (`mvbbxgeqtyotfirnjicm`)**, development project, Singapore. No other project was modified.

## Deployment results

| Operation | Result |
| --- | --- |
| Phase 1 migration | Applied successfully; remote version `20261018093740`, name `phase1_profiles` |
| Phase 1 verification before Phase 2 | Passed: profiles, policies, private helpers and Auth triggers present; existing Auth user backfilled; Auth record unchanged |
| Phase 2 migration | Applied successfully; remote version `20261018093812`, name `phase2_student_management` |
| Schema verification | All eight application tables have RLS; constraints, indexes, policies, triggers, functions, view and storage configuration inventoried and checked |
| Edge Function | `student-registration` deployed successfully, ACTIVE, version 1, JWT verification enabled |
| Runtime configuration probe | Function starts, but OPTIONS returns HTTP 503: `APP_ORIGIN has not been configured.` This is a configuration blocker, not a deployment failure |
| Migration/deployment failures | None |

The exact reviewed SQL was applied without amendment, first Phase 1, then Phase 2 after Phase 1 verification. Applied files retain SHA-256 hashes:

- `20261018093740_phase1_profiles.sql`: `76A65CF3E9743CBF6AEA40EAEB9E68FC47456DA12E3A95717BF42FA12CC0B43F`
- `20261018093812_phase2_student_management.sql`: `BF36C1BE4E7AF3ABA5957D99594B8189FD003E60FE726B7B1746D5BE99CF1EC9`

On 25 October, the local filenames were aligned with the remote migration versions after confirming these unchanged SQL hashes. Only filenames and references changed; SQL contents did not.

MCP assigned the remote migration versions shown above, which differ from the local filenames. Do not run a blind CLI `db push`: reconcile the local/remote version mapping first. Do not reapply these migrations.

## Database verification

- Tables: profiles, students, guardians, hostels, rooms, beds, bed_allocations, student_registrations. RLS enabled on all eight.
- Verified primary keys, foreign keys, field checks, uniqueness constraints, lookup indexes and both active-allocation partial unique indexes.
- Nine application/Auth triggers are enabled, covering profile creation/email synchronization, timestamps, capacity, allocation validation and invitation acceptance.
- Fifteen public/private functions inventoried; search paths are pinned. Registration claim/finalization execution is restricted to service_role. Administrative mutations check active admin status. No exposed security-definer function was introduced in public.
- Directory view has `security_invoker=true`.
- `student-avatars`: private, 5,242,880-byte limit, JPEG/PNG/WebP only, with four ownership/admin policies.
- Realtime publication includes students, rooms, beds and bed_allocations.

## Tests actually run

- **15 local tests passed**, including execution of both migrations on disposable embedded PostgreSQL, RLS/guardian/avatar isolation, forbidden role changes, allocation uniqueness, capacity, rollback on transfer failure, maintenance, archive/restore, registration leases/idempotency and invitation acceptance.
- **6 Edge workflow tests passed** using stubbed Auth/database transports, covering non-admin denial, correct operation order, invitation failure/retry, database failure and accepted-account reuse.
- **Live read-only role checks passed** using the existing user's database identity: only its own profile visible; no student insertion, allocation insertion, role change, student ID change or service-only RPC execution permission. Safe phone update permission exists. An attempted admin RPC was rejected with insufficient privilege before any write.
- **Live anonymous privilege checks passed**: no student SELECT or management RPC execution.
- Live tests used a read-only transaction and rolled back. No test students, rooms, accounts or emails were created in the development project.
- The catalog confirms concurrency-enforcing unique indexes and locking triggers. Real simultaneous multi-session allocation requests, actual student sign-in, inbox delivery, Storage transfer and full authenticated UI tests remain pending. Local allocation tests do not prove live concurrency behavior.

## Advisors

Security Advisor returned one warning: **leaked-password protection is disabled**. No database/RLS security finding was returned. Review [password protection setup](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Performance Advisor returned one warning: profiles has separate permissive SELECT policies for self and admin access. This is a policy-evaluation overhead warning, not evidence of unauthorized access. A future reviewed migration can combine the predicates. See [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

It also returned eight informational unused-index notices, expected immediately after creating an empty schema. Indexes were retained because they support planned directory and relationship queries. See [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

No unreviewed database changes were made to silence advisor findings.

## Existing data preservation

Before migration: no application tables or storage buckets; one Auth user, one Auth identity, zero storage objects.

After migration: the Auth user and identity counts remain one each, and full-row aggregate digests match their pre-migration values exactly. Storage objects remain zero. One new profile was added for the existing user with the default student role. All seven Phase 2 tables remain empty.

**No existing data was deleted or overwritten.** No Auth role or account was promoted, and no student records were seeded.

## Manual configuration still required

1. Set the Edge Function secret **APP_ORIGIN** to the exact application origin, without a trailing slash. It is currently absent. Do not put service credentials in Vite.
2. Configure Auth Site URL and allow `<APP_ORIGIN>/reset-password` as the invitation/password redirect. Verify Email auth and the desired public-signup setting.
3. Configure and verify SMTP and sender identity. No invitation or external email delivery was tested.
4. Provision the intended administrator through a verified UUID-scoped role update. **There are currently zero active admin profiles**; the existing user was safely backfilled as a student. Its identity must be explicitly confirmed before promotion.
5. Review/enable leaked-password protection where supported by the project plan.
6. Create real hostel/block/room inventory after admin setup, then verify an authorized real student invitation, password setup/login, profile isolation, photo upload and concurrent allocation behavior.
7. Deploy the frontend with SPA history fallback when ready. This task deployed the Edge Function, not a frontend hosting site.

Hosted Supabase provides the server-side platform environment variables. The deployment did not read or expose service credentials.
