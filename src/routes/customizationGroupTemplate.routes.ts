import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  createCustomizationTemplateController,
  deleteCustomizationTemplateController,
  listCustomizationTemplatesController,
  updateCustomizationTemplateController,
  validateCustomizationTemplateRefsController
} from '~/controllers/customizationGroupTemplate.controller'
import { protect } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const customizationGroupTemplateRouter = Router()

customizationGroupTemplateRouter.get(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(listCustomizationTemplatesController)
)
customizationGroupTemplateRouter.post(
  '/',
  protect([UserRole.Admin]),
  wrapRequestHandler(createCustomizationTemplateController)
)
customizationGroupTemplateRouter.post(
  '/validate-refs',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(validateCustomizationTemplateRefsController)
)
customizationGroupTemplateRouter.put(
  '/:templateKey',
  protect([UserRole.Admin]),
  wrapRequestHandler(updateCustomizationTemplateController)
)
customizationGroupTemplateRouter.delete(
  '/:templateKey',
  protect([UserRole.Admin]),
  wrapRequestHandler(deleteCustomizationTemplateController)
)

export default customizationGroupTemplateRouter
