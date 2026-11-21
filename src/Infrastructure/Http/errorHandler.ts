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

  // Client errors raised by Fastify itself (invalid JSON, empty body, body too large) or by our routes (412).
  // Fastify's internal codes like FST_ERR_CTP_EMPTY_JSON_BODY are not part of our API, so they become BAD_REQUEST.
  if (error.statusCode && error.statusCode < 500) {
    const code = !error.code || error.code.startsWith('FST_') ? 'BAD_REQUEST' : error.code;
    return reply.code(error.statusCode).send({ error: { code, message: error.message } });
  }

  request.log.error({ err: error }, 'Unhandled error');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
