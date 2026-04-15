import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  deleteCoffeeSessionOrderController,
  getCoffeeSessionOrderController,
  setCoffeeSessionOrderController
} from '~/controllers/coffeeSessionOrder.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  coffeeSessionOrderParamValidator,
  setCoffeeSessionOrderValidator
} from '~/middlewares/coffeeSessionOrder.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const coffeeSessionOrderRouter = Router()

coffeeSessionOrderRouter.get(
  '/:coffeeSessionId',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionOrderParamValidator,
  wrapRequestHandler(getCoffeeSessionOrderController)
)
coffeeSessionOrderRouter.put(
  '/:coffeeSessionId',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionOrderParamValidator,
  setCoffeeSessionOrderValidator,
  wrapRequestHandler(setCoffeeSessionOrderController)
)
coffeeSessionOrderRouter.delete(
  '/:coffeeSessionId',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionOrderParamValidator,
  wrapRequestHandler(deleteCoffeeSessionOrderController)
)

export default coffeeSessionOrderRouter
