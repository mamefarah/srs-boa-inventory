# Security Architecture

## Principles

- Deny by default.
- Authenticate every protected operation.
- Authorize at server/database boundary.
- Scope access by warehouse and transaction authority.
- Do not trust client-side validation or hidden controls.
- Treat all external input as untrusted.
- Preserve immutable audit evidence for sensitive actions.

## Supabase/PostgreSQL direction

- Row Level Security on business tables exposed through Supabase.
- SECURITY DEFINER RPCs only when necessary, narrowly scoped and explicitly granted.
- Critical inventory posting through transactional server/database functions rather than multi-step client writes.
- No service-role or privileged key in browser/mobile code.
- Database constraints for uniqueness, allowed states and referential integrity.

## Critical threat scenarios

1. Storekeeper attempts to issue from another warehouse.
2. Requester bypasses approval by calling API directly.
3. Same mobile request is retried and posts twice.
4. Two users simultaneously issue the last available stock.
5. User changes funding source between approval and issue.
6. User edits a posted transaction.
7. User backdates into a closed period.
8. User approves own restricted adjustment.
9. Destination warehouse falsely receives source transfer without authorization.
10. Attachment upload is used for malicious/unexpected content.

Each scenario requires automated negative tests.

## Secrets

Only public/publishable browser configuration may be exposed client-side. Server secrets belong in deployment secret management. Never commit .env files containing real credentials.

## Logging

Log authentication/authorization failures, posting, approval, reversal, disposal, period close/reopen and administrative privilege changes. Do not log passwords, tokens, secret keys or unnecessary sensitive payloads.

## Backup

Production release requires automated encrypted backup, off-system copy, documented restore and a tested recovery procedure.
