import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  createCoffeeTableController,
  deleteCoffeeTableController,
  getCoffeeTableByIdController,
  getCoffeeTablesController,
  updateCoffeeTableController
} from '~/controllers/coffeeTable.controller'
import {
  coffeeTableIdParamValidator,
  coffeeTableListQueryValidator,
  createCoffeeTableValidator,
  updateCoffeeTableValidator
} from '~/middlewares/coffeeTable.middleware'
import { protect } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const coffeeTableRouter = Router()

coffeeTableRouter.post(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  createCoffeeTableValidator,
  wrapRequestHandler(createCoffeeTableController)
)
coffeeTableRouter.get(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeTableListQueryValidator,
  wrapRequestHandler(getCoffeeTablesController)
)
coffeeTableRouter.get(
  '/:id',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeTableIdParamValidator,
  wrapRequestHandler(getCoffeeTableByIdController)
)
coffeeTableRouter.put(
  '/:id',
  protect([UserRole.Admin, UserRole.Staff]),
  coffeeTableIdParamValidator,
  updateCoffeeTableValidator,
  wrapRequestHandler(updateCoffeeTableController)
)
coffeeTableRouter.delete(
  '/:id',
  protect([UserRole.Admin]),
  coffeeTableIdParamValidator,
  wrapRequestHandler(deleteCoffeeTableController)
)

export default coffeeTableRouter
