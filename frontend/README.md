# Frontend

BoA-IMS responsive PWA foundation (M1 Slice 1). Next.js (App Router) + TypeScript strict +
Tailwind CSS, Supabase Auth via `@supabase/ssr`.

## Setup

```sh
npm install
cp .env.example .env.local   # fill in your local/dev Supabase project's URL + publishable key
npm run dev
```

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `eslint .`
- `npm run test` — `vitest run`

## Version notes (verified against installed packages, current as of this slice)

- `next@16.3.6` renamed the `middleware.ts` file convention to `proxy.ts` (exporting a
  `proxy` function instead of `middleware`); see `src/proxy.ts`.
- `typescript` is pinned to `6.0.3`, not the newer `7.x` line: `typescript-eslint` (used by
  `eslint-config-next`) does not yet support TypeScript 7 as of this writing. `tsc --noEmit`
  itself works fine on 7.x — the constraint is the lint toolchain. Revisit once
  typescript-eslint adds TS 7 support.
- `eslint` is pinned to `9.39.5` (a maintenance-only release), not `10.x`: the version of
  `eslint-plugin-react` that `eslint-config-next@16.3.6` bundles is not compatible with
  ESLint 10's rule-context API yet, despite the package's `>=9.0.0` peer range. Revisit
  once `eslint-config-next` updates its bundled `eslint-plugin-react`.

## Structure

- `src/app/` — App Router routes. `sign-in/` is public; everything else requires a
  session (enforced by `src/proxy.ts` and, independently, by `src/app/dashboard/layout.tsx`
  server-side).
- `src/lib/supabase/` — browser/server/proxy Supabase client factories and the hand-
  maintained `Database` type (`database.types.ts` — keep in sync with
  `supabase/migrations/`, or replace with `supabase gen types typescript` output once
  Supabase CLI access is available).
- `src/lib/auth/` — `capabilities.ts` (the technical capability vocabulary),
  `session.ts` (server-side session validation), `actions.ts` (sign-out).
- `src/components/ui/` — minimal shadcn/ui-style primitives (Button, EmptyState,
  ErrorState, LoadingSpinner, StatusBadge) per `docs/DESIGN_SYSTEM.md`.

See `docs/M1_POLICY_GATE.md` for which workflows remain blocked pending M0 evidence, and
`tasks/plan.md` for the full M1 slice breakdown.
