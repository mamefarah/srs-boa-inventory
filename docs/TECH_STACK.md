# Technology Direction

This document records direction, not frozen versions. Version-specific implementation decisions must be checked against current official documentation when coding begins.

## Recommended
- Responsive PWA
- Next.js + TypeScript
- Tailwind CSS
- shadcn/ui component foundation
- Supabase Auth
- PostgreSQL
- Supabase Storage for controlled attachments
- RLS plus transactional PostgreSQL functions/RPCs for critical stock posting
- GitHub Actions
- Managed preview/production hosting such as Vercel or approved institutional equivalent
- Playwright for browser/E2E testing

## Architecture principle

Keep business truth in PostgreSQL. The client requests state transitions; it does not calculate or directly mutate authoritative stock balances.

## Deferred decisions

- exact framework/library versions;
- formal hosting region/provider;
- offline synchronization architecture;
- barcode/QR library;
- formal valuation method;
- integration with asset/accounting/procurement systems.

Record material decisions in ADRs.
