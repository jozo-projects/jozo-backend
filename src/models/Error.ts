import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { USER_MESSAGES } from '~/constants/messages'

export interface ErrorsType {
  [key: string]: {
    msg: string
    [key: string]: any
  }
}

export class ErrorWithStatus extends Error {
  status: number

  constructor({ message, status }: { message: string; status: number }) {
    super(message)
    this.status = status
    this.name = 'ErrorWithStatus'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class EntityError extends ErrorWithStatus {
  errors: ErrorsType
  constructor({
    message = USER_MESSAGES.INVALID_FIELD,
    errors
  }: {
    message?: string
    status?: number
    errors: ErrorsType
  }) {
    super({ message, status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY })
    this.name = 'EntityError'
    this.errors = errors
  }
}
