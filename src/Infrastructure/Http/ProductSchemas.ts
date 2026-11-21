import { z } from 'zod';
import { productSorts } from '../../Domain/Product/ProductListQuery';

const MAX_PRICE_CENTS = 2_147_483_647; // Postgres integer limit

// Query strings arrive as text. An empty value (`?minPriceCents=`) means "not set", not 0.
const optionalInt = (schema: z.ZodNumber): z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown> =>
  z.preprocess((value) => (value === '' || value === undefined ? undefined : Number(value)), schema.optional());

const priceCents = z.number().int().min(0).max(MAX_PRICE_CENTS);

// Postgres text columns cannot store the null character, so reject it here instead of failing in the database.
const text = (min: number, max: number): z.ZodEffects<z.ZodString> =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !value.includes('\u0000'), { message: 'Must not contain null characters' });

export const productIdParams = z.object({
  id: z.string().uuid(),
});

export const createProductBody = z
  .object({
    sku: text(1, 64),
    name: text(1, 200),
    description: text(0, 5000).default(''),
    category: text(1, 100),
    priceCents: priceCents.describe('Price in euro cents, e.g. 1999 for EUR 19.99'),
  })
  .strict();

export const updateProductBody = z
  .object({
    sku: text(1, 64),
    name: text(1, 200),
    description: text(0, 5000),
    category: text(1, 100),
    priceCents,
  })
  .partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, { message: 'Provide at least one field to update' });

export const listProductsQuery = z
  .object({
    category: text(1, 100).optional(),
    minPriceCents: optionalInt(priceCents),
    maxPriceCents: optionalInt(priceCents),
    sort: z.enum(productSorts).default('newest'),
    limit: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : Number(value)),
      z.number().int().min(1).max(100).default(20),
    ),
    cursor: z.string().min(1).optional(),
  })
  .refine(
    ({ minPriceCents, maxPriceCents }) =>
      minPriceCents === undefined || maxPriceCents === undefined || minPriceCents <= maxPriceCents,
    { message: 'minPriceCents must be less than or equal to maxPriceCents', path: ['minPriceCents'] },
  );

export const ifMatchHeaders = z.object({
  'if-match': z.string().optional().describe('ETag from a previous read, e.g. "v3". Rejects the write if it is stale.'),
});

export const productResponse = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  priceCents: z.number().int(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productPageResponse = z.object({
  data: z.array(productResponse),
  pagination: z.object({
    limit: z.number().int(),
    nextCursor: z.string().nullable().describe('Pass as `cursor` to get the next page. null on the last page.'),
  }),
});

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
