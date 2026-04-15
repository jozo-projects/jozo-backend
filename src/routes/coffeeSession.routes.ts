import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  createCoffeeSessionController,
  getCoffeeSessionByIdController,
  getCoffeeSessionsController,
  updateCoffeeSessionController
} from '~/controllers/coffeeSession.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  coffeeSessionIdParamValidator,
  coffeeSessionListQueryValidator,
  createCoffeeSessionValidator,
  updateCoffeeSessionValidator
} from '~/middlewares/coffeeSession.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const coffeeSessionRouter = Router()

coffeeSessionRouter.post(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  createCoffeeSessionValidator,
  wrapRequestHandler(createCoffeeSessionController)
)
coffeeSessionRouter.get(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionListQueryValidator,
  wrapRequestHandler(getCoffeeSessionsController)
)
coffeeSessionRouter.get(
  '/:id',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionIdParamValidator,
  wrapRequestHandler(getCoffeeSessionByIdController)
)
coffeeSessionRouter.patch(
  '/:id',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionIdParamValidator,
  updateCoffeeSessionValidator,
  wrapRequestHandler(updateCoffeeSessionController)
)

export default coffeeSessionRouter
