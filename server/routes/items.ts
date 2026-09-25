import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { principalOf, requirePermission } from '../authz/authorize.ts';
import { PERMISSIONS } from '../authz/permissions.ts';
import { withUserContext, type Tx } from '../db/client.ts';
import { itemCategories, items, uoms } from '../db/schema.ts';
import { mapDbError } from '../http/db-errors.ts';
import { HttpError } from '../http/errors.ts';
import { idParam, limitParam, offsetParam, reasonField } from '../http/validation.ts';
import type { RouteDeps } from './deps.ts';

/**
 * M2 item master, units of measure and item categories (PRD §11; INV-021..023).
 *
 * Every write runs in the caller's RLS user context with the change reason set, so
 * database triggers enforce the permission, force server-controlled columns, keep
 * codes immutable, lock the base UOM once ledger entries exist, and write the audit
 * event (drizzle/0005). No endpoint here has any stock effect.
 */

const ASSET_CONTROL_TYPES = ['SUPPLY', 'FIXED_ASSET_CANDIDATE', 'SPECIAL_CONTROLLED_ITEM', 'UNCLASSIFIED'] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
// Omitted → undefined (left unchanged on PATCH); empty string or null → null (cleared).
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v ? v : null));
const upperCode = (re: RegExp, msg: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(re, msg));
const itemCode = upperCode(/^[A-Z0-9][A-Z0-9._/-]{1,39}$/, 'item code: 2–40 of A–Z, 0–9, . _ / -');
const refCode = upperCode(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'code: 1–20 of A–Z, 0–9, _ -');
const positiveInt = z.number().int().positive().max(2_147_483_647);
const rowVersion = z.number().int().positive();

const itemFields = {
  name: text(200),
  description: optionalText(2000),
  specification: optionalText(2000),
  categoryId: positiveInt,
  baseUomId: positiveInt,
  assetControlType: z.enum(ASSET_CONTROL_TYPES),
  isBatchTracked: z.boolean(),
  isExpiryTracked: z.boolean(),
  isSerialTracked: z.boolean(),
  isHazardous: z.boolean(),
  defaultShelfLifeDays: positiveInt.nullable(),
  usefulLifeMonths: positiveInt.nullable(),
};

const createItemBody = z
  .object({
    itemCode,
    ...itemFields,
    description: itemFields.description,
    specification: itemFields.specification,
    isBatchTracked: itemFields.isBatchTracked.default(false),
    isExpiryTracked: itemFields.isExpiryTracked.default(false),
    isSerialTracked: itemFields.isSerialTracked.default(false),
    isHazardous: itemFields.isHazardous.default(false),
    assetControlType: itemFields.assetControlType.default('UNCLASSIFIED'),
    defaultShelfLifeDays: itemFields.defaultShelfLifeDays.default(null),
    usefulLifeMonths: itemFields.usefulLifeMonths.default(null),
    reason: reasonField,
    confirmNotDuplicate: z.boolean().default(false),
  })
  .strict();

const updateItemBody = z
  .object({
    ...Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, v.optional()])),
    rowVersion,
    reason: reasonField,
    confirmNotDuplicate: z.boolean().default(false),
  })
  .strict();

const activationBody = z.object({ active: z.boolean(), rowVersion, reason: reasonField }).strict();

const itemSelect = {
  id: items.id,
  itemCode: items.itemCode,
  name: items.name,
  description: items.description,
  specification: items.specification,
  categoryId: items.categoryId,
  categoryCode: itemCategories.code,
  categoryName: itemCategories.name,
  baseUomId: items.baseUomId,
  baseUomCode: uoms.code,
  baseUomName: uoms.name,
  baseUomDecimalPlaces: uoms.decimalPlaces,
  assetControlType: items.assetControlType,
  isBatchTracked: items.isBatchTracked,
  isExpiryTracked: items.isExpiryTracked,
  isSerialTracked: items.isSerialTracked,
  isHazardous: items.isHazardous,
  defaultShelfLifeDays: items.defaultShelfLifeDays,
  usefulLifeMonths: items.usefulLifeMonths,
  isActive: items.isActive,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
  rowVersion: items.rowVersion,
};

/** Possible duplicates by trigram similarity of the name (red flag: minor spelling changes). */
async function similarItems(tx: Tx, name: string, excludeId?: number) {
  const r = await tx.execute(sql`
    SELECT id, item_code AS "itemCode", name, round(similarity(lower(name), lower(${name}))::numeric, 2)::float AS similarity
    FROM ${items}
    WHERE similarity(lower(name), lower(${name})) >= 0.6 ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
    ORDER BY similarity(lower(name), lower(${name})) DESC
    LIMIT 5`);
  return r.rows as Array<{ id: number; itemCode: string; name: string; similarity: number }>;
}

export function itemRoutes({ db, logger, authenticated }: RouteDeps) {
  const router = Router();
  const canRead = requirePermission(db, logger, PERMISSIONS.READ_ITEMS);
  const canManageItems = requirePermission(db, logger, PERMISSIONS.MANAGE_ITEMS);
  const canManageReference = requirePermission(db, logger, PERMISSIONS.MANAGE_MASTER_REFERENCE);

  const write = <T>(res: Response, reason: string, fn: (tx: Tx) => Promise<T>) =>
    withUserContext(db, principalOf(res).userId, fn, { changeReason: reason, requestId: res.locals.requestId }).catch((err) => {
      throw mapDbError(err);
    });

  // ---------------------------------------------------------------- items: read
  const listQuery = z.object({
    q: z.string().trim().min(1).max(100).optional(),
    categoryId: idParam.optional(),
    assetControlType: z.enum(ASSET_CONTROL_TYPES).optional(),
    active: z.enum(['true', 'false', 'all']).default('true'),
    limit: limitParam(200, 50),
    offset: offsetParam,
  });

  router.get('/items', ...authenticated, canRead, async (req, res, next) => {
    try {
      const q = listQuery.parse(req.query);
      const pattern = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
      const filters: Array<SQL | undefined> = [
        pattern ? or(ilike(items.itemCode, pattern), ilike(items.name, pattern), ilike(items.specification, pattern)) : undefined,
        q.categoryId === undefined ? undefined : or(eq(items.categoryId, q.categoryId), eq(itemCategories.parentId, q.categoryId)),
        q.assetControlType === undefined ? undefined : eq(items.assetControlType, q.assetControlType),
        q.active === 'all' ? undefined : eq(items.isActive, q.active === 'true'),
      ];
      const where = and(...filters);
      const base = () =>
        db.select(itemSelect).from(items).innerJoin(itemCategories, eq(itemCategories.id, items.categoryId)).innerJoin(uoms, eq(uoms.id, items.baseUomId));
      const [rows, [{ total }]] = await Promise.all([
        base().where(where).orderBy(asc(items.itemCode)).limit(q.limit).offset(q.offset),
        db.select({ total: count() }).from(items).innerJoin(itemCategories, eq(itemCategories.id, items.categoryId)).where(where),
      ]);
      res.json({ data: rows, page: { limit: q.limit, offset: q.offset, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/items/:id', ...authenticated, canRead, async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      const [row] = await db
        .select(itemSelect)
        .from(items)
        .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .where(eq(items.id, id));
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Item not found');
      const usage = await db.execute(sql`SELECT boa_item_has_ledger_entries(${id}) AS used`);
      res.json({ data: { ...row, baseUomLocked: (usage.rows[0] as { used: boolean }).used } });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------- items: write
  router.post('/items', ...authenticated, canManageItems, async (req, res, next) => {
    try {
      const body = createItemBody.parse(req.body);
      const created = await write(res, body.reason, async (tx) => {
        if (!body.confirmNotDuplicate) {
          const similar = await similarItems(tx, body.name);
          if (similar.length) return { duplicates: similar };
        }
        const [row] = await tx
          .insert(items)
          .values({
            itemCode: body.itemCode,
            name: body.name,
            description: body.description,
            specification: body.specification,
            categoryId: body.categoryId,
            baseUomId: body.baseUomId,
            assetControlType: body.assetControlType,
            isBatchTracked: body.isBatchTracked,
            isExpiryTracked: body.isExpiryTracked,
            isSerialTracked: body.isSerialTracked,
            isHazardous: body.isHazardous,
            defaultShelfLifeDays: body.defaultShelfLifeDays,
            usefulLifeMonths: body.usefulLifeMonths,
          })
          .returning({ id: items.id, itemCode: items.itemCode, rowVersion: items.rowVersion });
        return { row };
      });
      if ('duplicates' in created) {
        res.status(409).json({
          error: {
            code: 'POSSIBLE_DUPLICATE',
            message: 'Similar items already exist. Review them, or resubmit with confirmNotDuplicate=true and a reason.',
            requestId: res.locals.requestId,
            candidates: created.duplicates,
          },
        });
        return;
      }
      res.status(201).json({ data: created.row });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/items/:id', ...authenticated, canManageItems, async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      const body = updateItemBody.parse(req.body);
      const { rowVersion: expected, reason, confirmNotDuplicate, ...changes } = body as z.infer<typeof updateItemBody> & Record<string, unknown>;
      if (Object.keys(changes).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const result = await write(res, reason, async (tx) => {
        if (typeof changes.name === 'string' && !confirmNotDuplicate) {
          const similar = await similarItems(tx, changes.name, id);
          if (similar.length) return { duplicates: similar };
        }
        const rows = await tx
          .update(items)
          .set(changes as Partial<typeof items.$inferInsert>)
          .where(and(eq(items.id, id), eq(items.rowVersion, expected as number)))
          .returning({ id: items.id, rowVersion: items.rowVersion });
        return { rows };
      });
      if ('duplicates' in result) {
        res.status(409).json({ error: { code: 'POSSIBLE_DUPLICATE', message: 'Similar items already exist', requestId: res.locals.requestId, candidates: result.duplicates } });
        return;
      }
      if (result.rows.length === 0) await staleOrMissing(id);
      res.json({ data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  router.post('/items/:id/activation', ...authenticated, canManageItems, async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      const body = activationBody.parse(req.body);
      const rows = await write(res, body.reason, (tx) =>
        tx
          .update(items)
          .set({ isActive: body.active })
          .where(and(eq(items.id, id), eq(items.rowVersion, body.rowVersion)))
          .returning({ id: items.id, isActive: items.isActive, rowVersion: items.rowVersion }),
      );
      if (rows.length === 0) await staleOrMissing(id);
      res.json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  });

  async function staleOrMissing(id: number): Promise<never> {
    const [exists] = await db.select({ id: items.id }).from(items).where(eq(items.id, id));
    if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Item not found');
    throw new HttpError(409, 'STALE_VERSION', 'The item was changed by someone else; reload and try again');
  }

  // ---------------------------------------------------------------- UOMs
  router.get('/uoms', ...authenticated, canRead, async (_req, res, next) => {
    try {
      res.json({ data: await db.select().from(uoms).orderBy(asc(uoms.code)) });
    } catch (err) {
      next(err);
    }
  });

  const createUomBody = z
    .object({ code: refCode, name: text(100), description: optionalText(500), decimalPlaces: z.number().int().min(0).max(6).default(0), reason: reasonField })
    .strict();
  router.post('/uoms', ...authenticated, canManageReference, async (req, res, next) => {
    try {
      const b = createUomBody.parse(req.body);
      const [row] = await write(res, b.reason, (tx) =>
        tx.insert(uoms).values({ code: b.code, name: b.name, description: b.description, decimalPlaces: b.decimalPlaces }).returning(),
      );
      res.status(201).json({ data: row });
    } catch (err) {
      next(err);
    }
  });

  const updateUomBody = z
    .object({
      name: text(100).optional(),
      description: optionalText(500),
      decimalPlaces: z.number().int().min(0).max(6).optional(),
      isActive: z.boolean().optional(),
      rowVersion,
      reason: reasonField,
    })
    .strict();
  router.patch('/uoms/:id', ...authenticated, canManageReference, async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      const { rowVersion: expected, reason, ...changes } = updateUomBody.parse(req.body);
      const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const rows = await write(res, reason, (tx) =>
        tx.update(uoms).set(set).where(and(eq(uoms.id, id), eq(uoms.rowVersion, expected))).returning(),
      );
      if (rows.length === 0) {
        const [exists] = await db.select({ id: uoms.id }).from(uoms).where(eq(uoms.id, id));
        throw exists ? new HttpError(409, 'STALE_VERSION', 'Changed by someone else; reload') : new HttpError(404, 'NOT_FOUND', 'Unit not found');
      }
      res.json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------- categories
  router.get('/item-categories', ...authenticated, canRead, async (_req, res, next) => {
    try {
      res.json({ data: await db.select().from(itemCategories).orderBy(asc(itemCategories.code)) });
    } catch (err) {
      next(err);
    }
  });

  const createCategoryBody = z
    .object({ code: refCode, name: text(100), description: optionalText(500), parentId: positiveInt.nullable().default(null), reason: reasonField })
    .strict();
  router.post('/item-categories', ...authenticated, canManageReference, async (req, res, next) => {
    try {
      const b = createCategoryBody.parse(req.body);
      const [row] = await write(res, b.reason, (tx) =>
        tx.insert(itemCategories).values({ code: b.code, name: b.name, description: b.description, parentId: b.parentId }).returning(),
      );
      res.status(201).json({ data: row });
    } catch (err) {
      next(err);
    }
  });

  const updateCategoryBody = z
    .object({
      name: text(100).optional(),
      description: optionalText(500),
      parentId: positiveInt.nullable().optional(),
      isActive: z.boolean().optional(),
      rowVersion,
      reason: reasonField,
    })
    .strict();
  router.patch('/item-categories/:id', ...authenticated, canManageReference, async (req, res, next) => {
    try {
      const { id } = z.object({ id: idParam }).parse(req.params);
      const { rowVersion: expected, reason, ...changes } = updateCategoryBody.parse(req.body);
      const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No fields to update');
      const rows = await write(res, reason, (tx) =>
        tx.update(itemCategories).set(set).where(and(eq(itemCategories.id, id), eq(itemCategories.rowVersion, expected))).returning(),
      );
      if (rows.length === 0) {
        const [exists] = await db.select({ id: itemCategories.id }).from(itemCategories).where(eq(itemCategories.id, id));
        throw exists ? new HttpError(409, 'STALE_VERSION', 'Changed by someone else; reload') : new HttpError(404, 'NOT_FOUND', 'Category not found');
      }
      res.json({ data: rows[0] });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
