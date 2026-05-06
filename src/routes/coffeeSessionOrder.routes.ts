import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  deleteCoffeeSessionOrderController,
  getCoffeeSessionOrderController,
  markCoffeeSessionOrderBatchServedController,
  setCoffeeSessionOrderController
} from '~/controllers/coffeeSessionOrder.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  coffeeSessionOrderParamValidator,
  markCoffeeSessionOrderBatchServedValidator,
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
coffeeSessionOrderRouter.patch(
  '/:coffeeSessionId/batches/:batchId/served',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeSessionOrderParamValidator,
  markCoffeeSessionOrderBatchServedValidator,
  wrapRequestHandler(markCoffeeSessionOrderBatchServedController)
)

export default coffeeSessionOrderRouter
