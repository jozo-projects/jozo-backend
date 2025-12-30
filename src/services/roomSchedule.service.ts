import { ObjectId } from 'mongodb'
// import { IRoomScheduleRequestBody, IRoomScheduleRequestQuery } from '~/models/requests/RoomSchedule.request'
import dayjs from 'dayjs'
import { RoomScheduleStatus, RoomType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { IRoomScheduleRequestBody, IRoomScheduleRequestQuery } from '~/models/requests/RoomSchedule.request'
import { BookingSource, RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'
import { generateUniqueBookingCode, parseDate } from '~/utils/common'
import databaseService from './database.service'
import fnbOrderService from './fnbOrder.service'
import redis from './redis.service'
import { roomEventEmitter } from './room.service'

type ClientBooking = {
  _id?: string | ObjectId
  status: string
  room_type: string
  booking_date: string
  time_slots: string[]
  customer_name?: string
  customer_phone?: string
}

/**
 * RoomScheduleService
 * Cung cấp các hàm xử lý nghiệp vụ cho event lịch phòng.
 */
class RoomScheduleService {
  /**
   * Lấy danh sách lịch phòng theo filter
   * @param filter - Đối tượng filter {IRoomScheduleRequestQuery}
   *    Có thể bao gồm: roomId, date (ISO string hoặc Date), status
   * @returns Mảng các lịch phòng
   */
  async getSchedules(filter: IRoomScheduleRequestQuery): Promise<RoomSchedule[]> {
    const query: {
      roomId?: ObjectId
      startTime?: { $gte: Date; $lt: Date }
      status?: RoomSchedule['status']
      source?: BookingSource
    } = {}

    if (filter.roomId) {
      query.roomId = new ObjectId(filter.roomId)
    }

    if (filter.date) {
      const timeZone = 'Asia/Ho_Chi_Minh'
      // FE truyền "2025-03-15T17:00:00.000Z" đại diện cho 00:00 ngày 16 theo giờ Việt Nam,
      // vì vậy ta tạo đối tượng dayjs từ UTC rồi chuyển sang múi giờ Việt Nam.
      const localDate = dayjs.utc(filter.date).tz(timeZone)
      const startOfDay = localDate.startOf('day').utc().toDate() // 00:00 ngày 16 VN → UTC: 2025-03-15T17:00:00.000Z
      const endOfDay = localDate.endOf('day').utc().toDate() // 23:59:59.999 ngày 16 VN → UTC: 2025-03-16T16:59:59.999Z
      query.startTime = { $gte: startOfDay, $lt: endOfDay }
    }

    if (filter.status) {
      query.status = filter.status
    }

    // Thêm lọc theo source nếu được chỉ định
    if (filter.source) {
      query.source = filter.source
    }

    console.log('Final query:', query)
    return await databaseService.roomSchedule.find(query).toArray()
  }

  /**
   * Lấy thông tin lịch phòng theo id
   * @param id - RoomSchedule id
   * @returns Một lịch phòng
   */
  async getScheduleById(id: string) {
    return await databaseService.roomSchedule.findOne({ _id: new ObjectId(id) })
  }

  /**
   * So sánh thời gian chỉ tính đến giờ và phút, bỏ qua giây
   * @param time1 - Thời gian thứ nhất
   * @param time2 - Thời gian thứ hai
   * @returns true nếu time1 >= time2 (chỉ tính giờ và phút)
   */
  private compareTimeIgnoreSeconds(time1: Date, time2: Date): boolean {
    const time1Minutes = time1.getHours() * 60 + time1.getMinutes()
    const time2Minutes = time2.getHours() * 60 + time2.getMinutes()
    return time1Minutes >= time2Minutes
  }

  /**
   * Validate thời gian cho lịch phòng.
   * Đối với trạng thái "Booked":
   * - Bắt buộc phải có endTime.
   * - endTime phải lớn hơn hoặc bằng startTime (chỉ tính giờ và phút).
   * - Khoảng cách giữa startTime và endTime không vượt quá 8 tiếng.
   *
   * @param schedule - Đối tượng lịch phòng {IRoomScheduleRequestBody}
   * @returns Một object chứa startTime và endTime (có thể null nếu không được cung cấp)
   * @throws ErrorWithStatus nếu dữ liệu không hợp lệ
   */
  private validateScheduleTimes(schedule: IRoomScheduleRequestBody): { startTime: Date; endTime: Date | null } {
    const startTime = parseDate(schedule.startTime)
    const endTime = schedule.endTime ? parseDate(schedule.endTime) : null

    if (schedule.status === RoomScheduleStatus.Booked) {
      if (!endTime) {
        throw new ErrorWithStatus({
          message: 'For booked status, endTime is required.',
          status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
        })
      }

      // So sánh thời gian chỉ tính đến giờ và phút
      if (!this.compareTimeIgnoreSeconds(endTime, startTime)) {
        throw new ErrorWithStatus({
          message: 'endTime must be greater than or equal to startTime (comparing only hours and minutes).',
          status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
        })
      }

      // Calculate duration in milliseconds
      const diffMs = endTime.getTime() - startTime.getTime()
      const minDurationMs = 0 // Cho phép duration = 0 (startTime = endTime)
      const maxDurationMs = 8 * 60 * 60 * 1000 // 8 hours in milliseconds

      // Validate minimum duration (cho phép = 0)
      if (diffMs < minDurationMs) {
        throw new ErrorWithStatus({
          message: 'Booking duration cannot be negative.',
          status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
        })
      }

      // Validate maximum duration
      if (diffMs > maxDurationMs) {
        throw new ErrorWithStatus({
          message: 'For booked status, the maximum duration is 8 hours.',
          status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
        })
      }
    }
    return { startTime, endTime }
  }

  /**
   * Tạo mới một event lịch phòng
   * @param schedule - Đối tượng lịch phòng {IRoomScheduleRequestBody}
   * @returns id của lịch phòng vừa tạo
   */
  async createSchedule(schedule: IRoomScheduleRequestBody) {
    // Validate và parse startTime, endTime dựa trên nghiệp vụ
    const { startTime, endTime } = this.validateScheduleTimes(schedule)

    const now = new Date()

    // Cho phép tạo lịch trong khoảng 5 phút trước thời điểm hiện tại
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    if (startTime.getTime() < fiveMinutesAgo.getTime()) {
      throw new ErrorWithStatus({
        message: 'Cannot create a schedule more than 5 minutes in the past.',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Nếu không có endTime (ví dụ: trạng thái "in use"), sử dụng effectiveNewEndTime là một giá trị xa trong tương lai
    const effectiveNewEndTime = endTime || new Date('9999-12-31T23:59:59.999Z')

    // Kiểm tra event trùng lặp:
    // Truy vấn các event có cùng roomId và có khoảng thời gian giao nhau với event mới.
    // Lưu ý: Loại trừ những event có trạng thái "cancelled" hoặc "finished"
    const overlap = await databaseService.roomSchedule.findOne({
      roomId: new ObjectId(schedule.roomId),
      status: { $nin: [RoomScheduleStatus.Cancelled, RoomScheduleStatus.Finished] },
      $or: [
        {
          // Nếu event có endTime xác định: bắt đầu trước effectiveNewEndTime và kết thúc sau startTime
          startTime: { $lt: effectiveNewEndTime },
          endTime: { $gt: startTime }
        },
        {
          // Nếu event hiện tại chưa có endTime (đang "in use"): coi như luôn giao nhau nếu bắt đầu trước effectiveNewEndTime
          endTime: null,
          startTime: { $lt: effectiveNewEndTime }
        }
      ]
    })

    console.log('overlap', overlap)

    if (overlap) {
      // Kiểm tra nếu event trùng lặp có status là Finished hoặc finish, thì vẫn cho phép tạo mới
      if (overlap.status === RoomScheduleStatus.Finished) {
        // Cho phép tạo event mới nếu event trùng lặp đã kết thúc
        console.log('Allowing new event creation because overlapping event is finished')
      } else {
        // Nếu tìm thấy event giao nhau và không phải trạng thái Finished, ném lỗi
        throw new ErrorWithStatus({
          message: 'An overlapping event exists for the room.',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
    }

    // Nếu không có overlap, tiến hành tạo event mới
    // Sinh bookingCode nếu status là Booked
    let bookingCode: string | undefined
    if (schedule.status === RoomScheduleStatus.Booked) {
      bookingCode = await generateUniqueBookingCode(async (code) => {
        const existingSchedule = await databaseService.roomSchedule.findOne({ bookingCode: code })
        return !!existingSchedule
      })
    }

    const scheduleData = new RoomSchedule(
      schedule.roomId,
      startTime,
      schedule.status,
      endTime,
      schedule.createdBy || 'system',
      schedule.updatedBy || 'system',
      schedule.note,
      schedule.source || BookingSource.Staff, // Sử dụng source được cung cấp hoặc mặc định là Staff
      schedule.applyFreeHourPromo,
      bookingCode
    )

    // Đánh dấu lịch có quà nếu admin/staff chọn
    const giftEnabled = schedule.giftEnabled ?? false
    scheduleData.giftEnabled = !!giftEnabled

    const result = await databaseService.roomSchedule.insertOne(scheduleData)

    // Emit thông báo gift cho đúng roomIndex nếu giftEnabled
    if (scheduleData.giftEnabled) {
      const room = await databaseService.rooms.findOne({ _id: scheduleData.roomId })
      if (room?.roomId !== undefined && room?.roomId !== null) {
        const roomIndex = String(room.roomId)
        roomEventEmitter.emit('gift_enabled', {
          roomId: roomIndex,
          scheduleId: result.insertedId.toString()
        })
      }
    }

    // Tự động tạo FNB order trống cho room schedule từ admin/staff
    try {
      const emptyOrder = {
        drinks: {},
        snacks: {}
      }
      await fnbOrderService.createFnbOrder(result.insertedId.toString(), emptyOrder, schedule.createdBy || 'system')
      console.log(`Đã tạo FNB order tự động cho room schedule: ${result.insertedId}`)
    } catch (fnbOrderError) {
      console.error('Lỗi khi tạo FNB order tự động:', fnbOrderError)
      // Không fail toàn bộ request nếu chỉ lỗi tạo FNB order
    }

    return result.insertedId
  }

  /**
   * Xóa tất cả các cache liên quan đến phòng
   * @param roomId - ID của phòng cần xóa cache
   */
  async clearRoomCache(roomId: string): Promise<void> {
    try {
      console.log(`Clearing all cache for room ${roomId}`)

      // Xóa tất cả dữ liệu Redis liên quan đến phòng
      await Promise.all([
        // Bỏ các lệnh xóa cache bài hát
        // redis.del(`room_${roomId}_queue`),
        // redis.del(`room_${roomId}_now_playing`),
        // redis.del(`room_${roomId}_playback`),
        // redis.del(`room_${roomId}_current_time`),
        redis.del(`room_${roomId}_notification`)
      ])

      // Bỏ các lệnh emit events về bài hát
      // roomEventEmitter.emit('queue_updated', { roomId, queue: [] })
      // roomEventEmitter.emit('now_playing_cleared', { roomId })
      // roomEventEmitter.emit('now_playing', { roomId, nowPlaying: null })
      // roomEventEmitter.emit('playback_status', { roomId, playbackStatus: 'stopped' })
      // roomEventEmitter.emit('current_time', { roomId, currentTime: 0 })

      console.log(`Successfully cleared notification cache for room ${roomId}`)
    } catch (error) {
      console.error(`Error clearing cache for room ${roomId}:`, error)
    }
  }

  /**
   * Cập nhật event lịch phòng
   * @param id - RoomSchedule id
   * @param schedule - Đối tượng lịch phòng cần cập nhật {IRoomScheduleRequestBody}
   * @returns Số lượng bản ghi được cập nhật
   */
  async updateSchedule(id: string, schedule: IRoomScheduleRequestBody) {
    const updateData: Partial<RoomSchedule> = {}

    // Lấy thông tin hiện tại của lịch phòng
    const currentSchedule = await databaseService.roomSchedule.findOne({ _id: new ObjectId(id) })
    if (!currentSchedule) {
      throw new ErrorWithStatus({
        message: 'Schedule not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const previousGiftEnabled = !!currentSchedule.giftEnabled

    if (schedule.startTime) {
      updateData.startTime = new Date(schedule.startTime)
    }
    if (schedule.endTime !== undefined) {
      updateData.endTime = schedule.endTime ? new Date(schedule.endTime) : null
    }
    if (schedule.status) {
      updateData.status = schedule.status
    }
    if (schedule.applyFreeHourPromo !== undefined) {
      updateData.applyFreeHourPromo = schedule.applyFreeHourPromo
    }
    // Có thể cập nhật thêm thông tin audit như updatedBy nếu cần
    updateData.updatedAt = new Date()
    if (schedule.updatedBy) {
      updateData.updatedBy = schedule.updatedBy
    }

    if (schedule.note) {
      updateData.note = schedule.note
    }
    if (schedule.giftEnabled !== undefined) {
      updateData.giftEnabled = !!schedule.giftEnabled
    }

    const result = await databaseService.roomSchedule.updateOne({ _id: new ObjectId(id) }, { $set: updateData })

    // Emit sự kiện khi giftEnabled thay đổi để FE ẩn/hiện nút mở quà
    const newGiftEnabled = schedule.giftEnabled !== undefined ? !!schedule.giftEnabled : previousGiftEnabled
    if (previousGiftEnabled !== newGiftEnabled) {
      const room = await databaseService.rooms.findOne({ _id: currentSchedule.roomId })
      if (room?.roomId !== undefined && room?.roomId !== null) {
        const roomIndex = String(room.roomId)
        roomEventEmitter.emit('gift_status_changed', {
          roomId: roomIndex,
          scheduleId: id,
          giftEnabled: newGiftEnabled
        })

        // Giữ nguyên event gift_enabled cho trường hợp bật quà (compatibility với client cũ)
        if (newGiftEnabled) {
          roomEventEmitter.emit('gift_enabled', { roomId: roomIndex, scheduleId: id })
        }
      }
    }

    // Nếu đang cập nhật trạng thái thành "Finished", chỉ xóa cache (không tự tạo bill)
    if (schedule.status === RoomScheduleStatus.Finished && currentSchedule.status !== RoomScheduleStatus.Finished) {
      // Bỏ dòng xóa cache để tránh lag
      await this.clearRoomCache(currentSchedule.roomId.toString())
    }

    return result.modifiedCount
  }

  /**
   * Hủy event lịch phòng: chỉ cho phép nếu event hiện tại đang ở trạng thái "booked"
   * @param id - RoomSchedule id
   * @returns Số lượng bản ghi được cập nhật
   */
  async cancelSchedule(id: string) {
    // Lấy event hiện tại theo id
    const currentEvent = await databaseService.roomSchedule.findOne({ _id: new ObjectId(id) })
    if (!currentEvent) {
      throw new ErrorWithStatus({
        message: 'Event not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    // Kiểm tra trạng thái hiện tại
    if (currentEvent.status !== RoomScheduleStatus.Booked) {
      throw new ErrorWithStatus({
        message: 'Only events in "booked" status can be cancelled',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const updateData = {
      status: RoomScheduleStatus.Cancelled,
      updatedAt: new Date(),
      updatedBy: 'system' // hoặc từ req.userId nếu có
    }
    const result = await databaseService.roomSchedule.updateOne({ _id: new ObjectId(id) }, { $set: updateData })
    return result.modifiedCount
  }

  /**
   * Hàm tự động hủy các booking có trạng thái "booked" mà đã vượt quá 15 phút kể từ startTime.
   * Nó sẽ tìm các booking thoả điều kiện và cập nhật status thành "cancelled".
   */
  async autoCancelLateBookings(): Promise<void> {
    try {
      const now = new Date()
      // Tính thời gian 15 phút trước thời điểm hiện tại
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000)

      // Tìm các booking với status "booked" mà startTime <= fifteenMinutesAgo
      const lateBookings = await databaseService.roomSchedule
        .find({
          status: RoomScheduleStatus.Booked,
          startTime: { $lte: fifteenMinutesAgo }
        })
        .toArray()

      // Với mỗi booking vượt hạn, cập nhật trạng thái thành "cancelled"
      for (const booking of lateBookings) {
        await databaseService.roomSchedule.updateOne(
          { _id: booking._id },
          { $set: { status: RoomScheduleStatus.Cancelled, updatedAt: new Date() } }
        )
        console.log(`Booking ${booking._id} cancelled automatically.`)
        // (Optional) Emit event hoặc thông báo đến client nếu cần
      }
    } catch (error) {
      console.error('Error in autoCancelLateBookings:', error)
    }
  }

  /**
   * autoFinishAllScheduleInADay
   * Finish (ho  c cancel) tất c  event c  trạng thái "booked" v  "ongoing" trong ng y
   */
  async autoFinishAllScheduleInADay(): Promise<void> {
    try {
      const now = new Date()
      // Tính điểm kết thúc của ngày hôm đó (ngày mai lúc 00:00)
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

      // Lấy danh sách các lịch phòng cần cập nhật trạng thái
      const schedulesToFinish = await databaseService.roomSchedule
        .find({
          startTime: { $lt: endOfDay },
          status: {
            $in: [
              RoomScheduleStatus.Booked,
              RoomScheduleStatus.InUse,
              RoomScheduleStatus.Locked,
              RoomScheduleStatus.Maintenance
            ]
          }
        })
        .toArray()

      // Cập nhật tất cả các event có startTime nhỏ hơn endOfDay và status là một trong các trạng thái cần tổng kết
      const result = await databaseService.roomSchedule.updateMany(
        {
          startTime: { $lt: endOfDay },
          status: {
            $in: [
              RoomScheduleStatus.Booked,
              RoomScheduleStatus.InUse,
              RoomScheduleStatus.Locked,
              RoomScheduleStatus.Maintenance
            ]
          }
        },
        { $set: { status: RoomScheduleStatus.Finished, updatedAt: new Date() } }
      )

      // Đối với mỗi lịch phòng đã cập nhật, xóa tất cả cache liên quan
      for (const schedule of schedulesToFinish) {
        await this.clearRoomCache(schedule.roomId.toString())
      }

      console.log(`${result.modifiedCount} events finished automatically.`)
      // (Optional) Emit event hoặc gửi thông báo tới client nếu cần
    } catch (error) {
      console.error('Error in autoFinishAllScheduleInADay:', error)
    }
  }

  /**
   * Tạo room schedules từ client bookings
   * @param bookingId - ID của booking cần chuyển đổi
   * @returns mảng các ObjectID của room schedules đã tạo
   */
  async createSchedulesFromBooking(bookingId: string) {
    try {
      // Tìm booking với ID đã cho, sử dụng ObjectId
      const booking = await databaseService.bookings.findOne({ _id: new ObjectId(bookingId) })

      if (!booking) {
        throw new ErrorWithStatus({
          message: 'Booking not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      if (booking.status !== 'pending') {
        throw new ErrorWithStatus({
          message: 'Only pending bookings can be converted',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Tìm room phù hợp với room_type
      const roomType = this.mapClientRoomTypeToEnum(booking.room_type)
      const room = await databaseService.rooms.findOne({ roomType })

      if (!room) {
        throw new ErrorWithStatus({
          message: `No available room found for type: ${booking.room_type}`,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      // Mảng chứa ID của các room schedules đã tạo
      const createdScheduleIds: ObjectId[] = []

      const timeZone = 'Asia/Ho_Chi_Minh'

      // Tạo room schedules cho từng time slot
      for (const timeSlot of booking.time_slots) {
        const [startTimeStr, endTimeStr] = timeSlot.split('-')

        // Tạo đối tượng ngày-giờ cho startTime và endTime
        const bookingDate = booking.booking_date // YYYY-MM-DD

        const startTime = dayjs.tz(`${bookingDate} ${startTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()
        const endTime = dayjs.tz(`${bookingDate} ${endTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()

        // Sinh bookingCode cho booking từ web customer
        const bookingCode = await generateUniqueBookingCode(async (code) => {
          const existingSchedule = await databaseService.roomSchedule.findOne({ bookingCode: code })
          return !!existingSchedule
        })

        // Tạo đối tượng RoomSchedule mới đánh dấu là từ khách hàng
        const newSchedule = new RoomSchedule(
          room._id.toString(),
          startTime,
          RoomScheduleStatus.Booked,
          endTime,
          'web_customer', // createdBy - đánh dấu người tạo là khách web
          'web_customer', // updatedBy
          `Booking by ${booking.customer_name} (${booking.customer_phone})`, // note
          BookingSource.Customer, // đánh dấu nguồn đặt phòng là từ khách hàng
          false, // applyFreeHourPromo default off for booking from customer
          bookingCode
        )

        // Lưu trực tiếp vào database không qua hàm createSchedule
        const result = await databaseService.roomSchedule.insertOne(newSchedule)
        createdScheduleIds.push(result.insertedId)

        // Tự động tạo FNB order trống cho mỗi room schedule từ booking
        try {
          const emptyOrder = {
            drinks: {},
            snacks: {}
          }
          await fnbOrderService.upsertFnbOrder(result.insertedId.toString(), emptyOrder, 'web_customer')
          console.log(`Đã tạo FNB order tự động cho booking schedule: ${result.insertedId}`)
        } catch (fnbOrderError) {
          console.error('Lỗi khi tạo FNB order tự động:', fnbOrderError)
          // Không fail toàn bộ request nếu chỉ lỗi tạo FNB order
        }
      }

      // Cập nhật trạng thái booking
      await databaseService.bookings.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            status: 'confirmed',
            room_schedules: createdScheduleIds.map((id) => id.toString())
          }
        }
      )

      return createdScheduleIds
    } catch (error) {
      console.error('Error creating schedules from booking:', error)
      throw error
    }
  }

  /**
   * Chuyển đổi room_type của client sang RoomType enum
   */
  private mapClientRoomTypeToEnum(clientRoomType: string): RoomType {
    switch (clientRoomType.toLowerCase()) {
      case 'small':
        return RoomType.Small
      case 'medium':
        return RoomType.Medium
      case 'large':
        return RoomType.Large
      default:
        throw new ErrorWithStatus({
          message: `Invalid room type: ${clientRoomType}`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
    }
  }

  /**
   * Tự động chuyển đổi booking mới thành room schedules
   * @param booking - Thông tin booking từ client
   * @returns mảng các ObjectId của room schedules đã tạo
   */
  async autoCreateSchedulesFromNewBooking(booking: ClientBooking) {
    try {
      // Kiểm tra booking phải có status là "pending"
      if (booking.status !== 'pending') {
        throw new ErrorWithStatus({
          message: 'Only pending bookings can be converted',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // Tìm room phù hợp với room_type
      const roomType = this.mapClientRoomTypeToEnum(booking.room_type)
      const room = await databaseService.rooms.findOne({ roomType })

      if (!room) {
        throw new ErrorWithStatus({
          message: `No available room found for type: ${booking.room_type}`,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      // Mảng chứa ID của các room schedules đã tạo
      const createdScheduleIds: ObjectId[] = []

      const timeZone = 'Asia/Ho_Chi_Minh'

      // Tạo room schedules cho từng time slot
      for (const timeSlot of booking.time_slots) {
        const [startTimeStr, endTimeStr] = timeSlot.split('-')

        // Tạo đối tượng ngày-giờ cho startTime và endTime
        const bookingDate = booking.booking_date // YYYY-MM-DD

        const startTime = dayjs.tz(`${bookingDate} ${startTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()
        const endTime = dayjs.tz(`${bookingDate} ${endTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()

        // Kiểm tra xem time slot đã được đặt chưa
        const existingSchedule = await databaseService.roomSchedule.findOne({
          roomId: room._id,
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

        if (existingSchedule) {
          throw new ErrorWithStatus({
            message: `Time slot ${timeSlot} is already booked for this room`,
            status: HTTP_STATUS_CODE.CONFLICT
          })
        }

        // Sinh bookingCode cho auto booking từ web customer
        const bookingCode = await generateUniqueBookingCode(async (code) => {
          const existingSchedule = await databaseService.roomSchedule.findOne({ bookingCode: code })
          return !!existingSchedule
        })

        // Tạo đối tượng RoomSchedule mới đánh dấu là từ khách hàng
        const newSchedule = new RoomSchedule(
          room._id.toString(),
          startTime,
          RoomScheduleStatus.Booked,
          endTime,
          'web_customer', // createdBy - đánh dấu người tạo là khách web
          'web_customer', // updatedBy
          `Booking by ${booking.customer_name} (${booking.customer_phone})`, // note
          BookingSource.Customer, // đánh dấu nguồn đặt phòng là từ khách hàng
          false, // applyFreeHourPromo default off for auto booking
          bookingCode
        )

        // Lưu trực tiếp vào database không qua hàm createSchedule
        const result = await databaseService.roomSchedule.insertOne(newSchedule)
        createdScheduleIds.push(result.insertedId)

        // Tự động tạo FNB order trống cho mỗi room schedule từ auto booking
        try {
          const emptyOrder = {
            drinks: {},
            snacks: {}
          }
          await fnbOrderService.upsertFnbOrder(result.insertedId.toString(), emptyOrder, 'web_customer')
          console.log(`Đã tạo FNB order tự động cho auto booking schedule: ${result.insertedId}`)
        } catch (fnbOrderError) {
          console.error('Lỗi khi tạo FNB order tự động:', fnbOrderError)
          // Không fail toàn bộ request nếu chỉ lỗi tạo FNB order
        }
      }

      // Cập nhật trạng thái booking thành confirmed ngay
      if (booking._id) {
        await databaseService.bookings.updateOne(
          { _id: typeof booking._id === 'string' ? new ObjectId(booking._id) : booking._id },
          {
            $set: {
              status: 'confirmed',
              room_schedules: createdScheduleIds.map((id) => id.toString())
            }
          }
        )
      }

      return createdScheduleIds
    } catch (error) {
      console.error('Error auto-creating schedules from new booking:', error)
      throw error
    }
  }
}

export const roomScheduleService = new RoomScheduleService()
