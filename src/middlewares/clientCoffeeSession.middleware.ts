import { NextFunction, Request, Response } from 'express'
import { TokenType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { AUTH_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { CoffeeSessionJwtPayload } from '~/models/schemas/JWT.schema'
import clientCoffeeSessionService from '~/services/clientCoffeeSession.service'
import { verifyToken } from '~/utils/jwt'
import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const activateCoffeeSessionValidator = validate(
  checkSchema({
    tableId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'tableId is required'
      },
      isMongoId: {
        errorMessage: 'tableId must be a valid MongoId'
      }
    },
    pin: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'pin is required'
      },
      isString: {
        errorMessage: 'pin must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 6, max: 6 },
        errorMessage: 'pin must be exactly 6 characters'
      },
      isNumeric: {
        errorMessage: 'pin must be numeric'
      }
    }
  })
)

export const requireCoffeeSessionToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new ErrorWithStatus({
        message: AUTH_MESSAGES.ACCESS_TOKEN_NOT_EMPTY,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    )
  }

  try {
    const decoded = await verifyToken<CoffeeSessionJwtPayload>(authHeader.split(' ')[1])

    if (
      decoded.token_type !== TokenType.CoffeeSessionToken ||
      !decoded.coffee_session_id ||
      !decoded.table_id
    ) {
      throw new Error()
    }

    const session = await clientCoffeeSessionService.getCurrentCoffeeSession(decoded)
    req.decoded_coffee_session_authorization = decoded
    req.coffee_session = session

    next()
  } catch {
    next(
      new ErrorWithStatus({
        message: 'Invalid coffee session token',
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    )
  }
}
