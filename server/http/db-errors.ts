import { HttpError } from './errors.ts';

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

/** A database-control message authored in our migrations, without its BOA_* prefix. */
function controlMessage(e: PgErrorLike, fallback: string): string {
  const m = /^BOA_[A-Z_]+: (.+)$/s.exec(e.message ?? '');
  return m ? m[1] : fallback;
}

function pgError(err: unknown): PgErrorLike {
  const e = err as { cause?: PgErrorLike } & PgErrorLike;
  return e?.cause?.code ? e.cause : e;
}

/** Unique-constraint names → stable client error codes. */
const UNIQUE_CODES: Record<string, [string, string]> = {
  items_item_code_unique: ['DUPLICATE_ITEM_CODE', 'An item with this code already exists'],
  items_name_key_unique: ['DUPLICATE_ITEM_NAME', 'An item with this name already exists (ignoring case, spacing and punctuation)'],
  uoms_code_unique: ['DUPLICATE_UOM_CODE', 'A unit of measure with this code already exists'],
  opening_balance_lines_bucket_unique: ['DUPLICATE_LINE', 'This batch already has a line for the same item, location, condition and tracking/funding details'],
  opening_balance_lines_serial_unique: ['DUPLICATE_SERIAL', 'This serial number is already listed for the item in this batch'],
  receipt_lines_serial_unique: ['DUPLICATE_SERIAL', 'This serial number is already listed for the item in this receipt'],
  document_references_entity_type_number_unique: ['DUPLICATE_DOCUMENT_REFERENCE', 'This document reference is already recorded for this transaction'],
  supplier_return_lines_receipt_line_unique: ['DUPLICATE_RETURN_LINE', 'This receipt line is already included in this supplier return'],
  item_categories_code_unique: ['DUPLICATE_CATEGORY_CODE', 'A category with this code already exists'],
  issue_headers_client_ref_unique: ['DUPLICATE_CLIENT_REF', 'This client reference was already used for another issue'],
  transfers_client_ref_unique: ['DUPLICATE_CLIENT_REF', 'This client reference was already used for another transfer'],
};

/** Check-constraint names → client messages (constraint names are never echoed). */
const CHECK_MESSAGES: Record<string, string> = {
  items_expiry_requires_batch: 'Expiry tracking requires batch/lot tracking',
  items_shelf_life_requires_expiry: 'A default shelf life requires expiry tracking',
  items_name_single_script: 'Item names may not mix Latin letters with Greek or Cyrillic letters',
  items_name_key_not_blank: 'Item name must contain letters or digits',
  items_item_code_format: 'Item code format is invalid',
  uoms_code_format: 'Unit code format is invalid',
  item_categories_code_format: 'Category code format is invalid',
  uoms_decimal_places_range: 'Decimal places must be between 0 and 6',
  opening_balance_lines_quantity_positive: 'Quantity must be greater than zero',
  opening_balance_lines_quantity_finite: 'Quantity must be a number',
  opening_balance_lines_quantity_scale: 'Quantity may have at most 6 decimal places (it is never rounded)',
  opening_balance_lines_quantity_range: 'Quantity is too large',
  opening_balance_lines_cost_currency_pair: 'Unit cost and currency must be given together',
  opening_balance_lines_cost_nonnegative: 'Unit cost cannot be negative',
  opening_balance_lines_currency_format: 'Currency must be a three-letter code',
  opening_balance_lines_refs_not_blank: 'Batch and serial references cannot be blank',
  receipt_lines_quantity_positive: 'Delivered quantity must be greater than zero',
  receipt_lines_quantity_finite: 'Delivered quantity must be a finite number',
  receipt_lines_quantity_scale: 'Delivered quantity may have at most 6 decimal places and is never rounded',
  receipt_lines_quantity_range: 'Delivered quantity is too large',
  receipt_lines_expected_quantity_positive: 'Expected/source-authorized quantity must be greater than zero',
  receipt_lines_expected_quantity_finite: 'Expected/source-authorized quantity must be a finite number',
  receipt_lines_expected_quantity_scale: 'Expected/source-authorized quantity may have at most 6 decimal places and is never rounded',
  receipt_lines_expected_quantity_range: 'Expected/source-authorized quantity is too large',
  receipt_lines_cost_currency_pair: 'Unit cost and currency must be given together',
  receipt_lines_cost_nonnegative: 'Unit cost cannot be negative or non-finite',
  receipt_lines_currency_format: 'Currency must be a three-letter code',
  receipt_lines_refs_not_blank: 'Batch and serial references cannot be blank',
  receipt_lines_outcomes_nonnegative: 'Inspection outcome quantities cannot be negative',
  receipt_lines_outcomes_finite: 'Inspection outcome quantities must be finite numbers',
  receipt_lines_outcomes_scale: 'Inspection outcome quantities may have at most 6 decimal places and are never rounded',
  document_references_entity_id_not_blank: 'Document entity reference is required',
  issue_headers_recipient_not_blank: 'Recipient name is required',
  issue_headers_custody_requires_custodian: 'Handing property to internal custody requires a named custodian',
  issue_lines_quantity_positive: 'Issue quantity must be greater than zero',
  issue_lines_quantity_finite: 'Issue quantity must be a finite number',
  issue_lines_quantity_scale: 'Issue quantity may have at most 6 decimal places and is never rounded',
  issue_lines_quantity_range: 'Issue quantity is too large',
  document_references_document_type_not_blank: 'Document type is required',
  document_references_document_number_not_blank: 'Document number/reference is required',
  receipt_headers_source_party_not_blank: 'Supplier/source name is required',
  supplier_return_lines_quantity_positive: 'Supplier-return quantity must be greater than zero',
  supplier_return_lines_quantity_finite: 'Supplier-return quantity must be finite',
  supplier_return_lines_quantity_scale: 'Supplier-return quantity may have at most 6 decimal places and is never rounded',
  supplier_return_lines_quantity_range: 'Supplier-return quantity is too large',
  requisitions_purpose_not_blank: 'Purpose/activity is required',
  requisition_lines_requested_quantity_positive: 'Requested quantity must be greater than zero',
  requisition_lines_requested_quantity_finite: 'Requested quantity must be a finite number',
  requisition_lines_requested_quantity_scale: 'Requested quantity may have at most 6 decimal places and is never rounded',
  requisition_lines_requested_quantity_range: 'Requested quantity is too large',
  transfers_purpose_not_blank: 'Purpose is required',
  transfers_distinct_warehouses: 'The destination must be a different warehouse from the source',
  transfer_lines_quantity_positive: 'Transfer quantity must be greater than zero',
  transfer_lines_quantity_finite: 'Transfer quantity must be a finite number',
  transfer_lines_quantity_scale: 'Transfer quantity may have at most 6 decimal places and is never rounded',
  transfer_lines_quantity_range: 'Transfer quantity is too large',
  transfer_receipt_lines_quantity_positive: 'Received quantity must be greater than zero',
  transfer_receipt_lines_quantity_finite: 'Received quantity must be a finite number',
  transfer_receipt_lines_quantity_scale: 'Received quantity may have at most 6 decimal places and is never rounded',
  transfer_receipt_lines_quantity_range: 'Received quantity is too large',
  requisition_lines_approved_quantity_valid: 'Approved quantity must be between zero and the requested quantity',
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
      return new HttpError(409, 'QUANTITY_PRECISION', controlMessage(e, 'Existing quantities use more decimal places than requested'));
    case 'BA009':
      return new HttpError(409, 'IMMUTABLE_CODE', 'Codes cannot be changed and records cannot be deleted');
    case 'BA010':
      return new HttpError(409, 'BASE_UOM_LOCKED', 'The base unit of measure cannot change once ledger entries exist');
    case 'BA011':
      return new HttpError(409, 'INACTIVE_REFERENCE', controlMessage(e, 'A referenced record is not active or not valid for this use'));
    case 'BA013':
      return new HttpError(409, 'IN_USE', 'The record is still used by active items or subcategories');
    case 'BA012':
      return new HttpError(409, 'CATEGORY_HIERARCHY', 'Subcategories must sit under an active top-level category');
    case 'BA014':
      return new HttpError(409, 'INVALID_STATE', controlMessage(e, 'The record is not in a state that allows this action'));
    case 'BA015':
      return new HttpError(403, 'MAKER_CHECKER', 'Segregation of duties: the approver may not be anyone who prepared, edited or submitted the document, and a transfer receiver may not be the person who dispatched it');
    case 'BA016':
      return new HttpError(409, 'DUPLICATE_OPENING', controlMessage(e, 'An opening balance already exists for this item and warehouse'));
    case 'BA017':
      return new HttpError(422, 'OPENING_BALANCE_INVALID', controlMessage(e, 'The opening balance batch is not valid'));
    case 'BA018':
      return new HttpError(409, 'STALE_VERSION', 'The batch was changed by someone else; reload and try again');
    case 'BA019':
      return new HttpError(409, 'TRACKING_LOCKED', 'Batch, expiry and serial tracking cannot change once the item has ledger entries');
    case 'BA020':
      return new HttpError(409, 'TRACKING_MISMATCH', controlMessage(e, 'The stock entry does not match the item\'s batch, expiry or serial tracking'));
    case 'BA021':
      return new HttpError(422, 'RECEIPT_INVALID', controlMessage(e, 'The receipt is not valid for this action'));
    case 'BA022':
      return new HttpError(422, 'SUPPLIER_RETURN_INVALID', controlMessage(e, 'The supplier return is not valid for this action'));
    case 'BA023':
      return new HttpError(409, 'REJECTED_STOCK_CONFLICT', controlMessage(e, 'The requested supplier return exceeds rejected stock remaining'));
    case 'BA024':
      return new HttpError(422, 'REQUISITION_INVALID', controlMessage(e, 'The requisition is not valid for this action'));
    case 'BA025':
      return new HttpError(409, 'INSUFFICIENT_AVAILABLE_TO_PROMISE', controlMessage(e, 'The approved quantity exceeds available-to-promise stock'));
    case 'BA026':
      return new HttpError(422, 'ISSUE_INVALID', controlMessage(e, 'The issue is not valid for this action'));
    case 'BA027':
      return new HttpError(409, 'ISSUE_STOCK_CONFLICT', controlMessage(e, 'The issue exceeds the approved quantity, the commitment or the usable stock available'));
    case 'BA029':
      return new HttpError(422, 'TRANSFER_INVALID', controlMessage(e, 'The transfer is not valid for this action'));
    case 'BA030':
      return new HttpError(409, 'TRANSFER_STOCK_CONFLICT', controlMessage(e, 'The transfer exceeds the stock available to reserve or dispatch'));
    case 'BA028':
      return new HttpError(409, 'IDEMPOTENCY_CONFLICT', controlMessage(e, 'This reference was already used with different content'));
    // Values PostgreSQL cannot store (integer overflow, a date or time out of range, NUL in text) are client errors.
    case '22003':
    case '22008':
    case '22021':
    case '22P05':
      return new HttpError(400, 'INVALID_VALUE', 'A value is out of range or contains characters that cannot be stored');
    case '23505': {
      const known = e.constraint ? UNIQUE_CODES[e.constraint] : undefined;
      return known ? new HttpError(409, known[0], known[1]) : new HttpError(409, 'DUPLICATE', 'A record with these values already exists');
    }
    case '23514':
      return new HttpError(400, 'CONSTRAINT_VIOLATION', (e.constraint && CHECK_MESSAGES[e.constraint]) || 'A value violates a data rule');
    case '23503':
      return new HttpError(400, 'INVALID_REFERENCE', 'A referenced record does not exist');
    default:
      return err;
  }
}
