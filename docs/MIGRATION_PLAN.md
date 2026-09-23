# Data and Schema Migration Plan

## Database-change policy

All schema changes are reproducible migrations committed to Git. Never edit production schema manually as the normal workflow.

Before production migration:
- review generated SQL;
- apply to clean test database;
- apply to representative populated test data when relevant;
- run RLS/security/invariant tests;
- document rollback/forward-fix strategy;
- verify current backup and restore path;
- require explicit production approval.

## Opening inventory migration

1. Clean and approve item master.
2. Map warehouses and locations.
3. Remove/resolve duplicate item identities.
4. Verify units.
5. Conduct/validate physical opening count.
6. Capture batch/lot/serial/funding dimensions as required.
7. Produce signed/approved opening-balance evidence.
8. Import as a named migration batch.
9. Post immutable OPENING_BALANCE movements.
10. Reconcile imported balances to signed source.
11. Lock migration batch.

Do not reconstruct unreliable historical movements merely to make the system look complete. Prefer an approved verified opening position plus prospective transactions from go-live unless authoritative history is available.
