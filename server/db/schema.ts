/**
 * BoA-IMS PostgreSQL schema (M1 foundation).
 *
 * Controlled requirements: PRD v2.2 §7, §9, §36, §37; BUSINESS_RULES INV-001..INV-047.
 * Security-critical behaviour that Drizzle cannot express (role grants, append-only
 * triggers, RLS, timestamp forcing) lives in the custom migration
 * `drizzle/0001_m1_security.sql` — see ADR-0004.
 *
 * Conventions:
 * - All timestamps are `timestamptz` (INV-033).
 * - Quantities are unconstrained `numeric` (never float). Precision/scale is an M2
 *   decision (see ADR-0004 §Quantity) and must not be pre-empted with INTEGER.
 * - Foreign keys to authoritative evidence use RESTRICT, never CASCADE.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();

// ---------------------------------------------------------------------------
// Identity and authorization
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    firebaseUid: text('firebase_uid').notNull().unique(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    // Default-deny: a newly synchronised identity is inactive until an authorised
    // administrator activates it.
    isActive: boolean('is_active').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    lastSignInAt: tstz('last_sign_in_at'),
  },
  (t) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
    check('users_firebase_uid_not_blank', sql`length(btrim(${t.firebaseUid})) > 0`),
    check('users_email_not_blank', sql`length(btrim(${t.email})) > 0`),
  ],
);

/** Neutral technical software roles. They do not assert official Bureau job titles. */
export const roles = pgTable('roles', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
});

export const permissions = pgTable('permissions', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
    grantedByUserId: integer('granted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    grantedAt: tstz('granted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    check('user_roles_no_self_grant', sql`${t.grantedByUserId} IS DISTINCT FROM ${t.userId}`),
  ],
);

// ---------------------------------------------------------------------------
// Organization master data
// ---------------------------------------------------------------------------

export const directorates = pgTable('directorates', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const warehouses = pgTable('warehouses', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  physicalLocation: text('physical_location'),
  operatingDirectorateId: integer('operating_directorate_id').references(() => directorates.id, {
    onDelete: 'restrict',
  }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const warehouseLocations = pgTable(
  'warehouse_locations',
  {
    id: id(),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('warehouse_locations_code_per_warehouse').on(t.warehouseId, t.code),
    // Target for the composite FK that proves an entry's location belongs to its warehouse.
    unique('warehouse_locations_id_warehouse').on(t.id, t.warehouseId),
  ],
);

export const userWarehouseAccess = pgTable(
  'user_warehouse_access',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    grantedByUserId: integer('granted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    grantedAt: tstz('granted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.warehouseId] }),
    check('user_warehouse_access_no_self_grant', sql`${t.grantedByUserId} IS DISTINCT FROM ${t.userId}`),
  ],
);

export const custodians = pgTable(
  'custodians',
  {
    id: id(),
    custodianType: text('custodian_type').notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'restrict' }),
    directorateId: integer('directorate_id').references(() => directorates.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'custodians_type_valid',
      sql`${t.custodianType} IN ('USER', 'DIRECTORATE', 'EXTERNAL_PARTY')`,
    ),
  ],
);

export const fundingSources = pgTable('funding_sources', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const projects = pgTable('projects', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  fundingSourceId: integer('funding_source_id').references(() => fundingSources.id, {
    onDelete: 'restrict',
  }),
  isActive: boolean('is_active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// Item / UOM foundation (extended in M2)
// ---------------------------------------------------------------------------

export const uoms = pgTable('uoms', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const itemCategories = pgTable('item_categories', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const items = pgTable(
  'items',
  {
    id: id(),
    itemCode: text('item_code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: integer('category_id')
      .notNull()
      .references(() => itemCategories.id, { onDelete: 'restrict' }),
    baseUomId: integer('base_uom_id')
      .notNull()
      .references(() => uoms.id, { onDelete: 'restrict' }),
    assetControlType: text('asset_control_type').notNull().default('UNCLASSIFIED'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'items_asset_control_type_valid',
      sql`${t.assetControlType} IN ('SUPPLY', 'FIXED_ASSET_CANDIDATE', 'SPECIAL_CONTROLLED_ITEM', 'UNCLASSIFIED')`,
    ),
    // Target for the composite FK that forces ledger quantities into the item's base UOM.
    unique('items_id_base_uom').on(t.id, t.baseUomId),
  ],
);

/** Configurable condition taxonomy (PRD §7.2). Seeded with the PRD initial codes. */
export const conditionCodes = pgTable('condition_codes', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  isIssuable: boolean('is_issuable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// Effective-dated policy configuration (PRD §37)
// ---------------------------------------------------------------------------

export const policyVersions = pgTable(
  'policy_versions',
  {
    id: id(),
    policyKey: text('policy_key').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('DRAFT'),
    evidenceStatus: text('evidence_status').notNull().default('UNVERIFIED'),
    value: jsonb('value'),
    effectiveFrom: tstz('effective_from'),
    effectiveTo: tstz('effective_to'),
    sourceEvidenceRef: text('source_evidence_ref'),
    blockerRef: text('blocker_ref'),
    notes: text('notes'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('policy_versions_key_version').on(t.policyKey, t.version),
    check('policy_versions_status_valid', sql`${t.status} IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'DISABLED')`),
    check('policy_versions_evidence_status_valid', sql`${t.evidenceStatus} IN ('VERIFIED', 'UNVERIFIED')`),
    // An unverified policy can never be ACTIVE (PRD §2.2, HB-2).
    check(
      'policy_versions_active_requires_verified_evidence',
      sql`${t.status} <> 'ACTIVE' OR (${t.evidenceStatus} = 'VERIFIED' AND length(btrim(coalesce(${t.sourceEvidenceRef}, ''))) > 0 AND ${t.value} IS NOT NULL AND ${t.effectiveFrom} IS NOT NULL)`,
    ),
    check(
      'policy_versions_effective_range_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    uniqueIndex('policy_versions_one_active_per_key').on(t.policyKey).where(sql`${t.status} = 'ACTIVE'`),
  ],
);

// ---------------------------------------------------------------------------
// Authoritative two-layer ledger (PRD §9). No client writes; no posting in M1.
// ---------------------------------------------------------------------------

export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionType: text('transaction_type').notNull(),
    businessDocumentType: text('business_document_type'),
    businessDocumentId: text('business_document_id'),
    effectiveAt: tstz('effective_at').notNull(),
    postedAt: tstz('posted_at').notNull().defaultNow(),
    postedByUserId: integer('posted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    requestHash: text('request_hash').notNull(),
    approvalReference: text('approval_reference'),
    reason: text('reason'),
    reversalOfTransactionId: uuid('reversal_of_transaction_id'),
    correctionOfTransactionId: uuid('correction_of_transaction_id'),
    reportingPeriodRef: text('reporting_period_ref'),
    policyContext: jsonb('policy_context'),
    sourceSystemRef: text('source_system_ref'),
  },
  (t) => [
    foreignKey({ name: 'inventory_transactions_reversal_of_fk', columns: [t.reversalOfTransactionId], foreignColumns: [t.id] }).onDelete('restrict'),
    foreignKey({ name: 'inventory_transactions_correction_of_fk', columns: [t.correctionOfTransactionId], foreignColumns: [t.id] }).onDelete('restrict'),
    // A transaction can be directly reversed at most once (anti double-reversal).
    uniqueIndex('inventory_transactions_single_reversal')
      .on(t.reversalOfTransactionId)
      .where(sql`${t.reversalOfTransactionId} IS NOT NULL`),
    check('inventory_transactions_not_self_reversal', sql`${t.reversalOfTransactionId} IS DISTINCT FROM ${t.id}`),
    check('inventory_transactions_type_not_blank', sql`length(btrim(${t.transactionType})) > 0`),
    index('inventory_transactions_effective_at_idx').on(t.effectiveAt),
    index('inventory_transactions_document_idx').on(t.businessDocumentType, t.businessDocumentId),
  ],
);

export const CUSTODY_SCOPES = [
  'WAREHOUSE',
  'IN_TRANSIT',
  'INTERNAL_CUSTODY',
  'EXTERNAL',
  'TERMINAL_EXIT',
  'OPENING_BALANCE_CONTRA',
] as const;

export const inventoryEntries = pgTable(
  'inventory_entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => inventoryTransactions.id, { onDelete: 'restrict' }),
    lineNo: integer('line_no').notNull(),
    businessDocumentLineRef: text('business_document_line_ref'),
    itemId: integer('item_id').notNull(),
    signedQuantity: numeric('signed_quantity').notNull(),
    baseUomId: integer('base_uom_id').notNull(),
    custodyScope: text('custody_scope').notNull(),
    warehouseId: integer('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    warehouseLocationId: integer('warehouse_location_id'),
    custodianId: integer('custodian_id').references(() => custodians.id, { onDelete: 'restrict' }),
    conditionCode: text('condition_code')
      .notNull()
      .references(() => conditionCodes.code, { onDelete: 'restrict' }),
    batchRef: text('batch_ref'),
    serialRef: text('serial_ref'),
    fundingSourceId: integer('funding_source_id').references(() => fundingSources.id, {
      onDelete: 'restrict',
    }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    unitCostAmount: numeric('unit_cost_amount'),
    currencyCode: text('currency_code'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('inventory_entries_line_per_transaction').on(t.transactionId, t.lineNo),
    // INV-022: every ledger quantity is in the item's authoritative base UOM.
    foreignKey({
      name: 'inventory_entries_item_base_uom_fk',
      columns: [t.itemId, t.baseUomId],
      foreignColumns: [items.id, items.baseUomId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inventory_entries_location_in_warehouse_fk',
      columns: [t.warehouseLocationId, t.warehouseId],
      foreignColumns: [warehouseLocations.id, warehouseLocations.warehouseId],
    }).onDelete('restrict'),
    check('inventory_entries_quantity_nonzero', sql`${t.signedQuantity} <> 0`),
    check(
      'inventory_entries_custody_scope_valid',
      sql`${t.custodyScope} IN ('WAREHOUSE', 'IN_TRANSIT', 'INTERNAL_CUSTODY', 'EXTERNAL', 'TERMINAL_EXIT', 'OPENING_BALANCE_CONTRA')`,
    ),
    check(
      'inventory_entries_warehouse_required_for_warehouse_custody',
      sql`${t.custodyScope} <> 'WAREHOUSE' OR ${t.warehouseId} IS NOT NULL`,
    ),
    check(
      'inventory_entries_location_requires_warehouse',
      sql`${t.warehouseLocationId} IS NULL OR ${t.warehouseId} IS NOT NULL`,
    ),
    check(
      'inventory_entries_cost_currency_pair',
      sql`(${t.unitCostAmount} IS NULL) = (${t.currencyCode} IS NULL)`,
    ),
    check('inventory_entries_cost_nonnegative', sql`${t.unitCostAmount} IS NULL OR ${t.unitCostAmount} >= 0`),
    index('inventory_entries_item_warehouse_idx').on(t.itemId, t.warehouseId),
    index('inventory_entries_warehouse_idx').on(t.warehouseId),
    index('inventory_entries_transaction_idx').on(t.transactionId),
  ],
);

// ---------------------------------------------------------------------------
// Idempotency (PRD §31, INV-008)
// ---------------------------------------------------------------------------

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    operationType: text('operation_type').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('IN_PROGRESS'),
    transactionId: uuid('transaction_id').references(() => inventoryTransactions.id, {
      onDelete: 'restrict',
    }),
    responseSummary: jsonb('response_summary'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    check('idempotency_records_status_valid', sql`${t.status} IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')`),
    check('idempotency_records_key_length', sql`length(${t.idempotencyKey}) BETWEEN 16 AND 200`),
    check('idempotency_records_hash_format', sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

// ---------------------------------------------------------------------------
// Append-only audit (PRD §30, INV-032)
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorFirebaseUid: text('actor_firebase_uid'),
    action: text('action').notNull(),
    result: text('result').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    warehouseId: integer('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    requestId: text('request_id'),
    oldData: jsonb('old_data'),
    newData: jsonb('new_data'),
  },
  (t) => [
    check('audit_events_result_valid', sql`${t.result} IN ('SUCCESS', 'FAILED', 'DENIED')`),
    index('audit_events_occurred_at_idx').on(t.occurredAt),
    index('audit_events_warehouse_idx').on(t.warehouseId),
    index('audit_events_actor_idx').on(t.actorUserId),
  ],
);
