import { NextFunction, Request, Response } from 'express'
import { RoomScheduleStatus, RoomType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import databaseService from '~/services/database.service'
import { virtualRoomService } from '~/services/virtualRoom.service'

/**
 * @description Lấy dashboard virtual room
 * @path /api/admin/virtual-rooms/dashboard
 * @method GET
 */
export const getVirtualRoomDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const virtualRooms = await virtualRoomService.getVirtualRooms()

    const dashboard = {
      virtualRooms: await Promise.all(
        virtualRooms.map(async (virtualRoom) => {
          const physicalRoom = await databaseService.rooms.findOne({
            _id: virtualRoom.physicalRoomId
          })

          const currentBooking = await databaseService.roomSchedule.findOne({
            'virtualRoomInfo.virtualRoomId': virtualRoom._id,
            status: { $in: [RoomScheduleStatus.Booked, RoomScheduleStatus.InUse] }
          })

          return {
            ...virtualRoom,
            physicalRoom: {
              roomId: physicalRoom?.roomId,
              roomName: physicalRoom?.roomName,
              actualSize: physicalRoom?.roomType
            },
            currentBooking: currentBooking
              ? {
                  customerName: currentBooking.customerName,
                  startTime: currentBooking.startTime,
                  endTime: currentBooking.endTime,
                  virtualSize: currentBooking.virtualRoomInfo?.virtualSize,
                  staffInstructions: currentBooking.adminNotes?.staffInstructions
                }
              : null,
            isAvailable: !currentBooking
          }
        })
      ),
      summary: {
        totalVirtualRooms: virtualRooms.length,
        virtualRoomsBySize: {
          S: virtualRooms.filter((r) => r.virtualSize === RoomType.Small).length,
          M: virtualRooms.filter((r) => r.virtualSize === RoomType.Medium).length,
          L: virtualRooms.filter((r) => r.virtualSize === RoomType.Large).length
        },
        availableRooms: virtualRooms.filter((r) => r.isActive).length
      }
    }

    res.json(dashboard)
  } catch (error) {
    console.error('Error getting virtual room dashboard:', error)
    next(error)
  }
}

/**
 * @description Cập nhật virtual room list
 * @path /api/admin/virtual-rooms/update
 * @method POST
 */
export const updateVirtualRoomList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { virtualRoomUpdates } = req.body

    if (!virtualRoomUpdates || !Array.isArray(virtualRoomUpdates)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid virtual room updates data'
      })
    }

    // Cập nhật virtual room list
    await virtualRoomService.updateVirtualRoomList(virtualRoomUpdates)

    res.json({
      success: true,
      message: 'Virtual room list updated successfully'
    })
  } catch (error) {
    console.error('Error updating virtual room list:', error)
    next(error)
  }
}

/**
 * @description Lấy danh sách virtual rooms
 * @path /api/admin/virtual-rooms
 * @method GET
 */
export const getVirtualRooms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const virtualRooms = await virtualRoomService.getVirtualRooms()

    res.json({
      success: true,
      virtualRooms
    })
  } catch (error) {
    console.error('Error getting virtual rooms:', error)
    next(error)
  }
}

/**
 * @description Tạo lại virtual room list
 * @path /api/admin/virtual-rooms/recreate
 * @method POST
 */
export const recreateVirtualRooms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Xóa virtual rooms cũ
    await databaseService.virtualRooms.deleteMany({})

    // Tạo virtual rooms mới
    const virtualRooms = await virtualRoomService.createVirtualRoomList()

    // Lưu vào database
    await databaseService.virtualRooms.insertMany(virtualRooms)

    res.json({
      success: true,
      message: `Recreated ${virtualRooms.length} virtual rooms`,
      virtualRooms
    })
  } catch (error) {
    console.error('Error recreating virtual rooms:', error)
    next(error)
  }
}
