/**
 * Permission catalogue. Must match the rows seeded by `drizzle/0001_m1_security.sql`
 * (verified by tests/migrations.test.ts). Permissions are technical capabilities, not
 * Bureau approval authorities.
 */
export const PERMISSIONS = {
  READ_STOCK: 'READ_STOCK',
  READ_LEDGER: 'READ_LEDGER',
  READ_AUDIT: 'READ_AUDIT',
  READ_WAREHOUSES: 'READ_WAREHOUSES',
  READ_ITEMS: 'READ_ITEMS',
  READ_POLICIES: 'READ_POLICIES',
  READ_USERS: 'READ_USERS',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_USER_ROLES: 'MANAGE_USER_ROLES',
  MANAGE_WAREHOUSE_ACCESS: 'MANAGE_WAREHOUSE_ACCESS',
  WAREHOUSE_SCOPE_ALL: 'WAREHOUSE_SCOPE_ALL',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
