import { DomainError } from './DomainError';

export class VersionConflictError extends DomainError {
  readonly code = 'VERSION_CONFLICT';

  constructor(id: string) {
    super(`Product ${id} was changed by someone else. Fetch it again and retry.`);
  }
}
