CREATE TABLE products (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  category    text        NOT NULL,
  price_cents integer     NOT NULL CHECK (price_cents >= 0),
  version     integer     NOT NULL DEFAULT 1,
  -- Millisecond precision so a JavaScript Date in a cursor matches the stored value exactly.
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at  timestamptz(3) NOT NULL DEFAULT now()
);

-- Every list query is "filter, then sort, then take the next page".
-- Each index matches one sort order, with and without the category filter,
-- and ends with id so keyset pagination has a unique, stable position.
CREATE INDEX products_category_price_idx   ON products (category, price_cents, id);
CREATE INDEX products_price_idx            ON products (price_cents, id);
CREATE INDEX products_category_created_idx ON products (category, created_at, id);
CREATE INDEX products_created_idx          ON products (created_at, id);
