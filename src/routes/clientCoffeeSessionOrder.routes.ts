import { Router } from 'express'
import {
  getCurrentCoffeeSessionOrderController,
  submitCoffeeSessionCartController
} from '~/controllers/clientCoffeeSessionOrder.controller'
import { requireCoffeeSessionToken } from '~/middlewares/clientCoffeeSession.middleware'
import { submitCoffeeSessionCartValidator } from '~/middlewares/clientCoffeeSessionOrder.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const clientCoffeeSessionOrderRouter = Router()

clientCoffeeSessionOrderRouter.get('/me', requireCoffeeSessionToken, wrapRequestHandler(getCurrentCoffeeSessionOrderController))
clientCoffeeSessionOrderRouter.post(
  '/me/submit-cart',
  requireCoffeeSessionToken,
  submitCoffeeSessionCartValidator,
  wrapRequestHandler(submitCoffeeSessionCartController)
)

export default clientCoffeeSessionOrderRouter
