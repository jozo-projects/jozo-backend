import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

const validateOrderQuantities = (order: unknown, fieldName: string) => {
  if (typeof order !== 'object' || order === null) {
    throw new Error(`${fieldName} must be an object`)
  }

  const normalizedOrder = order as { drinks?: unknown; snacks?: unknown }

  if (typeof normalizedOrder.drinks !== 'object' || normalizedOrder.drinks === null) {
    throw new Error(`${fieldName}.drinks must be an object`)
  }

  if (typeof normalizedOrder.snacks !== 'object' || normalizedOrder.snacks === null) {
    throw new Error(`${fieldName}.snacks must be an object`)
  }

  for (const [itemId, quantity] of Object.entries(normalizedOrder.drinks)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error('drink item id is invalid')
    }

    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`drink quantity for "${itemId}" must be an integer greater than or equal to 0`)
    }
  }

  for (const [itemId, quantity] of Object.entries(normalizedOrder.snacks)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error('snack item id is invalid')
    }

    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`snack quantity for "${itemId}" must be an integer greater than or equal to 0`)
    }
  }

  return true
}

export const submitCoffeeSessionCartValidator = validate(
  checkSchema({
    cart: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'cart is required'
      },
      custom: {
        options: (value) => validateOrderQuantities(value, 'cart')
      }
    }
  })
)
