import { checkSchema } from 'express-validator'
import { assertValidFnbOrderPayload } from '~/utils/validateFnbOrderPayload'
import { validate } from '~/utils/validation'

export const submitCoffeeSessionCartValidator = validate(
  checkSchema({
    cart: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'cart is required'
      },
      custom: {
        options: (value: unknown) => {
          assertValidFnbOrderPayload(value, 'cart', { requireNonEmpty: true })
          return true
        }
      }
    }
  })
)
