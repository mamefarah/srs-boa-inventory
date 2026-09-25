import { HttpError } from './errors.ts';

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

function pgError(err: unknown): PgErrorLike {
  const e = err as { cause?: PgErrorLike } & PgErrorLike;
  return e?.cause?.code ? e.cause : e;
}

/** Unique-constraint names → stable client error codes. */
const UNIQUE_CODES: Record<string, [string, string]> = {
  items_item_code_unique: ['DUPLICATE_ITEM_CODE', 'An item with this code already exists'],
  items_normalized_name_unique: ['DUPLICATE_ITEM_NAME', 'An item with this name already exists'],
  uoms_code_unique: ['DUPLICATE_UOM_CODE', 'A unit of measure with this code already exists'],
  item_categories_code_unique: ['DUPLICATE_CATEGORY_CODE', 'A category with this code already exists'],
};

/**
 * Maps PostgreSQL errors raised by database controls (custom BA0xx SQLSTATEs,
 * unique/check violations) to client-safe HTTP errors. Unknown errors pass through
 * to the generic 500 handler.
 */
export function mapDbError(err: unknown): unknown {
  const e = pgError(err);
  switch (e.code) {
    case 'BA001':
      return new HttpError(403, 'SELF_ADMINISTRATION_FORBIDDEN', 'You cannot change your own access or activation');
    case 'BA002':
      return new HttpError(403, 'PERMISSION_DENIED', 'Not authorised for this action');
    case 'BA003':
      return new HttpError(404, 'NOT_FOUND', 'Referenced record not found');
    case 'BA004':
      return new HttpError(409, 'SEPARATION_OF_DUTIES', 'Access administration cannot be combined with stock, ledger, audit or global-scope access');
    case 'BA005':
      return new HttpError(409, 'LAST_ADMINISTRATOR', 'At least one active administrator must remain');
    case 'BA006':
      return new HttpError(409, 'ADMIN_CHANGE_REQUIRES_DUAL_CONTROL', 'Removing or deactivating an administrator requires the out-of-band dual-control procedure');
    case 'BA007':
      return new HttpError(400, 'REASON_REQUIRED', 'A reason is required for this change');
    case 'BA008':
      return new HttpError(409, 'QUANTITY_PRECISION', 'Existing quantities use more decimal places than requested');
    case 'BA009':
      return new HttpError(409, 'IMMUTABLE_CODE', 'Codes cannot be changed and records cannot be deleted');
    case 'BA010':
      return new HttpError(409, 'BASE_UOM_LOCKED', 'The base unit of measure cannot change once ledger entries exist');
    case 'BA011':
      return new HttpError(409, 'INACTIVE_REFERENCE', 'The referenced category or unit of measure is not active');
    case 'BA012':
      return new HttpError(409, 'CATEGORY_HIERARCHY', 'Subcategories must sit under an active top-level category');
    case '23505': {
      const known = e.constraint ? UNIQUE_CODES[e.constraint] : undefined;
      return known ? new HttpError(409, known[0], known[1]) : new HttpError(409, 'DUPLICATE', 'A record with these values already exists');
    }
    case '23514':
      return new HttpError(400, 'CONSTRAINT_VIOLATION', `Value violates rule ${e.constraint ?? 'unknown'}`);
    case '23503':
      return new HttpError(400, 'INVALID_REFERENCE', 'A referenced record does not exist');
    default:
      return err;
  }
}
