import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { RoomType, RoomScheduleStatus } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { RoomSchedule, BookingSource } from '~/models/schemas/RoomSchdedule.schema'
import { AddSongRequestBody } from '~/models/requests/Song.request'
import { generateUniqueBookingCode } from '~/utils/common'
import databaseService from './database.service'
import { emitBookingNotification } from './room.service'
import fnbOrderService from './fnbOrder.service'

dayjs.extend(utc)
dayjs.extend(timezone)

interface OnlineBookingRequest {
  customerName: string
  customerPhone: string
  customerEmail?: string
  roomType: RoomType // Sử dụng RoomType để phù hợp với frontend
  startTime: string // ISO string hoặc datetime format (YYYY-MM-DD HH:mm:ss) - sẽ được parse theo timezone Việt Nam
  endTime: string // ISO string hoặc datetime format (YYYY-MM-DD HH:mm:ss) - sẽ được parse theo timezone Việt Nam
  note?: string
}

interface RoomAvailabilityResult {
  room: any
  originalRequest: RoomType
  assignedRoomType: RoomType
  upgraded: boolean
}

class OnlineBookingService {
  /**
   * Parse thời gian với timezone Việt Nam
   */
  private parseDateTimeWithTimezone(dateTimeStr: string): Date {
    let processedStr = dateTimeStr

    // Nếu không có timezone info, thêm timezone Việt Nam
    if (!processedStr.includes('+') && !processedStr.includes('Z') && !processedStr.includes('T')) {
      // Format: "2024-01-15 20:00:00" -> "2024-01-15T20:00:00+07:00"
      processedStr = processedStr.replace(' ', 'T') + '+07:00'
    } else if (!processedStr.includes('+') && !processedStr.includes('Z')) {
      // Format: "2024-01-15T20:00:00" -> "2024-01-15T20:00:00+07:00"
      processedStr = processedStr + '+07:00'
    }

    // Parse với dayjs để xử lý timezone đúng cách
    return dayjs.tz(processedStr, 'Asia/Ho_Chi_Minh').toDate()
  }

  /**
   * Validate thông tin booking
   */
  private validateBookingRequest(request: OnlineBookingRequest): void {
    // Validate thông tin khách hàng
    if (!request.customerName || request.customerName.trim().length < 2) {
      throw new ErrorWithStatus({
        message: 'Tên khách hàng phải có ít nhất 2 ký tự',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (!request.customerPhone) {
      throw new ErrorWithStatus({
        message: 'Số điện thoại là bắt buộc',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Validate SĐT format
    const phoneRegex = /^[0-9]{10,11}$/
    const cleanPhone = request.customerPhone.replace(/[\s\-\(\)]/g, '')
    if (!phoneRegex.test(cleanPhone)) {
      throw new ErrorWithStatus({
        message: 'Số điện thoại không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Validate email nếu có
    if (request.customerEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(request.customerEmail)) {
        throw new ErrorWithStatus({
          message: 'Email không hợp lệ',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
    }

    // Validate thời gian
    let startTime: Date
    let endTime: Date

    try {
      // Parse thời gian với timezone Việt Nam
      startTime = this.parseDateTimeWithTimezone(request.startTime)
      endTime = this.parseDateTimeWithTimezone(request.endTime)

      // Kiểm tra xem có phải invalid date không
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        throw new Error('Invalid date format')
      }
    } catch (error) {
      throw new ErrorWithStatus({
        message: 'Invalid date format. Use ISO string format or datetime format (YYYY-MM-DD HH:mm:ss)',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()

    // Không cho đặt quá khứ (ít nhất 30 phút trước)
    const minAdvanceTime = 30 * 60 * 1000 // 30 phút
    if (startTime < new Date(now.getTime() + minAdvanceTime)) {
      throw new ErrorWithStatus({
        message: 'Không thể đặt phòng trong vòng 30 phút tới',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Không cho đặt quá xa (tối đa 30 ngày)
    const maxAdvanceTime = 30 * 24 * 60 * 60 * 1000 // 30 ngày
    if (startTime > new Date(now.getTime() + maxAdvanceTime)) {
      throw new ErrorWithStatus({
        message: 'Chỉ có thể đặt phòng trước tối đa 30 ngày',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Thời gian kết thúc phải sau thời gian bắt đầu
    if (endTime <= startTime) {
      throw new ErrorWithStatus({
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Thời gian đặt phòng tối thiểu 30 phút, tối đa 8 giờ
    const duration = endTime.getTime() - startTime.getTime()
    const minDuration = 30 * 60 * 1000 // 30 phút
    const maxDuration = 8 * 60 * 60 * 1000 // 8 giờ

    if (duration < minDuration) {
      throw new ErrorWithStatus({
        message: 'Thời gian đặt phòng tối thiểu là 30 phút',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (duration > maxDuration) {
      throw new ErrorWithStatus({
        message: 'Thời gian đặt phòng tối đa là 8 giờ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Không cho đặt vào giờ nghỉ - sử dụng timezone Việt Nam
    const vietnamTime = dayjs.tz(startTime, 'Asia/Ho_Chi_Minh')
    const hour = vietnamTime.hour()
    if (hour < 10 || hour > 23) {
      throw new ErrorWithStatus({
        message: 'Chỉ có thể đặt phòng từ 10:00 đến 23:00',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  /**
   * Tìm phòng trống với hardcode logic: Phòng 1-3 = Small, 4-6 = Medium, 7+ = Large
   */
  private async findAvailableRoomWithHardcode(
    requestedSize: RoomType,
    startTime: Date,
    endTime: Date
  ): Promise<RoomAvailabilityResult | null> {
    console.log(`🔍 Tìm phòng ${requestedSize} với hardcode logic...`)

    // Lấy tất cả phòng và sắp xếp theo roomId
    const allRooms = await databaseService.rooms.find().sort({ roomId: 1 }).toArray()
    console.log(`📋 Tìm thấy ${allRooms.length} phòng trong database`)

    // Hardcode: Phòng 1-3 = Small, Phòng 4-6 = Medium, Phòng 7+ = Large
    const roomMapping = {
      [RoomType.Small]: allRooms.slice(0, 3), // Phòng 1, 2, 3
      [RoomType.Medium]: allRooms.slice(3, 6), // Phòng 4, 5, 6
      [RoomType.Large]: allRooms.slice(6) // Phòng 7+
    }

    // 1. Tìm phòng có size đúng yêu cầu
    const targetRooms = roomMapping[requestedSize]
    console.log(
      `🎯 Phòng ${requestedSize}: ${targetRooms.length} phòng (${targetRooms.map((r) => r.roomName).join(', ')})`
    )

    for (const room of targetRooms) {
      const isAvailable = await this.checkRoomAvailability(room._id, startTime, endTime)
      if (isAvailable) {
        console.log(`✅ Tìm thấy phòng trống: ${room.roomName}`)
        return {
          room,
          originalRequest: requestedSize,
          assignedRoomType: requestedSize,
          upgraded: false
        }
      }
    }

    // 2. Nếu không có phòng size đúng, tìm upgrade
    console.log(`❌ Không có phòng ${requestedSize} trống, tìm upgrade...`)

    const upgradeMap = {
      [RoomType.Small]: [RoomType.Medium, RoomType.Large],
      [RoomType.Medium]: [RoomType.Large],
      [RoomType.Large]: []
    }

    const upgradeOptions = upgradeMap[requestedSize]

    for (const upgradeSize of upgradeOptions) {
      const upgradeRooms = roomMapping[upgradeSize]
      console.log(`🔄 Thử upgrade lên ${upgradeSize}: ${upgradeRooms.length} phòng`)

      for (const room of upgradeRooms) {
        const isAvailable = await this.checkRoomAvailability(room._id, startTime, endTime)
        if (isAvailable) {
          console.log(`✅ Tìm thấy phòng upgrade: ${room.roomName} (${upgradeSize})`)
          return {
            room,
            originalRequest: requestedSize,
            assignedRoomType: upgradeSize,
            upgraded: true
          }
        }
      }
    }

    console.log(`❌ Không tìm thấy phòng nào trống`)
    return null
  }

  /**
   * Kiểm tra phòng có trống không
   */
  private async checkRoomAvailability(roomId: ObjectId, startTime: Date, endTime: Date): Promise<boolean> {
    const existingSchedule = await databaseService.roomSchedule.findOne({
      roomId: roomId,
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
   * Tạo booking online với Virtual Room system
   */
  async createOnlineBooking(request: OnlineBookingRequest): Promise<any> {
    try {
      // Validate request
      this.validateBookingRequest(request)

      // Parse dates từ request với timezone Việt Nam
      const startTime = this.parseDateTimeWithTimezone(request.startTime)
      const endTime = this.parseDateTimeWithTimezone(request.endTime)

      // Tìm phòng trống với hardcode logic
      const roomResult = await this.findAvailableRoomWithHardcode(request.roomType, startTime, endTime)

      if (!roomResult) {
        throw new ErrorWithStatus({
          message: `Xin lỗi, không còn box ${request.roomType} trống trong khung giờ này`,
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }

      // Tạo booking note đơn giản
      const autoNote = `Booking by ${request.customerName} (${request.customerPhone})${roomResult.upgraded ? ` - UPGRADE to ${roomResult.assignedRoomType}` : ''}`

      // Sinh mã booking 4 chữ số và dateOfUse
      const dateOfUse = dayjs.tz(startTime, 'Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
      const bookingCode = await generateUniqueBookingCode(async (code) => {
        // Kiểm tra mã đã tồn tại trong cùng ngày chưa
        const existingSchedule = await databaseService.roomSchedule.findOne({
          dateOfUse,
          bookingCode: code
        })
        return !!existingSchedule // return true nếu trùng
      })

      // Tạo RoomSchedule
      const newSchedule = new RoomSchedule(
        roomResult.room._id.toString(),
        startTime,
        RoomScheduleStatus.Booked,
        endTime,
        'online_customer',
        'online_customer',
        autoNote,
        BookingSource.Customer,
        true, // Đã fix: truyền 'true' để đáp ứng kiểu boolean (tham số isOnlineBooking)
        bookingCode, // Mã 4 chữ số
        request.customerName,
        request.customerPhone,
        request.customerEmail,
        request.roomType,
        roomResult.assignedRoomType,
        roomResult.upgraded,
        undefined, // virtualRoomInfo
        undefined, // adminNotes
        [], // queueSongs - luôn khởi tạo là mảng rỗng
        dateOfUse // Ngày sử dụng
      )

      // Lưu vào database
      const result = await databaseService.roomSchedule.insertOne(newSchedule)

      // Tự động tạo FNB order trống cho booking online
      try {
        const emptyOrder = {
          drinks: {},
          snacks: {}
        }
        await fnbOrderService.upsertFnbOrder(result.insertedId.toString(), emptyOrder, 'online_customer')
      } catch (fnbOrderError) {
        console.error('Lỗi khi tạo FNB order tự động:', fnbOrderError)
      }

      // Emit notification
      const bookingNotification = {
        action: 'booked',
        bookingId: result.insertedId.toString(),
        bookingCode: bookingCode, // Mã 4 chữ số
        dateOfUse: dateOfUse, // Ngày sử dụng
        roomId: roomResult.room._id.toString(),
        roomName: roomResult.room.roomName,
        customerName: request.customerName,
        customerPhone: request.customerPhone,
        customerEmail: request.customerEmail,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        note: autoNote,
        source: 'online_booking',
        createdAt: new Date().toISOString(),
        upgraded: roomResult.upgraded,
        originalRequest: roomResult.originalRequest,
        assignedRoomType: roomResult.assignedRoomType,
        queueSongs: []
      }

      emitBookingNotification(roomResult.room._id.toString(), bookingNotification)

      return {
        success: true,
        booking: {
          _id: result.insertedId.toString(),
          bookingCode: bookingCode, // Mã 4 chữ số (0000-9999)
          dateOfUse: dateOfUse, // Ngày sử dụng (YYYY-MM-DD)
          roomName: roomResult.room.roomName,
          originalRequest: roomResult.originalRequest,
          assignedRoomType: roomResult.assignedRoomType,
          upgraded: roomResult.upgraded,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          note: autoNote,
          queueSongs: []
        }
      }
    } catch (error) {
      console.error('Error creating online booking:', error)

      // Nếu error đã là ErrorWithStatus thì throw lại
      if (error instanceof ErrorWithStatus) {
        throw error
      }

      // Nếu là error khác thì wrap thành ErrorWithStatus
      throw new ErrorWithStatus({
        message: error instanceof Error ? error.message : 'Error creating online booking',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }
  }

  /**
   * Tra cứu booking bằng số điện thoại
   */
  async lookupBookingByPhone(phone: string): Promise<any> {
    try {
      // Clean phone number
      const cleanPhone = phone.replace(/[\s\-\(\)]/g, '')

      // Tìm room schedules theo SĐT (bao gồm cả cancelled để hiển thị lịch sử)
      const schedules = await databaseService.roomSchedule
        .find({
          customerPhone: { $regex: new RegExp(cleanPhone, 'i') },
          status: { $in: [RoomScheduleStatus.Booked, RoomScheduleStatus.InUse, RoomScheduleStatus.Cancelled] }
        })
        .toArray()

      // Sắp xếp theo createdAt giảm dần (gần nhất trước) - sắp xếp thủ công để đảm bảo đúng
      schedules.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime()
        const dateB = new Date(b.createdAt || 0).getTime()
        return dateB - dateA // Giảm dần (mới nhất trước)
      })

      if (schedules.length === 0) {
        return {
          success: true,
          phone: phone,
          bookings: [],
          message: 'Không tìm thấy booking nào cho số điện thoại này'
        }
      }

      // Lấy thông tin phòng cho mỗi schedule
      const bookingsWithDetails = await Promise.all(
        schedules.map(async (schedule) => {
          const room = await databaseService.rooms.findOne({
            _id: schedule.roomId
          })

          // Kiểm tra có thể chỉnh sửa/hủy không
          const now = new Date()
          const canModify = schedule.startTime > now
          const canCancel = canModify && schedule.status === RoomScheduleStatus.Booked

          return {
            _id: schedule._id?.toString(),
            bookingCode: schedule.bookingCode, // Mã 4 chữ số
            dateOfUse: schedule.dateOfUse, // Ngày sử dụng
            roomId: schedule.roomId.toString(),
            startTime: schedule.startTime.toISOString(),
            endTime: schedule.endTime?.toISOString(),
            status: schedule.status,
            createdAt: schedule.createdAt?.toISOString(),
            createdBy: schedule.createdBy,
            updatedAt: schedule.updatedAt?.toISOString(),
            updatedBy: schedule.updatedBy,
            note: schedule.note,
            source: schedule.source,
            customerName: schedule.customerName,
            customerPhone: schedule.customerPhone,
            customerEmail: schedule.customerEmail,
            originalRoomType: schedule.originalRoomType,
            actualRoomType: schedule.actualRoomType,
            upgraded: schedule.upgraded,
            queueSongs: schedule.queueSongs || [],
            // Thêm thông tin phòng và trạng thái cho frontend
            roomName: room?.roomName,
            canModify,
            canCancel
          }
        })
      )

      return {
        success: true,
        data: bookingsWithDetails,
        message: `Tìm thấy ${bookingsWithDetails.length} đặt phòng`
      }
    } catch (error) {
      console.error('Error looking up booking:', error)
      throw error
    }
  }

  /**
   * Hủy booking
   */
  async cancelBooking(bookingId: string, phone: string): Promise<any> {
    try {
      if (!ObjectId.isValid(bookingId)) {
        throw new ErrorWithStatus({
          message: 'Invalid booking ID',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Tìm booking
      const schedule = await databaseService.roomSchedule.findOne({
        _id: new ObjectId(bookingId),
        customerPhone: { $regex: new RegExp(phone.replace(/[\s\-\(\)]/g, ''), 'i') }
      })

      if (!schedule) {
        throw new ErrorWithStatus({
          message: 'Booking not found or phone number does not match',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      // Kiểm tra có thể hủy không
      const now = new Date()
      if (schedule.startTime <= now) {
        throw new ErrorWithStatus({
          message: 'Cannot cancel past bookings',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      if (schedule.status !== RoomScheduleStatus.Booked) {
        throw new ErrorWithStatus({
          message: 'Only booked schedules can be cancelled',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Cập nhật status thành cancelled
      await databaseService.roomSchedule.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            status: RoomScheduleStatus.Cancelled,
            updatedAt: new Date(),
            updatedBy: 'customer'
          }
        }
      )

      // Emit socket notification cho admin về việc hủy booking
      const cancelNotification = {
        bookingId: bookingId,
        roomId: schedule.roomId.toString(),
        action: 'cancelled',
        customerName: schedule.customerName,
        customerPhone: schedule.customerPhone,
        startTime: schedule.startTime.toISOString(),
        endTime: schedule.endTime?.toISOString(),
        cancelledAt: new Date().toISOString(),
        source: 'online_booking'
      }

      emitBookingNotification(schedule.roomId.toString(), cancelNotification)

      return {
        success: true,
        message: 'Booking cancelled successfully',
        bookingId: bookingId
      }
    } catch (error) {
      console.error('Error cancelling booking:', error)
      throw error
    }
  }

  /**
   * Thêm bài hát vào queue songs của booking
   */
  async updateQueueSongs(bookingId: string, songData: AddSongRequestBody): Promise<any> {
    try {
      if (!ObjectId.isValid(bookingId)) {
        throw new ErrorWithStatus({
          message: 'Invalid booking ID',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Validate songData
      if (!songData || typeof songData !== 'object') {
        throw new ErrorWithStatus({
          message: 'Song data is required',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Validate required fields
      if (!songData.video_id || !songData.title || !songData.author) {
        throw new ErrorWithStatus({
          message: 'Song must have video_id, title, and author',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Tìm booking
      const schedule = await databaseService.roomSchedule.findOne({
        _id: new ObjectId(bookingId)
      })

      if (!schedule) {
        throw new ErrorWithStatus({
          message: 'Booking not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      // Lấy queueSongs hiện tại hoặc tạo mới
      const currentQueueSongs = schedule.queueSongs || []

      // Thêm song mới vào queue
      let updatedQueueSongs: AddSongRequestBody[]

      if (songData.position === 'top') {
        // Thêm vào đầu queue
        updatedQueueSongs = [songData, ...currentQueueSongs]
      } else {
        // Thêm vào cuối queue (mặc định)
        updatedQueueSongs = [...currentQueueSongs, songData]
      }

      // Cập nhật queueSongs
      await databaseService.roomSchedule.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            queueSongs: updatedQueueSongs,
            updatedAt: new Date(),
            updatedBy: 'customer'
          }
        }
      )

      return {
        success: true,
        message: 'Song added to queue successfully',
        bookingId: bookingId,
        queueSongs: updatedQueueSongs
      }
    } catch (error) {
      console.error('Error updating queue songs:', error)
      throw error
    }
  }

  /**
   * Xóa bài hát khỏi queue songs của booking theo index
   */
  async removeSongFromQueue(bookingId: string, index: number): Promise<any> {
    try {
      if (!ObjectId.isValid(bookingId)) {
        throw new ErrorWithStatus({
          message: 'Invalid booking ID',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      if (index < 0) {
        throw new ErrorWithStatus({
          message: 'Index must be a non-negative number',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Tìm booking
      const schedule = await databaseService.roomSchedule.findOne({
        _id: new ObjectId(bookingId)
      })

      if (!schedule) {
        throw new ErrorWithStatus({
          message: 'Booking not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      // Lấy queueSongs hiện tại
      const currentQueueSongs = schedule.queueSongs || []

      // Kiểm tra index có hợp lệ không
      if (index >= currentQueueSongs.length) {
        throw new ErrorWithStatus({
          message: 'Index out of range',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Lưu thông tin bài hát sẽ bị xóa
      const removedSong = currentQueueSongs[index]

      // Xóa bài hát theo index
      const updatedQueueSongs = currentQueueSongs.filter((_, i) => i !== index)

      // Cập nhật queueSongs
      await databaseService.roomSchedule.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            queueSongs: updatedQueueSongs,
            updatedAt: new Date(),
            updatedBy: 'customer'
          }
        }
      )

      return {
        success: true,
        message: 'Song removed from queue successfully',
        bookingId: bookingId,
        removedIndex: index,
        removedSong: removedSong,
        queueSongs: updatedQueueSongs
      }
    } catch (error) {
      console.error('Error removing song from queue:', error)
      throw error
    }
  }

  /**
   * Get videos by booking code
   */
  async getVideosByBookingCode(bookingCode: string): Promise<AddSongRequestBody[]> {
    try {
      const schedule = await databaseService.roomSchedule.findOne({
        bookingCode: bookingCode
      })

      if (!schedule) {
        throw new ErrorWithStatus({
          message: 'Booking not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      return schedule.queueSongs || []
    } catch (error) {
      console.error('Error getting videos by booking code:', error)
      throw error
    }
  }
}

export const onlineBookingService = new OnlineBookingService()
