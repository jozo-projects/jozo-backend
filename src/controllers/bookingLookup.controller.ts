import { Request, Response, NextFunction } from 'express'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import databaseService from '~/services/database.service'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { RoomScheduleStatus } from '~/constants/enum'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * @description Search bookings by phone number with proper sorting
 * @path /api/bookings/search
 * @method GET
 * @query phone: số điện thoại
 */
export const searchBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.query

    // Validate phone number
    if (!phone || typeof phone !== 'string') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Phone number is required'
      })
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '')

    // Find room schedules by phone number (including cancelled for history)
    const schedules = await databaseService.roomSchedule
      .find({
        customerPhone: { $regex: new RegExp(cleanPhone, 'i') },
        status: { $in: [RoomScheduleStatus.Booked, RoomScheduleStatus.InUse, RoomScheduleStatus.Cancelled] }
      })
      .sort({ startTime: 1 })
      .toArray()

    console.log('Schedules:', schedules)

    // Sort by createdAt descending (most recent first) - manual sort to ensure correct order
    schedules.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime()
      const dateB = new Date(b.createdAt || 0).getTime()
      return dateB - dateA // Descending order (newest first)
    })

    if (schedules.length === 0) {
      return res.status(HTTP_STATUS_CODE.OK).json({
        success: true,
        data: [],
        message: 'Không tìm thấy booking nào cho số điện thoại này'
      })
    }

    // Get room details for each schedule
    const bookingsWithDetails = await Promise.all(
      schedules.map(async (schedule) => {
        const room = await databaseService.rooms.findOne({
          _id: schedule.roomId
        })

        // Check if can modify/cancel
        const now = new Date()
        const canModify = schedule.startTime > now
        const canCancel = canModify && schedule.status === RoomScheduleStatus.Booked

        return {
          _id: schedule._id?.toString(),
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
          // Add room info and status for frontend
          roomName: room?.roomName,
          canModify,
          canCancel
        }
      })
    )

    res.status(HTTP_STATUS_CODE.OK).json({
      success: true,
      data: bookingsWithDetails,
      message: `Tìm thấy ${bookingsWithDetails.length} đặt phòng`
    })
  } catch (error) {
    console.error('Error searching bookings:', error)
    next(error)
  }
}

export const lookupBookingByPhone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.query

    // Validate phone number
    if (!phone || typeof phone !== 'string') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Phone number is required'
      })
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '')

    // Find bookings by phone number
    const bookings = await databaseService.bookings
      .find({
        customer_phone: { $regex: new RegExp(cleanPhone, 'i') },
        status: { $in: ['pending', 'confirmed'] } // Only show active bookings
      })
      .sort({ booking_date: -1 }) // Sort by booking date (most recent first)
      .toArray()

    if (bookings.length === 0) {
      return res.status(HTTP_STATUS_CODE.OK).json({
        phone: phone,
        bookings: [],
        message: 'No bookings found for this phone number'
      })
    }

    // Get room details for each booking
    const bookingsWithDetails = await Promise.all(
      bookings.map(async (booking) => {
        // Get room information if room_schedules exist
        let roomInfo = null
        if (booking.room_schedules && booking.room_schedules.length > 0) {
          const roomSchedule = await databaseService.roomSchedule.findOne({
            _id: new ObjectId(booking.room_schedules[0])
          })

          if (roomSchedule) {
            const room = await databaseService.rooms.findOne({
              _id: roomSchedule.roomId
            })
            roomInfo = room
              ? {
                  roomId: room._id.toString(),
                  roomName: room.roomName,
                  roomType: room.roomType,
                  roomId_number: room.roomId
                }
              : null
          }
        }

        // Calculate if booking can be modified/cancelled
        const bookingDate = dayjs.tz(booking.booking_date, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh')
        const now = dayjs().tz('Asia/Ho_Chi_Minh')
        const canModify = bookingDate.isAfter(now) // Can modify if booking is in the future

        return {
          bookingId: booking._id.toString(),
          customerName: booking.customer_name,
          customerPhone: booking.customer_phone,
          customerEmail: booking.customer_email,
          roomType: booking.room_type,
          bookingDate: booking.booking_date,
          timeSlots: booking.time_slots,
          status: booking.status,
          totalPrice: booking.total_price,
          createdAt: booking.created_at,
          roomInfo,
          canModify,
          canCancel: canModify && booking.status === 'pending' // Can only cancel pending bookings
        }
      })
    )

    res.status(HTTP_STATUS_CODE.OK).json({
      phone: phone,
      totalBookings: bookingsWithDetails.length,
      bookings: bookingsWithDetails
    })
  } catch (error) {
    console.error('Error looking up booking:', error)
    next(error)
  }
}

/**
 * @description Hủy booking
 * @path /api/bookings/:bookingId/cancel
 * @method PUT
 */
export const cancelBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params
    const { phone } = req.body // Verify phone number for security

    if (!ObjectId.isValid(bookingId)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid booking ID'
      })
    }

    if (!phone) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Phone number is required for verification'
      })
    }

    // Find the booking
    const booking = await databaseService.bookings.findOne({
      _id: new ObjectId(bookingId),
      customer_phone: { $regex: new RegExp(phone.replace(/[\s\-\(\)]/g, ''), 'i') }
    })

    if (!booking) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Booking not found or phone number does not match'
      })
    }

    // Check if booking can be cancelled
    const bookingDate = dayjs.tz(booking.booking_date, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh')
    const now = dayjs().tz('Asia/Ho_Chi_Minh')

    if (bookingDate.isBefore(now)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Cannot cancel past bookings'
      })
    }

    if (booking.status !== 'pending') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Only pending bookings can be cancelled'
      })
    }

    // Cancel the booking
    await databaseService.bookings.updateOne(
      { _id: new ObjectId(bookingId) },
      {
        $set: {
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'customer'
        }
      }
    )

    // Cancel related room schedules if they exist
    if (booking.room_schedules && booking.room_schedules.length > 0) {
      await databaseService.roomSchedule.updateMany(
        { _id: { $in: booking.room_schedules.map((id) => new ObjectId(id)) } },
        {
          $set: {
            status: RoomScheduleStatus.Cancelled,
            updatedAt: new Date(),
            updatedBy: 'customer'
          }
        }
      )
    }

    res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Booking cancelled successfully',
      bookingId: bookingId
    })
  } catch (error) {
    console.error('Error cancelling booking:', error)
    next(error)
  }
}

/**
 * @description Chỉnh sửa booking
 * @path /api/bookings/:bookingId/modify
 * @method PUT
 */
export const modifyBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params
    const { phone, customerName, customerEmail, timeSlots } = req.body

    if (!ObjectId.isValid(bookingId)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid booking ID'
      })
    }

    if (!phone) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Phone number is required for verification'
      })
    }

    // Find the booking
    const booking = await databaseService.bookings.findOne({
      _id: new ObjectId(bookingId),
      customer_phone: { $regex: new RegExp(phone.replace(/[\s\-\(\)]/g, ''), 'i') }
    })

    if (!booking) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Booking not found or phone number does not match'
      })
    }

    // Check if booking can be modified
    const bookingDate = dayjs.tz(booking.booking_date, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh')
    const now = dayjs().tz('Asia/Ho_Chi_Minh')

    if (bookingDate.isBefore(now)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Cannot modify past bookings'
      })
    }

    if (booking.status !== 'pending') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Only pending bookings can be modified'
      })
    }

    // Prepare update data
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (customerName) updateData.customer_name = customerName
    if (customerEmail !== undefined) updateData.customer_email = customerEmail
    if (timeSlots) {
      updateData.time_slots = timeSlots
      // TODO: Validate new time slots don't conflict with existing bookings
    }

    // Update the booking
    await databaseService.bookings.updateOne({ _id: new ObjectId(bookingId) }, { $set: updateData })

    res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Booking modified successfully',
      bookingId: bookingId
    })
  } catch (error) {
    console.error('Error modifying booking:', error)
    next(error)
  }
}
