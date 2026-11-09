import { Router } from 'express'
import { getClientFnbOrderByRoomSchedule, submitClientCart } from '~/controllers/roomScheduleFnb.controller'
import { wrapRequestHandler } from '~/utils/handlers'
import { roomCommerceAuthorization } from '~/middlewares/roomCommerceAuthorization'

const clientFnbRouter = Router()

// ============================================
// CLIENT FNB ROUTES (optional room device/staff authorization)
// ============================================

// GET current order - Xem order đã đặt (bao gồm cả món admin thêm)
clientFnbRouter.get('/orders/room/:roomId', roomCommerceAuthorization('roomId'), wrapRequestHandler(getClientFnbOrderByRoomSchedule))

// SUBMIT cart - Gửi local cart, backend sẽ MERGE vào order hiện tại
clientFnbRouter.post('/orders/room/:roomId/submit-cart', roomCommerceAuthorization('roomId'), wrapRequestHandler(submitClientCart))

export default clientFnbRouter
