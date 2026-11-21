export const productSorts = ['newest', 'price_asc', 'price_desc'] as const;

export type ProductSort = (typeof productSorts)[number];

export type ProductFilter = {
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
};

/**
 * Position of the last item on the previous page. The next page starts right after it.
 * `value` is the sort column of that item (price or created_at), `id` breaks ties.
 */
export type ProductCursor = {
  sort: ProductSort;
  value: string;
  id: string;
};

export type ProductListQuery = {
  filter: ProductFilter;
  sort: ProductSort;
  limit: number;
  after?: ProductCursor;
};
