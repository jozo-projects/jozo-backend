import { ObjectId } from 'mongodb'
import { RoomSize, RoomType, RoomScheduleStatus } from '~/constants/enum'
import { VirtualRoom } from '~/models/schemas/VirtualRoom.schema'
import databaseService from './database.service'
import { roomTypeFieldToEnum } from '~/utils/roomType'

interface VirtualRoomAssignment {
  virtualRoom: VirtualRoom
  physicalRoom: any
  assignedVirtualSize: RoomType
  actualPhysicalSize: RoomType
  upgraded: boolean
  upgradeReason?: string
}

class VirtualRoomService {
  /**
   * Tạo danh sách virtual rooms từ physical rooms
   */
  async createVirtualRoomList(): Promise<VirtualRoom[]> {
    const physicalRooms = await databaseService.rooms.find().sort({ roomId: 1 }).toArray()

    const virtualRooms: VirtualRoom[] = []

    physicalRooms.forEach((physicalRoom, index) => {
      const roomNumber = index + 1
      let virtualSize: RoomType
      let priority: number

      const sizeFromDb = roomTypeFieldToEnum(physicalRoom.roomType)
      if (sizeFromDb) {
        virtualSize = sizeFromDb
        priority = roomNumber
      } else if (roomNumber <= 3) {
        virtualSize = RoomType.Small
        priority = roomNumber
      } else if (roomNumber <= 6) {
        virtualSize = RoomType.Medium
        priority = roomNumber - 3
      } else {
        virtualSize = RoomType.Large
        priority = roomNumber - 6
      }

      virtualRooms.push(
        new VirtualRoom({
          _id: new ObjectId(),
          virtualRoomId: index + 1,
          virtualRoomName: `Room ${virtualSize}${priority}`,
          virtualSize,
          physicalRoomId: physicalRoom._id,
          priority,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      )
    })

    return virtualRooms
  }

  /**
   * Tìm phòng ảo trống theo size yêu cầu
   */
  async findAvailableVirtualRoom(
    requestedSize: RoomType,
    startTime: Date,
    endTime: Date
  ): Promise<VirtualRoomAssignment | null> {
    console.log(`🔍 Tìm phòng ${requestedSize} từ ${startTime.toISOString()} đến ${endTime.toISOString()}`)

    // 1. Tìm phòng ảo có size đúng yêu cầu
    const virtualRooms = await databaseService.virtualRooms
      .find({
        virtualSize: requestedSize,
        isActive: true
      })
      .sort({ priority: 1 })
      .toArray()

    console.log(`📋 Tìm thấy ${virtualRooms.length} virtual rooms có size ${requestedSize}`)
    if (virtualRooms.length === 0) {
      console.log('❌ Không có virtual rooms nào trong database!')
      return null
    }

    // 2. Kiểm tra từng phòng ảo có trống không
    for (const virtualRoom of virtualRooms) {
      console.log(`🔍 Kiểm tra phòng ${virtualRoom.virtualRoomName} (${virtualRoom.virtualSize})`)
      const isAvailable = await this.checkVirtualRoomAvailability(virtualRoom._id, startTime, endTime)

      if (isAvailable) {
        console.log(`✅ Phòng ${virtualRoom.virtualRoomName} trống!`)
        const physicalRoom = await databaseService.rooms.findOne({
          _id: virtualRoom.physicalRoomId
        })

        return {
          virtualRoom,
          physicalRoom,
          assignedVirtualSize: virtualRoom.virtualSize,
          actualPhysicalSize: physicalRoom?.roomType as RoomType,
          upgraded: false
        }
      } else {
        console.log(`❌ Phòng ${virtualRoom.virtualRoomName} đã được đặt`)
      }
    }

    // 3. Chỉ khi size khách đặt HẾT thì mới tìm upgrade
    console.log(`Tất cả phòng ${requestedSize} đã hết, tìm upgrade...`)
    return await this.findUpgradeVirtualRoom(requestedSize, startTime, endTime)
  }

  /**
   * Tìm phòng upgrade khi không có size đúng
   */
  private async findUpgradeVirtualRoom(
    requestedSize: RoomType,
    startTime: Date,
    endTime: Date
  ): Promise<VirtualRoomAssignment | null> {
    const upgradeMap: Record<RoomType, RoomType[]> = {
      [RoomType.Small]: [RoomType.Medium, RoomType.Large],
      [RoomType.Medium]: [RoomType.Large],
      [RoomType.Large]: [],
      [RoomType.Dorm]: []
    }

    const upgradeOptions = upgradeMap[requestedSize]

    for (const upgradeSize of upgradeOptions) {
      const virtualRooms = await databaseService.virtualRooms
        .find({
          virtualSize: upgradeSize,
          isActive: true
        })
        .sort({ priority: 1 })
        .toArray()

      for (const virtualRoom of virtualRooms) {
        const isAvailable = await this.checkVirtualRoomAvailability(virtualRoom._id, startTime, endTime)

        if (isAvailable) {
          const physicalRoom = await databaseService.rooms.findOne({
            _id: virtualRoom.physicalRoomId
          })

          return {
            virtualRoom,
            physicalRoom,
            assignedVirtualSize: virtualRoom.virtualSize,
            actualPhysicalSize: physicalRoom?.roomType as RoomType,
            upgraded: true,
            upgradeReason: `Upgraded from ${requestedSize} to ${virtualRoom.virtualSize}`
          }
        }
      }
    }

    return null
  }

  /**
   * Kiểm tra phòng ảo có trống không
   */
  private async checkVirtualRoomAvailability(
    virtualRoomId: ObjectId,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    // Kiểm tra trong room schedules có virtual room info không
    const existingSchedule = await databaseService.roomSchedule.findOne({
      'virtualRoomInfo.virtualRoomId': virtualRoomId,
      status: { $nin: [RoomScheduleStatus.Cancelled, RoomScheduleStatus.Finished] },
      $or: [
        {
          startTime: { $lt: endTime },
          endTime: { $gt: startTime }
        },
        {
          endTime: null,
          startTime: { $lt: endTime }
        }
      ]
    })

    return !existingSchedule
  }

  /**
   * Lấy danh sách virtual rooms
   */
  async getVirtualRooms(): Promise<VirtualRoom[]> {
    return await databaseService.virtualRooms.find().sort({ priority: 1 }).toArray()
  }

  /**
   * Debug: Kiểm tra trạng thái virtual rooms trong database
   */
  async debugVirtualRooms(): Promise<void> {
    console.log('🔍 DEBUG: Kiểm tra virtual rooms trong database...')

    const allVirtualRooms = await databaseService.virtualRooms.find().toArray()
    console.log(`📊 Tổng số virtual rooms: ${allVirtualRooms.length}`)

    if (allVirtualRooms.length === 0) {
      console.log('❌ Không có virtual rooms nào trong database!')
      console.log('💡 Cần chạy script createVirtualRooms để tạo virtual rooms')
      return
    }

    console.log('\n📋 Danh sách virtual rooms:')
    allVirtualRooms.forEach((vr, index) => {
      console.log(`  ${index + 1}. ${vr.virtualRoomName} - Size: ${vr.virtualSize} - Active: ${vr.isActive}`)
    })

    // Kiểm tra có virtual rooms với RoomType.Small không
    const smallRooms = allVirtualRooms.filter((vr) => vr.virtualSize === RoomType.Small)
    console.log(`\n🏠 Virtual rooms Small: ${smallRooms.length}`)

    if (smallRooms.length === 0) {
      console.log('❌ Không có virtual rooms Small nào!')
      console.log('💡 Có thể virtual rooms đang sử dụng RoomSize cũ (S, M, L)')
    }
  }

  /**
   * Cập nhật virtual room list
   */
  async updateVirtualRoomList(virtualRoomUpdates: any[]): Promise<void> {
    for (const update of virtualRoomUpdates) {
      await databaseService.virtualRooms.updateOne(
        { _id: new ObjectId(update.virtualRoomId) },
        {
          $set: {
            virtualSize: update.newVirtualSize,
            priority: update.newPriority,
            virtualRoomName: `Room ${update.newVirtualSize}${update.newPriority}`,
            updatedAt: new Date()
          }
        }
      )
    }
  }
}

export const virtualRoomService = new VirtualRoomService()
