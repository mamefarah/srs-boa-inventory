# Security Architecture

## Principles

- Deny by default.
- Authenticate every protected operation.
- Authorize at server/database boundary.
- Scope access by warehouse and transaction authority.
- Do not trust client-side validation or hidden controls.
- Treat all external input as untrusted.
- Preserve immutable audit evidence for sensitive actions.
- Build security controls with each feature; do not defer them to final hardening.

## Authoritative write boundary

Authenticated application clients are prohibited from directly writing:
- inventory_transactions;
- inventory_entries;
- inventory_balance_projection/materialized balance tables;
- audit_logs;
- period_closures/reopen evidence.

Critical inventory effects must be produced only by approved transactional server/database operations.

RLS/grants should make this prohibition true even if a malicious client calls the API directly.

## PostgreSQL direction (ADR-0004)

- The API connects as a least-privilege login in the `boa_ims_app` group role; the schema owner is used only for migrations.
- Row Level Security on ledger/audit tables keyed to a transaction-local user context (fail-closed without context).
- SECURITY DEFINER RPCs only when necessary, narrowly scoped, explicit search_path and explicit grants.
- Critical posting through transactional PostgreSQL functions/server services rather than multi-step client writes.
- No service-role or privileged key in browser/mobile code.
- Database constraints for uniqueness, allowed states and referential integrity.
- Atomic unique idempotency claims with request-hash verification.
- Consistent row-lock ordering for concurrent stock/commitment updates.

## Critical threat scenarios

1. Storekeeper attempts to issue from another warehouse.
2. Requester bypasses approval by calling API directly.
3. Client directly inserts an inventory entry.
4. Client directly edits a balance projection.
5. Same mobile request is retried and posts twice.
6. Same idempotency key is reused with a different payload.
7. Two users simultaneously issue/commit the last available stock.
8. Requisition and transfer simultaneously overcommit stock.
9. User changes funding source between approval and issue.
10. User edits a posted transaction.
11. User backdates into a closed period.
12. User approves own restricted adjustment.
13. Destination warehouse falsely receives source transfer without authorization.
14. SECURITY DEFINER function exposes unintended table access.
15. Attachment upload is used for malicious/unexpected content.

Each scenario requires automated negative tests when its feature exists.

## Secrets

Only public/publishable browser configuration may be exposed client-side. Server secrets belong in deployment secret management. Never commit .env files containing real credentials.

CI must perform both sensitive-file checks and content-based secret checks. Provider-native secret scanning should be enabled where available.

## Logging

Log authentication/authorization failures, posting, approval, reversal/correction, disposal, period close/reopen and administrative privilege changes. Do not log passwords, tokens, secret keys or unnecessary sensitive payloads.

Audit logs are append-only to ordinary application roles.

## Backup

Production release requires automated encrypted backup, off-system copy, documented restore and a tested recovery procedure.
