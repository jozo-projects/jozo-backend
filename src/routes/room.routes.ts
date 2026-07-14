import { Router } from 'express'
import multer from 'multer'
import { UserRole } from '~/constants/enum'
import {
  addRoomController,
  deleteRoomController,
  getRoomController,
  getRoomByRoomIdController,
  getRoomsController,
  getDeviceConnectionsController,
  solveRequestController,
  solveOrderController,
  turnOffVideosController,
  updateRoomController
} from '~/controllers/room.controller'
import { protect } from '~/middlewares/auth.middleware'
import { checkRoomExists, checkRoomIdExists, validateFiles } from '~/middlewares/room.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const roomRouter = Router()

const upload = multer({ storage: multer.memoryStorage() })

/**
 * @description Add room
 * @path /rooms/add-room
 * @method POST
 * @body multipart/form-data
 * Fields: roomId, roomName, roomType, maxCapacity, status, pricePerTime, equipment, description
 * @author QuangDoo
 */
roomRouter.post(
  '/add-room',
  protect([UserRole.Admin]),
  validateFiles,
  checkRoomExists,
  checkRoomIdExists,
  // addRoomValidator,
  upload.array('images', 5),
  wrapRequestHandler(addRoomController)
)

/**
 * @description Lấy tất cả phòng
 * @path /rooms
 * @method GET
 * @author QuangDoo
 */
roomRouter.get('/', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getRoomsController))

/**
 * @description Snapshot thiết bị control/video đang kết nối theo phòng
 * @path /rooms/device-connections
 * @method GET
 */
roomRouter.get(
  '/device-connections',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(getDeviceConnectionsController)
)

/**
 * @description Lấy phòng theo id
 * @path /rooms/:id
 * @method GET
 * @author QuangDoo
 */
roomRouter.get('/:id', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getRoomController))

/**
 * @description Lấy phòng theo roomId
 * @path /rooms/by-room-id/:roomId
 * @method GET
 * @author QuangDoo
 */
roomRouter.get(
  '/by-room-id/:roomId',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(getRoomByRoomIdController)
)

/**
 * @description turn off all videos in room
 * @path /rooms/:id/turn-off-videos
 * @method POST
 * @author QuangDoo
 */
roomRouter.post(
  '/turn-off-videos',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(turnOffVideosController)
)

/**
 * @description Cập nhật phòng
 * @path /rooms/:id
 * @method PUT
 * @author QuangDoo
 */
roomRouter.put('/:id', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(updateRoomController))

/**
 * @description Xóa phòng
 * @path /rooms/:id
 * @method DELETE
 * @author QuangDoo
 */
roomRouter.delete('/:id', protect([UserRole.Admin]), wrapRequestHandler(deleteRoomController))

/**
 * @description solve request from client to admin with roomId and request
 * @path /rooms/:id/resolve-request
 * @method POST
 * @author QuangDoo
 */
roomRouter.post(
  '/:id/resolve-request',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(solveRequestController)
)

/**
 * @description Mark order as served
 * @path /rooms/:roomId/orders/:orderId/serve
 * @method POST
 * @author Assistant
 */
roomRouter.post(
  '/:roomId/orders/:orderId/serve',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(solveOrderController)
)

export default roomRouter
