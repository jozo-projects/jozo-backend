import { Router } from 'express'
import {
  claimInvoice,
  getMembershipMe,
  getMembershipConfig,
  upsertMembershipConfig,
  listMembers,
  getMemberDetail,
  grantMemberPoints
} from '~/controllers/membership.controller'
import { protect } from '~/middlewares/auth.middleware'
import { UserRole } from '~/constants/enum'
import { wrapRequestHandler } from '~/utils/handlers'

const membershipRouter = Router()

membershipRouter.get('/me', protect([]), wrapRequestHandler(getMembershipMe))
membershipRouter.post('/claim-invoice', wrapRequestHandler(claimInvoice))
membershipRouter.get('/config', protect([UserRole.Admin]), wrapRequestHandler(getMembershipConfig))
membershipRouter.put('/config', protect([UserRole.Admin]), wrapRequestHandler(upsertMembershipConfig))
membershipRouter.get('/members', protect([UserRole.Admin]), wrapRequestHandler(listMembers))
membershipRouter.get('/members/:id', protect([UserRole.Admin]), wrapRequestHandler(getMemberDetail))
membershipRouter.post('/members/:id/points', protect([UserRole.Admin]), wrapRequestHandler(grantMemberPoints))

export default membershipRouter
