import type pg from 'pg';

/**
 * Refuses to run the API with a database login that would silently disable the
 * database controls: superuser, BYPASSRLS, schema owner (owners bypass RLS and
 * grants), or a login that is not a member of boa_ims_app.
 */
export async function assertLeastPrivilegeConnection(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(`
    SELECT r.rolsuper, r.rolbypassrls,
           pg_has_role(current_user, 'boa_ims_app', 'USAGE') AS is_app_member,
           pg_has_role(current_user, c.relowner, 'MEMBER') AS owns_ledger
    FROM pg_roles r, pg_class c
    WHERE r.rolname = current_user AND c.oid = 'public.inventory_entries'::regclass`);
  const r = rows[0];
  const problems: string[] = [];
  if (!r) problems.push('ledger schema not found (run migrations)');
  else {
    if (r.rolsuper) problems.push('login is SUPERUSER');
    if (r.rolbypassrls) problems.push('login has BYPASSRLS');
    if (r.owns_ledger) problems.push('login owns (or is a member of the owner of) the schema');
    if (!r.is_app_member) problems.push('login is not a member of boa_ims_app');
  }
  if (problems.length) {
    throw new Error(`Unsafe database login for the API: ${problems.join('; ')}`);
  }
}
