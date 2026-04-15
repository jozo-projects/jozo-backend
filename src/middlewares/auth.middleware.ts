import { NextFunction, Request, Response } from 'express'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { AUTH_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'

export const protect = (roles: UserRole[]) => async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization']

  let token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  } else {
    return next(
      new ErrorWithStatus({
        message: AUTH_MESSAGES.ACCESS_TOKEN_NOT_EMPTY,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    )
  }

  try {
    const decoded = await verifyToken(token)

    req.decoded_authorization = decoded

    const user = await usersServices.getUserById(decoded.user_id)

    // Kiểm tra quyền hạn (nếu roles được cung cấp)
    if (roles.length && !roles.includes(user?.role || UserRole.Admin)) {
      return next(
        new ErrorWithStatus({
          message: AUTH_MESSAGES.INSUFFICIENT_PRIVILEGES,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    next()
  } catch {
    next(
      new ErrorWithStatus({
        message: AUTH_MESSAGES.INSUFFICIENT_PRIVILEGES,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    )
  }
}
