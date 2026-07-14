import { NextFunction, Request, Response } from 'express'
import { type ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ROOM_MESSAGES } from '~/constants/messages'
import { IAddRoomRequestBody } from '~/models/requests/Room.request'
import { roomServices } from '~/services/room.service'
import { roomDevicePresenceService } from '~/services/roomDevicePresence.service'
import databaseService from '~/services/database.service'
import { RoomStatus, RoomType } from '~/constants/enum'

/**
 * @description Controller xử lý tạo phòng mới
 * @param {Request<ParamsDictionary, any, IAddRoomRequestBody>} req - Express request object chứa thông tin phòng cần tạo trong body
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng đã tạo
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */

export const addRoomController = async (
  req: Request<ParamsDictionary, any, IAddRoomRequestBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { roomId, roomName, roomType, maxCapacity, status, description } = req.body

    const result = await roomServices.addRoom({
      roomId: Number(roomId),
      roomName,
      roomType,
      maxCapacity: Number(maxCapacity),
      status,
      description
    })

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.ADD_ROOM_TYPE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Controller xử lý lấy tất cả phòng
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */
export const getRoomsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await roomServices.getRooms()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.GET_ROOMS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Snapshot thiết bị control/video đang kết nối Socket.IO theo phòng
 */
export const getDeviceConnectionsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = roomDevicePresenceService.getSnapshot()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.GET_DEVICE_CONNECTIONS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Controller xử lý lấy phòng theo id
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */
export const getRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await roomServices.getRoom(req.params.id)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.GET_ROOM_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Controller xử lý lấy phòng theo roomId
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */
export const getRoomByRoomIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = Number(req.params.roomId)
    const result = await roomServices.getRoomByRoomId(roomId)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.GET_ROOM_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Controller xử lý cập nhật phòng
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */
export const updateRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await roomServices.updateRoom(req.params.id, req.body)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.UPDATE_ROOM_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Controller xử lý xóa phòng
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {Promise<Response>} Response với status 200 và thông tin phòng
 * @throws {Error} Chuyển tiếp lỗi đến middleware xử lý lỗi thông qua next(error)
 * @author QuangDo
 */
export const deleteRoomController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await roomServices.deleteRoom(req.params.id)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: ROOM_MESSAGES.DELETE_ROOM_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description socket event for notification
 * @path /song-queue/rooms/:roomId/notification
 * @method GET
 * @author QuangDoo
 */
export const solveRequestController = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params

  try {
    await roomServices.solveRequest(roomId)
    res.status(HTTP_STATUS_CODE.OK).json({ message: 'Request solved successfully' })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Mark order as served
 * @path /rooms/:roomId/orders/:orderId/serve
 * @method POST
 * @author Assistant
 */
export const solveOrderController = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId, orderId } = req.params
  const actorId = req.decoded_authorization?.user_id

  if (!actorId) {
    return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
  }

  try {
    const result = await roomServices.solveOrder(roomId, orderId, actorId)
    res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Order marked as served successfully',
      roomId,
      orderId,
      servedBy: result.servedBy,
      servedAt: result.servedAt,
      itemCount: result.itemCount
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description turn off all videos in room
 * @path /rooms/turn-off-videos
 * @method POST
 * @author QuangDoo
 */
export const turnOffVideosController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await roomServices.turnOffVideos()
    res.status(HTTP_STATUS_CODE.OK).json({ message: 'Videos turned off successfully' })
  } catch (error) {
    next(error)
  }
}

/**
 * Debug endpoint to check and create test rooms
 * @param req Request
 * @param res Response
 */
export const debugRooms = async (req: Request, res: Response) => {
  try {
    // Get all rooms
    const rooms = await databaseService.rooms.find({}).toArray()

    // Check if we have rooms
    console.log(`Found ${rooms.length} rooms in database`)

    // Get distinct room types
    const roomTypes = await databaseService.rooms.distinct('roomType')
    console.log('Room types in database:', roomTypes)

    // Track created rooms
    const createdRooms = []

    // Create test rooms if needed and requested
    if (req.query.createTest === 'true') {
      console.log('Checking if we need to create test rooms')

      // Create Small room if needed
      if (!rooms.some((r) => r.roomType.toLowerCase() === 'small')) {
        console.log('Creating a test room with type Small')
        const smallRoom = {
          roomId: 1,
          roomName: 'Test Room - Small',
          roomType: 'small',
          status: RoomStatus.Available,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        const smallResult = await databaseService.rooms.insertOne(smallRoom)
        console.log('Created Small test room with ID:', smallResult.insertedId)
        createdRooms.push({ type: 'small', id: smallResult.insertedId })
      }

      // Create Medium room if needed
      if (!rooms.some((r) => r.roomType.toLowerCase() === 'medium')) {
        console.log('Creating a test room with type Medium')
        const mediumRoom = {
          roomId: 2,
          roomName: 'Test Room - Medium',
          roomType: 'medium',
          status: RoomStatus.Available,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        const mediumResult = await databaseService.rooms.insertOne(mediumRoom)
        console.log('Created Medium test room with ID:', mediumResult.insertedId)
        createdRooms.push({ type: 'medium', id: mediumResult.insertedId })
      }

      // Create Large room if needed
      if (!rooms.some((r) => r.roomType.toLowerCase() === 'large')) {
        console.log('Creating a test room with type Large')
        const largeRoom = {
          roomId: 3,
          roomName: 'Test Room - Large',
          roomType: 'large',
          status: RoomStatus.Available,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        const largeResult = await databaseService.rooms.insertOne(largeRoom)
        console.log('Created Large test room with ID:', largeResult.insertedId)
        createdRooms.push({ type: 'large', id: largeResult.insertedId })
      }
    }

    // Get updated rooms list if we created any rooms
    let updatedRooms = rooms
    if (createdRooms.length > 0) {
      updatedRooms = await databaseService.rooms.find({}).toArray()
    }

    // Return info about rooms
    return res.status(HTTP_STATUS_CODE.OK).json({
      message:
        createdRooms.length > 0
          ? `Debug rooms information with ${createdRooms.length} test room(s) created`
          : 'Debug rooms information',
      result: {
        totalRooms: updatedRooms.length,
        roomTypes: await databaseService.rooms.distinct('roomType'),
        rooms: updatedRooms,
        createdRooms: createdRooms.length > 0 ? createdRooms : undefined
      }
    })
  } catch (error) {
    console.error('Error in debug rooms:', error)
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error checking rooms',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
