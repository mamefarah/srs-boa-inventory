# Supabase / PostgreSQL

Reserved for reproducible local/development database configuration, migrations and database tests.

Do not connect this repository directly to production during foundation work.

Critical rules:
- migration-first;
- RLS/authorization tests;
- transactional stock-posting functions;
- idempotency and concurrency tests;
- no service-role key in frontend;
- production changes require explicit approval.
