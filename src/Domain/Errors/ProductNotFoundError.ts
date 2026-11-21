import { DomainError } from './DomainError';

export class ProductNotFoundError extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor(id: string) {
    super(`Product ${id} was not found`);
  }
}
