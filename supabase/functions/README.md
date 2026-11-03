# Privileged operations

## Phase 2

The last deployment report records `student-registration` version 1 ACTIVE on `mvbbxgeqtyotfirnjicm` on 18 October 2026, but also reports missing `APP_ORIGIN`. Current remote status was not available for reinspection. The current local admission form adds Phase 5 fields introduced after that deployment. Because the function schema is strict, the older deployed version is a likely cause of the generic `Invalid registration information` response: it can reject the added keys. This is an inference from deployment chronology and strict schema; current remote code could not be checked. Local code returns invalid field paths without submitted values, but this diagnostic update and required migrations have not been deployed.

`student-registration/index.ts` validates the caller's JWT and active admin profile, supports durable idempotent account provisioning and invitation retries, and uses the server-only service-role key. Set `APP_ORIGIN` to the exact app origin; do not infer it from an untrusted request. Verify/apply Phase 5 (`20261024120000_phase5_student_admission_fields.sql`) before deploying a function version that sends those fields, and apply the ID reservation migration (`20261025100000_student_id_generation.sql`) before deploying code that calls its RPC. Reconcile remote migration history first. See `../../README.md` for configuration steps and `../DEPLOYMENT_REPORT.md` for the last verified remote state.

Run isolated workflow tests with `npx --yes deno test --node-modules-dir=none --allow-env supabase/functions/student-registration/index.test.ts` from the project root. These tests stub remote services; they do not test inbox delivery.

## Phase 1 foundation

Phase 1 requires no Edge Function: provisioning and role changes use the Supabase Dashboard SQL editor with trusted project administrator access. There is deliberately no public admin-creation endpoint.

Future invitation and role-management Edge Functions must validate the caller JWT, query their active admin profile server-side, validate input, and only then use a server-only service-role client. Never trust user_metadata for authorization. Never ship service-role or secret keys to Vite. Apply new RLS policies through migrations before adding module data. The current schema is single-campus; multi-campus operation requires tenant membership and tenant-scoped policies first.
