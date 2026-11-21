import { DomainError } from './DomainError';

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';

  constructor(message = 'Cursor is invalid') {
    super(message);
  }
}
