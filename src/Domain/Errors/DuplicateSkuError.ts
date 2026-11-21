import { DomainError } from './DomainError';

export class DuplicateSkuError extends DomainError {
  readonly code = 'DUPLICATE_SKU';

  constructor(sku: string) {
    super(`A product with SKU ${sku} already exists`);
  }
}
