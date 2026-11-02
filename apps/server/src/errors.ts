import type { AckError } from '@hexhaven/shared';

/** An expected, client-facing failure. `code` is stable and machine readable. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toAck(): AckError {
    return { code: this.code, message: this.message };
  }
}

export const fail = (code: string, message: string, httpStatus?: number): never => {
  throw new AppError(code, message, httpStatus);
};
