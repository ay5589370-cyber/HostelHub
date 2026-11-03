# Phase 6 fee ledger review

Prepared 25 October 2026. This is a local proposal only. No Supabase project was modified, no migration was applied, and no function was deployed.

## Discovery

- The current app has Phase 2 students, registrations, rooms, beds and active allocations. There is no existing fee/payment table, gateway, currency setting, or payment function to reuse.
- Room types are stored as `rooms.room_type`; fee plans use those exact values. Invoice generation snapshots the actual student number, registration ID when present, active allocation, and room label.
- The migration only requires the Phase 1 `private.is_active_admin()` helper and Phase 2 tables. It does not reference Phase 3–5 objects or the student-ID sequence migration.
- Currency is mandatory on each fee plan, with a declared decimal precision. No currency is chosen by the application.
- CLI binary, Deno, Docker, and Supabase login credentials are unavailable. `npx supabase migration list --project-ref mvbbxgeqtyotfirnjicm` was attempted as a read-only check and returned `AccessTokenRequiredError`; current remote migration state could not be refreshed.

Earlier operator-provided read-only results reported remote migration versions `20261018093740` and `20261018093812`, while later local migrations were absent remotely. Those prior results are not treated as current verification. Before any live apply, recheck the target project's migration history and schema with an authenticated CLI session.

## Local migration

Exact proposed file: [`20261025110000_phase6_fee_management.sql`](migrations/20261025110000_phase6_fee_management.sql).

It is additive and transactional. It creates fee plans, immutable invoice snapshots, audited adjustments, payment records, an append-only audit log, balance/status view, RLS policies, and narrowly granted admin RPCs. It does not drop or rewrite existing objects. Invoice creation only uses active students with active allocations matching the plan room type and uses a unique `(student_id, academic_term, billing_period)` key to make retries idempotent. Payments are pending by default and only a different active administrator can verify, reject, or reverse them. Only verified payments count toward balances. Amounts are checked for positivity, remaining balance, currency precision, and duplicate method/reference pairs.

This local test applies the proposal after Phase 1 and Phase 2 only. It does not establish that the production project is ready. If the remote is still at Phase 2, deployment sequencing for the full app must account for other app-required pending migrations; Phase 6 itself only depends on Phase 1/2.

## Proposed live plan, pending approval

1. Authenticate the Supabase CLI for the authorized operator, scoped only to `mvbbxgeqtyotfirnjicm`.
2. Re-read remote migration history, columns, policies, functions, and object names; compare with every local migration through Phase 6. Do not run `db reset`, `migration repair`, or an unreviewed `db push`.
3. Verify Phase 1/2 prerequisites and resolve any history drift with an explicit reviewed plan. Do not mark migrations applied based only on matching filenames.
4. Review the exact SQL file above against the live schema. Take a verified backup according to the project's operating procedure.
5. Obtain explicit approval of the migration plan, then apply only the approved migration(s) to this project. Re-read the created objects, constraints, grants, policies, and function definitions afterward.

No step above has run. The migration needs explicit user approval before any production apply.

## Operating limitations

- Online payment is not implemented. Admin-entered evidence remains pending and contributes zero collected revenue until a second active admin verifies it. A single-admin workspace cannot complete verification without another trusted admin; this is an intentional two-person integrity control.
- No SMTP or gateway credentials are used by the fee feature. Student-facing instructions direct students to contact the hostel administration. No receipt download is claimed; print uses the browser's print dialog.
- The local PGlite tests verify SQL logic and row-level access in a local harness. They do not verify Supabase-hosted production behavior, actual SMTP, concurrent remote sessions, gateway settlement, or student sign-in.
