import { InvalidCursorError } from '../../src/Domain/Errors/InvalidCursorError';
import { decodeCursor, encodeCursor } from '../../src/Domain/Product/ProductCursorCodec';

const ID = '0b6c3f9e-6d0a-4d5e-9a57-2f1f0c4d9e11';
const encodeRaw = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('ProductCursorCodec', () => {
  it('decodes what it encodes', () => {
    const cursor = { sort: 'price_asc' as const, value: '1999', id: ID };

    expect(decodeCursor(encodeCursor(cursor), 'price_asc')).toEqual(cursor);
  });

  it('rejects a cursor made for another sort order', () => {
    const cursor = encodeCursor({ sort: 'price_asc', value: '1999', id: ID });

    expect(() => decodeCursor(cursor, 'newest')).toThrow('different sort order');
  });

  it.each([
    ['not base64 json', 'not-a-cursor'],
    ['wrong shape', encodeRaw({ foo: 'bar' })],
    ['unknown sort', encodeRaw({ sort: 'name', value: 'a', id: ID })],
    ['id that is not a uuid', encodeRaw({ sort: 'price_asc', value: '1', id: '1; DROP TABLE products' })],
    ['price that is not a number', encodeRaw({ sort: 'price_asc', value: 'abc', id: ID })],
    ['price above the integer limit', encodeRaw({ sort: 'price_asc', value: '9999999999', id: ID })],
  ])('rejects %s', (_case, raw) => {
    expect(() => decodeCursor(raw, 'price_asc')).toThrow(InvalidCursorError);
  });

  it.each([['yesterday'], ['2026'], ['2026-01-01'], ['2026-13-45T99:99:99.999Z']])(
    'rejects the date cursor value %s',
    (value) => {
      const raw = encodeRaw({ sort: 'newest', value, id: ID });

      expect(() => decodeCursor(raw, 'newest')).toThrow(InvalidCursorError);
    },
  );

  it('accepts a date cursor in the format the API produces', () => {
    const cursor = { sort: 'newest' as const, value: new Date().toISOString(), id: ID };

    expect(decodeCursor(encodeCursor(cursor), 'newest')).toEqual(cursor);
  });
});
