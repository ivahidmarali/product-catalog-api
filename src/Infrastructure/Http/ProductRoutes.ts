import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ProductService } from '../../Application/Product/ProductService';
import { Product } from '../../Domain/Product/Product';
import {
  createProductBody,
  errorResponse,
  ifMatchHeaders,
  listProductsQuery,
  productIdParams,
  productPageResponse,
  productResponse,
  updateProductBody,
} from './ProductSchemas';
import { requireApiKey } from './requireApiKey';

// Reads are cheap to serve from a browser or CDN cache. Short TTLs keep stale data to a minute at most.
const ITEM_CACHE_CONTROL = 'public, max-age=60';
const LIST_CACHE_CONTROL = 'public, max-age=30';

export const productRoutes =
  (service: ProductService, writeApiKey: string): FastifyPluginAsync =>
  async (app) => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    // Anyone can browse the catalog. Changing it needs the API key.
    const writeGuard = requireApiKey(writeApiKey);
    const writeSecurity = [{ apiKey: [] }];

    routes.post(
      '/products',
      {
        schema: {
          tags: ['Products'],
          summary: 'Create a product',
          security: writeSecurity,
          body: createProductBody,
          response: { 201: productResponse, 400: errorResponse, 401: errorResponse, 409: errorResponse },
        },
        preHandler: writeGuard,
      },
      async (request, reply) => {
        const product = await service.create(request.body);

        return reply
          .code(201)
          .header('location', `/products/${product.id}`)
          .header('etag', etagFor(product))
          .send(toResponse(product));
      },
    );

    routes.get(
      '/products',
      {
        schema: {
          tags: ['Products'],
          summary: 'List products',
          description:
            'Filter by category and price range. Results are paginated with a cursor: pass `nextCursor` from one page as `cursor` for the next. Keep the same filters and sort between pages.',
          querystring: listProductsQuery,
          response: { 200: productPageResponse, 400: errorResponse },
        },
      },
      async (request, reply) => {
        const { category, minPriceCents, maxPriceCents, sort, limit, cursor } = request.query;
        const page = await service.list({ filter: { category, minPriceCents, maxPriceCents }, sort, limit, cursor });

        return reply.header('cache-control', LIST_CACHE_CONTROL).send({
          data: page.items.map(toResponse),
          pagination: { limit, nextCursor: page.nextCursor },
        });
      },
    );

    routes.get(
      '/products/:id',
      {
        schema: {
          tags: ['Products'],
          summary: 'Get a product',
          params: productIdParams,
          response: { 200: productResponse, 304: z.null(), 400: errorResponse, 404: errorResponse },
        },
      },
      async (request, reply) => {
        const product = await service.get(request.params.id);
        const etag = etagFor(product);
        reply.header('etag', etag).header('cache-control', ITEM_CACHE_CONTROL);

        if (request.headers['if-none-match'] === etag) {
          return reply.code(304).send(null);
        }

        return reply.send(toResponse(product));
      },
    );

    routes.patch(
      '/products/:id',
      {
        schema: {
          tags: ['Products'],
          summary: 'Update some fields of a product',
          security: writeSecurity,
          params: productIdParams,
          headers: ifMatchHeaders,
          body: updateProductBody,
          response: {
            200: productResponse,
            400: errorResponse,
            401: errorResponse,
            404: errorResponse,
            409: errorResponse,
            412: errorResponse,
          },
        },
        preHandler: writeGuard,
      },
      async (request, reply) => {
        const expectedVersion = versionFromIfMatch(request.headers['if-match'], reply);
        if (expectedVersion === false) {
          return reply;
        }
        const product = await service.update(request.params.id, request.body, expectedVersion);

        return reply.header('etag', etagFor(product)).send(toResponse(product));
      },
    );

    routes.delete(
      '/products/:id',
      {
        schema: {
          tags: ['Products'],
          summary: 'Delete a product',
          security: writeSecurity,
          params: productIdParams,
          headers: ifMatchHeaders,
          response: { 204: z.null(), 400: errorResponse, 401: errorResponse, 404: errorResponse, 412: errorResponse },
        },
        preHandler: writeGuard,
      },
      async (request, reply) => {
        const expectedVersion = versionFromIfMatch(request.headers['if-match'], reply);
        if (expectedVersion === false) {
          return reply;
        }
        await service.delete(request.params.id, expectedVersion);

        return reply.code(204).send(null);
      },
    );
  };

const etagFor = (product: Product): string => `"v${product.version}"`;

/**
 * Turns an If-Match header into the version the client expects.
 * undefined: no header or `*`, so no check. false: the header can never match, a 412 was sent.
 */
const versionFromIfMatch = (header: string | undefined, reply: FastifyReply): number | undefined | false => {
  if (header === undefined || header.trim() === '*') {
    return undefined;
  }

  const match = /^(?:W\/)?"v(\d{1,9})"$/.exec(header.trim());
  if (!match?.[1]) {
    reply
      .code(412)
      .send({ error: { code: 'PRECONDITION_FAILED', message: 'If-Match does not match the product ETag' } });
    return false;
  }

  return Number(match[1]);
};

const toResponse = (product: Product): z.infer<typeof productResponse> => ({
  ...product,
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});
