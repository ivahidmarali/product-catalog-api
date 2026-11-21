import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ProductService } from '../../Application/Product/ProductService';
import { errorHandler } from './errorHandler';
import { productRoutes } from './ProductRoutes';

export type AppDependencies = {
  productService: ProductService;
  /** Resolves when the database is reachable. */
  checkDatabase: () => Promise<void>;
  logger?: FastifyServerOptions['logger'];
};

export const buildApp = async ({
  productService,
  checkDatabase,
  logger = false,
}: AppDependencies): Promise<FastifyInstance> => {
  const app = Fastify({ logger });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'ROUTE_NOT_FOUND', message: `Route ${request.method} ${request.url} not found` } }),
  );

  await app.register(swagger, {
    openapi: {
      info: { title: 'Product Catalog API', version: '1.0.0' },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', { schema: { hide: true } }, async (_request, reply) => {
    try {
      await checkDatabase();
      return reply.send({ status: 'ok' });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  await app.register(productRoutes(productService));

  return app;
};
