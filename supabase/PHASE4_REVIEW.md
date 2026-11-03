# Phase 4 gate-pass issuance review

**Target:** `Hostel` (`mvbbxgeqtyotfirnjicm`). **Status:** approved and applied to Supabase on 1 November 2026.

## Diagnosis

The application calls `public.get_or_create_gate_pass(uuid)`. The live project returns 404 for that RPC. Its migration history has Phase 1, Phase 2, Phase 5, the student ID/password migrations, and the newly applied Phase 3 leave migration, but no Phase 4 gate migration. Read-only catalog checks confirmed that `public.gate_passes`, `public.gate_events`, `public.student_presence`, `public.gate_pass_code_seq`, and both public/private gate-pass issuance RPCs are absent. This is a missing database feature, not a stale function signature.

## Proposed migration chain

Apply these existing local migrations, in order, after explicit approval for this target:

1. [`20261021153000_phase4_gate_management.sql`](migrations/20261021153000_phase4_gate_management.sql)
2. [`20261029120000_phase4_gate_pass_secret_isolation.sql`](migrations/20261029120000_phase4_gate_pass_secret_isolation.sql)
3. [`20261029130000_phase4_gate_pass_display_details.sql`](migrations/20261029130000_phase4_gate_pass_display_details.sql)

The base migration depends on the Phase 1/2 identity and student schema and the Phase 3 `leave_requests` table, which is now present remotely. It creates gate passes, gate events, student presence tracking, indexes, authorization helpers, gate RPCs, RLS policies, and Realtime subscriptions. It initializes presence rows for existing students and installs a trigger for future registrations. The two follow-up migrations keep token hashes out of authenticated client queries and add room/leave-type display details to the gate-pass RPC response.

## Authorization and local verification

- Pass issuance verifies the leave is approved and the caller is the request-owning student or an active admin.
- Gate pass hashes are kept out of authenticated client selects; the follow-up grant limits selected columns.
- Gate passes, events, and presence have RLS enabled and student/security-scoped read policies. Mutation is performed through trusted RPCs with role checks.
- `node --test tests/phase4-gate.test.js` passed: 11 tests covering issuance authorization, token hashing, scan replay protection, presence updates, revocation, metrics, and row isolation.

Local tests do not establish a production end-to-end pass issuance. No test pass or leave request was created in the live project.

## Production verification

The three migrations were applied in order and recorded as versions `20261101154625`, `20261101154636`, and `20261101154644`. Live checks confirmed the gate tables and public issuance RPC exist, authenticated users can execute the RPC while anonymous users cannot, RLS is enabled, the token hash cannot be selected by authenticated users, and the RPC response includes room and leave-type details. The PostgREST schema cache was refreshed.

No live pass was issued as a test, so retry with an approved student leave request to verify the complete student flow. Do not deploy unrelated functions or run a broad database push.
