import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { EntityError, ErrorWithStatus } from '~/models/Error'

export const defaultErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof EntityError) {
    return res.status(err.status).json({
      message: err.message,
      errors: err.errors
    })
  }

  if (err instanceof ErrorWithStatus) {
    return res.status(err.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: err.message
    })
  }

  console.error('[defaultErrorHandler]', err)
  return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
    message: err?.message || 'Internal server error'
  })
}
