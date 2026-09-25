import { defineConfig } from 'drizzle-kit';

// Offline generation only: `drizzle-kit generate` needs no database credentials.
// Migrations are applied by `scripts/migrate.ts`, never by drizzle-kit push.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
});
