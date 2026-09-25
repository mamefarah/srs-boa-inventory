# Security Policy

Do not report or paste credentials, database passwords, private keys, service-role keys or production tokens into issues, pull requests or chat transcripts.

## Security-sensitive areas

Treat these as high risk:
- authentication and authorization;
- PostgreSQL grants, RLS, triggers and posting functions;
- Firebase ID-token verification and identity binding;
- inventory posting and balance projections;
- idempotency/concurrency controls;
- adjustment, reversal, disposal and period reopen;
- file uploads;
- production migrations and secrets.

Security fixes should include a regression test whenever practical.

If a secret is committed, treat it as compromised: remove it from active use, rotate/revoke it at the provider, replace it in the secret manager, and then clean repository history as appropriate.
