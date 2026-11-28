import type { RequestErrorCode } from '../remote/types.ts'

/** A request failure with a stable code. Message text is diagnostic English; the Client owns user copy. */
export class RequestFailure extends Error {
  constructor(
    readonly code: RequestErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'RequestFailure'
  }
}
