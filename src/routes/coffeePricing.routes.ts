import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import { getCoffeePricingController, upsertCoffeePricingController } from '~/controllers/coffeePricing.controller'
import { protect } from '~/middlewares/auth.middleware'
import { upsertCoffeePricingValidator } from '~/middlewares/coffeePricing.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const coffeePricingRouter = Router()

coffeePricingRouter.get('/', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getCoffeePricingController))
coffeePricingRouter.put(
  '/',
  protect([UserRole.Admin]),
  upsertCoffeePricingValidator,
  wrapRequestHandler(upsertCoffeePricingController)
)

export default coffeePricingRouter
