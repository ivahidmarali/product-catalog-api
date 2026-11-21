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

  it('rejects a date cursor that is not a date', () => {
    const raw = encodeRaw({ sort: 'newest', value: 'yesterday', id: ID });

    expect(() => decodeCursor(raw, 'newest')).toThrow(InvalidCursorError);
  });
});
