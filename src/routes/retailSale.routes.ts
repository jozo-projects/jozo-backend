import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import { protect } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/utils/handlers'
import {
  createRetailSale,
  getRetailProducts,
  getRetailSales,
  printRetailPreview,
  printRetailSale
} from '~/controllers/retailSale.controller'

const retailSaleRouter = Router()
const staffOrAdmin = protect([UserRole.Staff, UserRole.Admin])

retailSaleRouter.get('/products', staffOrAdmin, wrapRequestHandler(getRetailProducts))
retailSaleRouter.get('/', staffOrAdmin, wrapRequestHandler(getRetailSales))
retailSaleRouter.post('/print-preview', staffOrAdmin, wrapRequestHandler(printRetailPreview))
retailSaleRouter.post('/:id/print', staffOrAdmin, wrapRequestHandler(printRetailSale))
retailSaleRouter.post('/', staffOrAdmin, wrapRequestHandler(createRetailSale))

export default retailSaleRouter
