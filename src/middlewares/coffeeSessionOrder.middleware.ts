import { checkSchema } from 'express-validator'
import { assertValidFnbOrderPayload } from '~/utils/validateFnbOrderPayload'
import { validate } from '~/utils/validation'

export const coffeeSessionOrderParamValidator = validate(
  checkSchema({
    coffeeSessionId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'coffeeSessionId is required'
      },
      isMongoId: {
        errorMessage: 'coffeeSessionId must be a valid MongoId'
      }
    }
  })
)

export const setCoffeeSessionOrderValidator = validate(
  checkSchema({
    order: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'order is required'
      },
      custom: {
        options: (value: unknown) => {
          assertValidFnbOrderPayload(value, 'order')
          return true
        }
      }
    }
  })
)
