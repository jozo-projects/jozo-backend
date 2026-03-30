import { ObjectId } from 'mongodb'
import { RoomScheduleStatus, RoomType } from '~/constants/enum'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'
import databaseService from './database.service'
import { roomScheduleService } from './roomSchedule.service'
import { ErrorWithStatus } from '~/models/Error'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { emitBookingNotification } from './room.service'
import { LOCKED_ROOM_IDS } from '~/controllers/booking.controller'
import { generateUniqueBookingCode } from '~/utils/common'

dayjs.extend(utc)
dayjs.extend(timezone)

// Định nghĩa interface cho booking từ client
interface IClientBooking {
  _id?: string // ID dạng string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  room_type: string // 'small', 'medium', 'large'
  booking_date: string // YYYY-MM-DD
  time_slots: string[] // ['17:00-18:00', '18:00-19:00']
  status: string // 'pending'
  total_price: number
  created_at: string
  bookingCode?: string // Mã booking 4 chữ số (0000-9999)
  dateOfUse?: string // Ngày sử dụng (YYYY-MM-DD)
}

class BookingService {
  /**
   * So sánh thời gian chỉ tính đến giờ và phút, bỏ qua giây
   * @param time1 - Thời gian thứ nhất (dayjs object)
   * @param time2 - Thời gian thứ hai (dayjs object)
   * @returns true nếu time1 >= time2 (chỉ tính giờ và phút)
   */
  private compareTimeIgnoreSeconds(time1: any, time2: any): boolean {
    const time1Minutes = time1.hour() * 60 + time1.minute()
    const time2Minutes = time2.hour() * 60 + time2.minute()
    return time1Minutes >= time2Minutes
  }

  /**
   * Parse time slot (HH:mm-HH:mm) với booking date, cho phép slot qua đêm (vd: 23:00-01:00).
   * Nếu endTime cùng ngày nhỏ hơn startTime thì coi endTime là ngày hôm sau.
   */
  private parseTimeSlotWithOvernight(
    bookingDate: string,
    timeSlot: string,
    timeZone: string
  ): { startTime: Date; endTime: Date } {
    const [startTimeStr, endTimeStr] = timeSlot.split('-')
    const startTime = dayjs.tz(`${bookingDate} ${startTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()
    let endTime = dayjs.tz(`${bookingDate} ${endTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).toDate()
    if (endTime.getTime() <= startTime.getTime()) {
      endTime = dayjs.tz(`${bookingDate} ${endTimeStr}`, 'YYYY-MM-DD HH:mm', timeZone).add(1, 'day').toDate()
    }
    return { startTime, endTime }
  }

  /**
   * Validate dữ liệu booking từ client
   * @param body - Dữ liệu từ request body
   * @returns Validation result
   */
  validateBookingData(body: any): { isValid: boolean; error?: string } {
    if (
      !body.customer_name ||
      !body.customer_phone ||
      !body.room_type ||
      !body.booking_date ||
      !body.time_slots ||
      !body.time_slots.length
    ) {
      return {
        isValid: false,
        error: 'Missing required fields'
      }
    }

    // Kiểm tra phòng bị khóa
    if (body.room_id && LOCKED_ROOM_IDS.includes(body.room_id)) {
      return {
        isValid: false,
        error: 'This room is not available for booking'
      }
    }

    return { isValid: true }
  }

  /**
   * Tạo booking mới từ client và tự động chuyển đổi thành room schedules
   * @param body - Dữ liệu booking từ client
   * @returns Kết quả tạo booking
   */
  async createBooking(body: any): Promise<{
    success: boolean
    bookingId?: string
    scheduleIds?: string[]
    status: string
    message: string
    error?: string
  }> {
    try {
      // Validate dữ liệu
      const validation = this.validateBookingData(body)
      if (!validation.isValid) {
        return {
          success: false,
          status: 'error',
          message: validation.error!,
          error: validation.error
        }
      }

      // Sinh mã booking duy nhất cho ngày sử dụng
      const dateOfUse = body.booking_date // YYYY-MM-DD
      const bookingCode = await generateUniqueBookingCode(async (code) => {
        // Kiểm tra mã đã tồn tại trong cùng ngày chưa
        const existingBooking = await databaseService.bookings.findOne({
          dateOfUse,
          bookingCode: code
        })
        return !!existingBooking // return true nếu trùng
      })

      // Tạo booking mới với status pending
      const bookingData = {
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        customer_email: body.customer_email || null,
        room_type: body.room_type,
        booking_date: body.booking_date,
        time_slots: body.time_slots,
        status: 'pending',
        total_price: body.total_price || 0,
        created_at: new Date().toISOString(),
        bookingCode, // Mã booking 4 chữ số (0000-9999)
        dateOfUse // Ngày sử dụng (YYYY-MM-DD)
      }

      // Lưu booking vào DB
      const result = await databaseService.bookings.insertOne(bookingData)
      const bookingId = result.insertedId

      // Cố gắng chuyển đổi booking ngay lập tức
      try {
        // Lấy booking vừa tạo
        const booking = await databaseService.bookings.findOne({ _id: bookingId })
        if (booking) {
          console.log('Found booking to convert:', bookingId)

          // Chuyển đổi _id từ ObjectId sang string để phù hợp với định nghĩa IClientBooking
          const bookingWithStringId = {
            ...booking,
            _id: booking._id.toString()
          }

          console.log('Attempting to convert booking to room schedules...')

          // Chuyển đổi booking thành room schedules
          const scheduleIds = await this.convertClientBookingToRoomSchedule(bookingWithStringId)

          console.log('Conversion successful, created schedule IDs:', scheduleIds)

          return {
            success: true,
            bookingId: bookingId.toString(),
            scheduleIds: scheduleIds,
            status: 'confirmed',
            message: 'Booking created and automatically converted to room schedules successfully'
          }
        } else {
          console.error('Could not find the booking that was just created:', bookingId)
        }
      } catch (conversionError) {
        console.error('Error auto-converting booking:', conversionError)
        if (conversionError instanceof Error) {
          console.error('Error details:', conversionError.message)
          console.error('Error stack:', conversionError.stack)
        }

        // Send real-time notification for failed booking conversion
        try {
          // Find any room matching the room type to send notification
          const rooms = await databaseService.rooms
            .find({
              roomType: { $regex: new RegExp(body.room_type, 'i') }
            })
            .toArray()

          if (rooms && rooms.length > 0) {
            emitBookingNotification(rooms[0]._id.toString(), {
              bookingId: bookingId.toString(),
              customer: body.customer_name,
              phone: body.customer_phone,
              roomType: body.room_type,
              timeSlots: body.time_slots,
              bookingDate: body.booking_date,
              status: 'pending',
              error: conversionError instanceof Error ? conversionError.message : 'Unknown error'
            })
          }
        } catch (notificationError) {
          console.error('Error sending real-time notification:', notificationError)
        }
      }

      // Nếu không thể tự động chuyển đổi, trả về kết quả mặc định
      return {
        success: true,
        bookingId: bookingId.toString(),
        status: 'pending',
        message: 'Booking created successfully but could not be automatically converted'
      }
    } catch (error) {
      console.error('Error in createBooking:', error)
      return {
        success: false,
        status: 'error',
        message: 'Failed to create booking',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Chuyển đổi booking của client thành các RoomSchedule entries
   * @param clientBooking - Thông tin booking từ client
   */
  async convertClientBookingToRoomSchedule(clientBooking: IClientBooking): Promise<string[]> {
    console.log('Starting conversion of booking to room schedule:', clientBooking._id)

    try {
      // Validate time slots before processing (cho phép slot qua đêm, vd: 23:00-01:00)
      const timeZone = 'Asia/Ho_Chi_Minh'
      const minDurationMs = 30 * 60 * 1000 // 30 phút
      const maxDurationMs = 8 * 60 * 60 * 1000 // 8 giờ
      for (const timeSlot of clientBooking.time_slots) {
        const { startTime, endTime } = this.parseTimeSlotWithOvernight(
          clientBooking.booking_date,
          timeSlot,
          timeZone
        )
        const diffMs = endTime.getTime() - startTime.getTime()
        if (diffMs < minDurationMs) {
          throw new ErrorWithStatus({
            message: `Thời gian đặt phòng tối thiểu là 30 phút. Invalid time slot: ${timeSlot}`,
            status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
          })
        }
        if (diffMs > maxDurationMs) {
          throw new ErrorWithStatus({
            message: `Thời gian đặt phòng tối đa là 8 giờ. Invalid time slot: ${timeSlot}`,
            status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY
          })
        }
      }

      // Kiểm tra xem booking này đã được chuyển đổi thành công trước đó chưa
      if (clientBooking._id) {
        const existingBooking = await databaseService.bookings.findOne({
          _id: clientBooking._id,
          status: 'confirmed' // Nếu status là confirmed thì đã được xử lý
        })

        if (existingBooking && existingBooking.room_schedules && existingBooking.room_schedules.length > 0) {
          console.log(
            `Booking ${clientBooking._id} đã được chuyển đổi trước đó, trả về room schedules đã tạo.`,
            existingBooking.room_schedules
          )
          return existingBooking.room_schedules
        }

        // Kiểm tra xem đã có room schedule cho booking này chưa
        const existingSchedules = await databaseService.roomSchedule
          .find({
            note: { $regex: new RegExp(`Booking by ${clientBooking.customer_name}.*${clientBooking.customer_phone}`) }
          })
          .toArray()

        if (existingSchedules.length > 0) {
          console.log(`Đã tìm thấy ${existingSchedules.length} room schedule cho booking ${clientBooking._id}`)

          // Cập nhật trạng thái booking thành confirmed
          await databaseService.bookings.updateOne(
            { _id: clientBooking._id },
            {
              $set: {
                status: 'confirmed',
                room_schedules: existingSchedules.map((s) => s._id.toString())
              }
            }
          )

          return existingSchedules.map((s) => s._id.toString())
        }
      }

      // Log the booking data
      console.log('Booking details:', {
        customer: clientBooking.customer_name,
        phone: clientBooking.customer_phone,
        roomType: clientBooking.room_type,
        date: clientBooking.booking_date,
        timeSlots: clientBooking.time_slots
      })

      // 1. Tìm roomId phù hợp với room_type
      const roomType = this.mapClientRoomTypeToEnum(clientBooking.room_type)
      console.log('Mapped room type:', roomType)

      // Tìm phòng phù hợp với room_type
      let room
      try {
        // Sử dụng regex để tìm kiếm không phân biệt chữ hoa/thường
        console.log('Excluding locked rooms with IDs:', LOCKED_ROOM_IDS)

        const rooms = await databaseService.rooms
          .find({
            roomType: { $regex: new RegExp(roomType, 'i') },
            // Loại bỏ các phòng bị khóa khỏi kết quả tìm kiếm
            _id: { $nin: LOCKED_ROOM_IDS.map((id) => new ObjectId(id)) }
          })
          .toArray()
        console.log(
          `Found ${rooms.length} rooms matching room type ${roomType} (case insensitive, excluding locked rooms)`
        )

        if (rooms.length === 0) {
          throw new Error(`No available rooms found for room type: ${roomType}`)
        }

        // Kiểm tra xem phòng đã có lịch đặt chưa
        for (const candidateRoom of rooms) {
          console.log(`Checking availability for room: ${candidateRoom._id} (${candidateRoom.roomName})`)

          // Kiểm tra từng time slot (hỗ trợ qua đêm)
          let isRoomAvailable = true
          for (const timeSlot of clientBooking.time_slots) {
            console.log(`Checking time slot: ${timeSlot}`)
            const { startTime, endTime } = this.parseTimeSlotWithOvernight(
              clientBooking.booking_date,
              timeSlot,
              'Asia/Ho_Chi_Minh'
            )
            console.log(`Converted time: ${startTime.toISOString()} to ${endTime.toISOString()}`)

            // Kiểm tra xem thời gian này đã được đặt chưa
            const existingSchedule = await databaseService.roomSchedule.findOne({
              roomId: candidateRoom._id,
              $or: [
                { startTime: { $lt: endTime }, endTime: { $gt: startTime } },
                { startTime: { $lt: endTime }, endTime: null }
              ]
            })

            if (existingSchedule) {
              console.log(
                `Room ${candidateRoom.roomName} is not available for time slot ${timeSlot} - existing booking found`
              )
              isRoomAvailable = false
              break
            }
          }

          if (isRoomAvailable) {
            room = candidateRoom
            console.log(`Found available room: ${room.roomName} (${room._id})`)
            break
          }
        }

        if (!room) {
          throw new Error(`No available rooms found for room type ${roomType} at the requested time slots`)
        }
      } catch (error) {
        console.error('Error finding available room:', error)
        throw new Error(`Could not find an available room: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // After finding appropriate room
      console.log('Found room for booking:', room ? room._id : 'No room found')

      // Mảng kết quả chứa các ID của room schedules đã tạo
      const createdScheduleIds: ObjectId[] = []

      // 2. Tạo các room schedules cho từng time slot (hỗ trợ qua đêm)
      const timeZone = 'Asia/Ho_Chi_Minh'
      for (const timeSlot of clientBooking.time_slots) {
        const { startTime, endTime } = this.parseTimeSlotWithOvernight(
          clientBooking.booking_date,
          timeSlot,
          timeZone
        )

        // Tạo đối tượng RoomSchedule mới
        const scheduleData = {
          roomId: room._id.toString(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          status: RoomScheduleStatus.Booked,
          note: `Booking by ${clientBooking.customer_name} (${clientBooking.customer_phone})`
        }

        // Lưu RoomSchedule vào database
        try {
          const scheduleId = await roomScheduleService.createSchedule(scheduleData)
          createdScheduleIds.push(scheduleId)
        } catch (error) {
          // Nếu có lỗi khi tạo lịch (ví dụ: trùng lịch), log lỗi và tiếp tục
          console.error(`Failed to create schedule for time slot ${timeSlot}:`, error)
          throw error // Ném lỗi để xử lý ở controller
        }
      }

      // 3. Cập nhật trạng thái booking trong collection bookings nếu có _id
      if (clientBooking._id) {
        // Cập nhật trực tiếp với _id dạng string
        await databaseService.bookings.updateOne(
          { _id: clientBooking._id },
          {
            $set: {
              status: 'confirmed',
              room_schedules: createdScheduleIds.map((id) => id.toString())
            }
          }
        )
      }

      // Send real-time notification
      emitBookingNotification(room._id.toString(), {
        bookingId: clientBooking._id,
        customer: clientBooking.customer_name,
        phone: clientBooking.customer_phone,
        roomName: room.roomName,
        timeSlots: clientBooking.time_slots,
        bookingDate: clientBooking.booking_date,
        status: 'confirmed',
        scheduleIds: createdScheduleIds.map((id) => id.toString())
      })

      return createdScheduleIds.map((id) => id.toString())
    } catch (error) {
      console.error('Error in convertClientBookingToRoomSchedule:', error)
      throw error
    }
  }

  /**
   * Map room type string from client to enum
   * @param roomType Room type string from client
   * @returns Room type enum
   */
  private mapClientRoomTypeToEnum(roomType: string): RoomType {
    console.log('Mapping client room type:', roomType)

    // Convert to lowercase for case-insensitive comparison
    const type = roomType.toLowerCase()

    // Log all available room types in database for debugging
    databaseService.rooms.distinct('roomType').then((types) => {
      console.log('Available room types in database:', types)
    })

    // Map client room type to enum
    switch (type) {
      case 'small':
      case 'nhỏ':
      case 'nho':
        return RoomType.Small
      case 'medium':
      case 'trung bình':
      case 'trung binh':
      case 'vừa':
      case 'vua':
        return RoomType.Medium
      case 'large':
      case 'lớn':
      case 'lon':
        return RoomType.Large
      default:
        // If unknown, log it and throw error
        console.log('Unknown room type:', roomType)
        throw new Error(`Invalid room type: ${roomType}`)
    }
  }
}

export const bookingService = new BookingService()
