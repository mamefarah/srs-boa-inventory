import { z } from 'zod';

/** Positive database integer id supplied as a string (query/path). */
export const idParam = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/, 'must be a positive integer')
  .transform(Number)
  .refine((n) => n <= 2_147_483_647, 'out of range');

export const limitParam = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/, 'must be a positive integer')
    .transform(Number)
    .refine((n) => n <= max, `must be <= ${max}`)
    .optional()
    .transform((n) => n ?? fallback);

export const offsetParam = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,6})$/, 'must be a non-negative integer')
  .transform(Number)
  .optional()
  .transform((n) => n ?? 0);

/** Invisible/format characters (zero-width, bidi controls, soft hyphen, BOM). */
export const INVISIBLE_RE = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5]/gu;

/** Reason text required for administrative changes: at least 5 visible characters. */
export const reasonField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.replace(INVISIBLE_RE, '').replace(/\s/gu, '').length >= 5, 'reason must contain at least 5 visible characters');

/** Display name normalisation: NFKC, invisible characters removed, Unicode spaces folded. */
export const normalizedName = (max: number) =>
  z
    .string()
    .transform((v) => v.normalize('NFKC').replace(INVISIBLE_RE, '').replace(/\s+/gu, ' ').trim())
    .pipe(z.string().min(1).max(max));
