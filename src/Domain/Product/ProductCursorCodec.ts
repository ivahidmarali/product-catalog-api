import { InvalidCursorError } from '../Errors/InvalidCursorError';
import { ProductCursor, ProductSort, productSorts } from './ProductListQuery';

/**
 * Cursors are opaque to clients: base64url of a small JSON object.
 * Clients should only pass back what they got in `nextCursor`.
 */
export const encodeCursor = (cursor: ProductCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

export const decodeCursor = (raw: string, expectedSort: ProductSort): ProductCursor => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }

  if (!isCursor(parsed)) {
    throw new InvalidCursorError();
  }

  // A cursor from a price-sorted page means nothing for a newest-first page.
  if (parsed.sort !== expectedSort) {
    throw new InvalidCursorError('Cursor was created for a different sort order');
  }

  return parsed;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE_PATTERN = /^\d{1,10}$/;

// The cursor ends up in SQL parameters, so a tampered one has to fail here with a 400, not in Postgres with a 500.
const isCursor = (value: unknown): value is ProductCursor => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sort !== 'string' ||
    !(productSorts as readonly string[]).includes(candidate.sort) ||
    typeof candidate.value !== 'string' ||
    typeof candidate.id !== 'string' ||
    !UUID_PATTERN.test(candidate.id)
  ) {
    return false;
  }

  return candidate.sort === 'newest'
    ? !Number.isNaN(Date.parse(candidate.value))
    : PRICE_PATTERN.test(candidate.value) && Number(candidate.value) <= 2_147_483_647;
};
