import { Router } from 'express'
import {
  activateCoffeeSessionController,
  getCurrentCoffeeSessionController
} from '~/controllers/clientCoffeeSession.controller'
import { activateCoffeeSessionValidator, requireCoffeeSessionToken } from '~/middlewares/clientCoffeeSession.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const clientCoffeeSessionRouter = Router()

clientCoffeeSessionRouter.post(
  '/activate',
  activateCoffeeSessionValidator,
  wrapRequestHandler(activateCoffeeSessionController)
)
clientCoffeeSessionRouter.get('/me', requireCoffeeSessionToken, wrapRequestHandler(getCurrentCoffeeSessionController))

export default clientCoffeeSessionRouter
