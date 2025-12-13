import { Router } from 'express'
import multer from 'multer'
import { UserRole } from '~/constants/enum'
import {
  claimGiftForSchedule,
  createGift,
  deleteGift,
  getGiftById,
  getGiftForRoom,
  listGifts,
  updateGift
} from '~/controllers/gift.controller'
import { claimGiftValidator, getRoomGiftValidator } from '~/middlewares/gift.middleware'
import { protect } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const giftRouter = Router()
const upload = multer({ storage: multer.memoryStorage() })

giftRouter.get('/', protect([UserRole.Admin]), wrapRequestHandler(listGifts))
// Endpoint public để app khác chỉ xem danh sách quà
giftRouter.get('/public', wrapRequestHandler(listGifts))
giftRouter.get('/:id', protect([UserRole.Admin]), wrapRequestHandler(getGiftById))
giftRouter.post(
  '/',
  protect([UserRole.Admin]),
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ]),
  wrapRequestHandler(createGift)
)
giftRouter.patch(
  '/:id',
  protect([UserRole.Admin]),
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ]),
  wrapRequestHandler(updateGift)
)
giftRouter.delete('/:id', protect([UserRole.Admin]), wrapRequestHandler(deleteGift))

// Endpoint cho box mở quà (không yêu cầu auth nếu cần cho thiết bị; có thể thêm auth nếu có cơ chế riêng)
giftRouter.post('/claim', claimGiftValidator, wrapRequestHandler(claimGiftForSchedule))
giftRouter.get('/room/:roomIndex', getRoomGiftValidator, wrapRequestHandler(getGiftForRoom))

export default giftRouter
