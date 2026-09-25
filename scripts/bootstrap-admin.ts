/**
 * One-time bootstrap of the first technical SYSTEM_ADMIN (operator-run, audited).
 *
 * Usage (migration-owner credentials, never application credentials):
 *   BOOTSTRAP_FIREBASE_UID=<uid> BOOTSTRAP_REASON="<why>" npx tsx scripts/bootstrap-admin.ts
 *
 * Preconditions: the person has signed in once (POST /api/auth/sync created their
 * inactive profile) and NO active SYSTEM_ADMIN exists. SYSTEM_ADMIN is a technical
 * role with no inventory or approval authority (INV-029).
 * In production, CONFIRM_PRODUCTION_BOOTSTRAP must equal the database name.
 */
import pg from 'pg';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

async function main() {
  const database = required('SQL_DB_NAME');
  if (process.env.NODE_ENV === 'production' && process.env.CONFIRM_PRODUCTION_BOOTSTRAP !== database) {
    throw new Error('Refusing production bootstrap without CONFIRM_PRODUCTION_BOOTSTRAP=<database name>');
  }
  const uid = required('BOOTSTRAP_FIREBASE_UID');
  const reason = required('BOOTSTRAP_REASON');
  if (reason.trim().length < 5) throw new Error('BOOTSTRAP_REASON must be at least 5 characters');

  const client = new pg.Client({
    host: required('SQL_HOST'),
    port: Number(process.env.SQL_PORT ?? '5432'),
    database,
    user: required('MIGRATION_SQL_USER'),
    password: process.env.MIGRATION_SQL_PASSWORD ?? '',
    ssl: process.env.SQL_SSL === 'require' ? { rejectUnauthorized: true } : false,
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const existing = await client.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
       WHERE r.code = 'SYSTEM_ADMIN' AND u.is_active`,
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error('An active SYSTEM_ADMIN already exists; use the audited admin API instead');
    }
    const user = await client.query('SELECT id FROM users WHERE firebase_uid = $1 FOR UPDATE', [uid]);
    if (user.rowCount !== 1) throw new Error('No profile for that Firebase UID; the person must sign in once first');
    const userId: number = user.rows[0].id;
    await client.query('UPDATE users SET is_active = true, updated_at = now() WHERE id = $1', [userId]);
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by_user_id)
       SELECT $1, id, NULL FROM roles WHERE code = 'SYSTEM_ADMIN' ON CONFLICT DO NOTHING`,
      [userId],
    );
    await client.query(
      `INSERT INTO audit_events (action, result, entity_type, entity_id, actor_firebase_uid, reason, new_data)
       VALUES ('BOOTSTRAP_ADMIN_GRANTED', 'SUCCESS', 'users', $1, 'system:bootstrap-admin', $2, $3)`,
      [String(userId), reason, JSON.stringify({ roleCode: 'SYSTEM_ADMIN', isActive: true })],
    );
    await client.query('COMMIT');
    process.stdout.write(`SYSTEM_ADMIN bootstrapped for user ${userId}\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`bootstrap-admin failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
