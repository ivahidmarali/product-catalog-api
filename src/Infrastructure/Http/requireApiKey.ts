import { createHash, timingSafeEqual } from 'node:crypto';
import { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Guards write endpoints with a shared API key in the `x-api-key` header.
 * Hashing both sides first gives equal-length buffers, so timingSafeEqual can compare them without leaking the key length.
 */
export const requireApiKey = (expectedKey: string): preHandlerHookHandler => {
  const expected = digest(expectedKey);

  return (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void => {
    const provided = request.headers['x-api-key'];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
      void reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A valid x-api-key header is required' } });
      return;
    }
    done();
  };
};
