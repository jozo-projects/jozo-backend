import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

const validateOrderQuantities = (order: any) => {
  if (typeof order !== 'object' || order === null) {
    throw new Error('order must be an object')
  }

  if (typeof order.drinks !== 'object' || order.drinks === null) {
    throw new Error('order.drinks must be an object')
  }

  if (typeof order.snacks !== 'object' || order.snacks === null) {
    throw new Error('order.snacks must be an object')
  }

  for (const [itemId, quantity] of Object.entries(order.drinks)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error('drink item id is invalid')
    }

    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`drink quantity for "${itemId}" must be an integer greater than or equal to 0`)
    }
  }

  for (const [itemId, quantity] of Object.entries(order.snacks)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error('snack item id is invalid')
    }

    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`snack quantity for "${itemId}" must be an integer greater than or equal to 0`)
    }
  }

  return true
}

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
        options: validateOrderQuantities
      }
    }
  })
)
