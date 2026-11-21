import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { DomainError } from '../../Domain/Errors/DomainError';
import { DuplicateSkuError } from '../../Domain/Errors/DuplicateSkuError';
import { InvalidCursorError } from '../../Domain/Errors/InvalidCursorError';
import { ProductNotFoundError } from '../../Domain/Errors/ProductNotFoundError';
import { VersionConflictError } from '../../Domain/Errors/VersionConflictError';

const STATUS_BY_ERROR = new Map<new (...args: never[]) => DomainError, number>([
  [ProductNotFoundError, 404],
  [DuplicateSkuError, 409],
  // The client sent If-Match with a stale version, so this is a failed precondition.
  [VersionConflictError, 412],
  [InvalidCursorError, 400],
]);

export const errorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid',
        details: error.validation.map((issue) => ({
          path: issue.instancePath || issue.params.issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  if (error instanceof DomainError) {
    const status = STATUS_BY_ERROR.get(error.constructor as new (...args: never[]) => DomainError) ?? 400;
    return reply.code(status).send({ error: { code: error.code, message: error.message } });
  }

  // Fastify's own client errors, for example a body that is not valid JSON.
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } });
  }

  request.log.error({ err: error }, 'Unhandled error');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
