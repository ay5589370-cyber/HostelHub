# Phase 12 inventory review

## Local implementation

The Phase 12 migration is `migrations/20261025170000_phase12_inventory_management.sql`. It adds fixed assets, append-only asset events, an asset-to-existing-maintenance-task link, consumable stock items, and an immutable stock transaction ledger. It depends on Phase 1 profiles and trusted staff checks, Phase 2 hostels and rooms, and Phase 7 complaint maintenance tasks. It aborts before creating objects if those prerequisites are absent.

The migration does not drop or rewrite existing records. It does not seed sample assets, choose a currency, create maintenance tasks, charge students, or enable public storage. Fixed-asset and consumable identifiers are independently unique without regard to letter case. Monetary fields remain optional; when a purchase cost is recorded, its ISO currency code is required. Assets and stock changes are written through authenticated RPCs that check active administrator/warden status. Direct table access is revoked from `anon` and `authenticated`. Every movement, status change, maintenance link, stock receipt, and stock issue has an actor, timestamp, and reason or ledger row. Stock issues lock their item row and cannot produce a negative balance.

The page is currently routed at `/admin/inventory`; this existing admin route guard plus the database RPC checks are required. Warden RPC access is intentionally permitted by the migration's existing Phase 7 trusted staff helper, but no warden UI route is currently added. CSV export is available from the asset listing and contains an explicit allowlist of non-contact asset fields; common CSV quoting and formula-prefix protection use the existing shared exporter.

## Prerequisite and deployment status

This is local code only. No live migration, production data, role, RLS policy, Edge Function, or storage configuration was changed. Current remote migration versions were not reverified: the installed project-local Supabase CLI fails before running because it cannot write its telemetry file under `C:\Users\amity\.supabase`. The repository does not provide a verified live database connection. Historical reports/user-supplied migration output are not treated as current deployment evidence.

Before deployment, use a Supabase CLI session configured for the intended project only and first run `supabase migration list --project-ref mvbbxgeqtyotfirnjicm`. Compare the remote list and required Phase 1/2/7 objects to the local history. Do not run `db push` until the mismatch is resolved and the exact migration plan is reviewed and approved. Phase 12 creates new tables and routines only, and refuses to run if required Phase 7 maintenance objects are missing.

## Scope and limitations

- No asset photos or private storage bucket are added; image storage requires a separately reviewed bucket and access policy.
- Assignment history stores movement location and reason. It does not track an individual custodian or per-unit serial number; quantity is an aggregate field.
- Inventory categories are operator-entered labels. The system does not impose a currency or unit list.
- Stock begins at zero. Record initial counts as a received transaction with an accurate reason after migration; no stock is fabricated.
- Maintenance linking uses existing complaint maintenance tasks. It does not create a second work-order system and never charges a student.
- The dashboard and CSVs require the Phase 12 migration to be applied. There are no deployed inventory metrics until then.

## Local verification

The test suite applies Phase 1, Phase 2, Phase 7, and Phase 12 migrations to isolated PGlite databases. Phase 12 checks cover role denial, duplicate asset codes, movement and maintenance history, duplicate maintenance-link retry, stock issue prevention, low-stock values, and CSV injection/escaping. See test and lint/build results in the delivery report.
