/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */
import axios from 'axios'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { ObjectId } from 'mongodb'
import { DayType, RoomScheduleStatus } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { IBill } from '~/models/schemas/Bill.schema'
import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'
import fnbOrderService from './fnbOrder.service'
import { holidayService } from './holiday.service'

// Cấu hình timezone và plugins cho dayjs
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isBetween)
dayjs.extend(isSameOrBefore)
dayjs.tz.setDefault('Asia/Ho_Chi_Minh')

// Ensure all date objects are using the correct timezone
function ensureVNTimezone(date: Date | string | null | undefined): Date {
  if (!date) {
    // Return current date as fallback if date is null or undefined
    return dayjs().tz('Asia/Ho_Chi_Minh').toDate()
  }

  // FIX: Luôn xử lý như UTC nếu có 'Z' trong string hoặc là Date object
  const dateStr = String(date)
  if (dateStr.includes('Z') || date instanceof Date) {
    // Nếu là UTC string hoặc Date object, parse như UTC rồi chuyển về VN time
    return dayjs.utc(date).tz('Asia/Ho_Chi_Minh').toDate()
  }

  // Nếu không phải UTC, sử dụng timezone hiện tại
  return dayjs(date).tz('Asia/Ho_Chi_Minh').toDate()
}

// Khai báo biến toàn cục để lưu USB adapter
let usbAdapter: any = null

// Extend the escpos Printer type to include custom methods
declare module 'escpos' {
  interface Printer {
    tableCustom(data: Array<{ text: string; width: number; align: string }>): Printer
    feed(n: number): Printer
    style(type: 'b' | 'i' | 'u' | 'normal'): Printer
  }
}

// Fix USB.findPrinter overloads
declare module 'escpos-usb' {
  function findPrinter(deviceId?: any): any[]
  function findPrinter(deviceId: any, callback: (err: any, device: any) => void): void
}

// TextPrinter class để giả lập printer
class TextPrinter {
  private content: string[] = []
  private currentAlign: 'lt' | 'ct' | 'rt' = 'lt'
  private currentStyle: 'normal' | 'b' | 'i' = 'normal'
  private currentSize: [number, number] = [0, 0]
  private readonly PAPER_WIDTH = 48 // Độ rộng chuẩn cho giấy 80mm

  constructor() {}

  font(_: string) {
    return this
  }

  align(alignment: 'lt' | 'ct' | 'rt') {
    this.currentAlign = alignment
    return this
  }

  style(style: 'normal' | 'b' | 'i') {
    this.currentStyle = style
    return this
  }

  size(width: number, height: number) {
    this.currentSize = [width, height]
    return this
  }

  text(str: string) {
    // Xử lý xuống dòng từ \n
    const lines = str.split('\n')

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]

      // Nếu là dòng gạch ngang, chuẩn hóa độ dài
      if (/^-+$/.test(line)) {
        line = '-'.repeat(this.PAPER_WIDTH)
      } else {
        // Cắt chuỗi nếu dài hơn độ rộng giấy
        if (line.length > this.PAPER_WIDTH) {
          line = line.substring(0, this.PAPER_WIDTH)
        }

        // Xử lý căn lề
        if (this.currentAlign === 'ct') {
          // Tính toán padding trái và phải để căn giữa chính xác
          const totalPadding = this.PAPER_WIDTH - line.length
          const leftPadding = Math.floor(totalPadding / 2)
          const rightPadding = totalPadding - leftPadding
          line = ' '.repeat(leftPadding) + line + ' '.repeat(rightPadding)
        } else if (this.currentAlign === 'rt') {
          line = line.padStart(this.PAPER_WIDTH)
        } else {
          // Căn trái (lt)
          line = line.padEnd(this.PAPER_WIDTH)
        }
      }

      this.content.push(line)
    }

    return this
  }

  feed(lines: number) {
    for (let i = 0; i < lines; i++) {
      this.content.push('')
    }
    return this
  }

  tableCustom(data: Array<{ text: string; width: number; align: string }>) {
    let line = ''
    let currentWidth = 0

    data.forEach((col, index) => {
      const isLastColumn = index === data.length - 1
      const colWidth = isLastColumn ? this.PAPER_WIDTH - currentWidth : Math.floor(this.PAPER_WIDTH * col.width)

      currentWidth += colWidth
      let text = col.text

      // Chỉ cắt text nếu không phải là phí dịch vụ thu âm
      if (text.length > colWidth && !text.includes('Phi dich vu thu am')) {
        text = text.substring(0, colWidth - 3) + '...'
      }

      // Nếu là phí dịch vụ thu âm và quá dài, tạo dòng mới
      if (text.includes('Phi dich vu thu am') && text.length > colWidth) {
        // Xử lý sau trong phần in chi tiết
        text = text
      }

      // Căn lề cho từng cột
      if (col.align === 'right') {
        text = text.padStart(colWidth)
      } else if (col.align === 'center') {
        const padding = Math.floor((colWidth - text.length) / 2)
        text = ' '.repeat(padding) + text.padEnd(colWidth - padding)
      } else {
        text = text.padEnd(colWidth)
      }

      line += text
    })

    // Đảm bảo dòng không vượt quá độ rộng giấy
    if (line.length > this.PAPER_WIDTH) {
      // Nếu dòng chứa phí dịch vụ thu âm, giữ nguyên
      if (!line.includes('Phi dich vu thu am')) {
        line = line.substring(0, this.PAPER_WIDTH)
      }
    }

    this.content.push(line)
    return this
  }

  getText(): string {
    return this.content.join('\n') + '\n'
  }
}

export class BillService {
  private deviceData: any // Lưu thông tin thiết bị USB được tìm thấy
  private transactionHistory: Array<IBill> = [] // Lưu lịch sử giao dịch
  private printer: any
  private lastPrintTime: number = 0 // Thời gian in lần cuối
  private printQueue: Array<() => Promise<any>> = [] // Queue để tránh conflict
  private isPrinting: boolean = false // Flag đang in

  constructor() {
    this.initEscPos()
  }

  private async initEscPos() {
    try {
      // Lazy load escpos-usb để tránh lỗi khi khởi tạo
      usbAdapter = require('escpos-usb')

      // Tìm kiếm các thiết bị máy in
      const devices = usbAdapter.findPrinter()
      if (devices && devices.length > 0) {
        this.deviceData = devices[0]
        console.log('Tìm thấy máy in:', this.deviceData)
      } else {
        console.log('Không tìm thấy máy in USB nào')
      }
    } catch (error) {
      console.error('Không thể khởi tạo escpos:', error)
    }
  }

  private async determineDayType(date: Date): Promise<DayType> {
    // Convert to Vietnam timezone before checking type
    const vnDate = ensureVNTimezone(date)

    // Check if it's a holiday first
    const isHoliday = await holidayService.isHoliday(vnDate)
    if (isHoliday) {
      return DayType.Holiday
    }

    // If not a holiday, check if it's weekend
    const day = vnDate.getDay()
    if (day === 0 || day === 6) {
      return DayType.Weekend
    } else {
      return DayType.Weekday
    }
  }

  /**
   * Calculate hours between two dates based only on hours and minutes, ignoring seconds and milliseconds
   * @param start Start date
   * @param end End date
   * @returns Number of hours
   */
  calculateHours(start: Date | string, end: Date | string): number {
    // Chuyển đổi thời gian về múi giờ Việt Nam và reset seconds/milliseconds
    const startDate = dayjs(start).tz('Asia/Ho_Chi_Minh').second(0).millisecond(0)
    const endDate = dayjs(end).tz('Asia/Ho_Chi_Minh').second(0).millisecond(0)

    // Check if end date is before start date, which would produce negative values
    if (endDate.isBefore(startDate)) {
      console.warn(`Warning: End date (${endDate.format()}) is before start date (${startDate.format()})`)
      // Return a small positive value to avoid negative calculations
      return 0.5
    }

    // Tính chênh lệch theo giây để tránh mất 59 giây cuối cùng (ví dụ 18:00-19:00)
    const diffSeconds = endDate.diff(startDate, 'second')
    // Chuyển sang giờ và làm tròn 2 chữ số thập phân
    const diffHours = diffSeconds / 3600
    const result = Math.round(diffHours * 100) / 100

    return result
  }

  private async getServiceUnitPrice(startTime: Date, dayType: DayType, roomType: string): Promise<number> {
    const priceDoc = await databaseService.price.findOne({ day_type: dayType })
    if (!priceDoc || !priceDoc.time_slots) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy cấu hình giá',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Sử dụng timezone Vietnam/Asia
    if (!dayjs.tz) {
      dayjs.extend(require('dayjs/plugin/utc'))
      dayjs.extend(require('dayjs/plugin/timezone'))
    }

    // Lấy thời gian bắt đầu dưới dạng HH:mm để so sánh với khung giờ, sử dụng múi giờ Việt Nam
    const time = dayjs(startTime).tz('Asia/Ho_Chi_Minh').format('HH:mm')

    // Tìm khung giờ phù hợp với thời gian bắt đầu
    const timeSlot = priceDoc.time_slots.find((slot: any) => {
      const slotStart = slot.start
      const slotEnd = slot.end

      // Xử lý trường hợp khung giờ bắt đầu > khung giờ kết thúc (qua ngày)
      if (slotStart > slotEnd) {
        return time >= slotStart || time <= slotEnd
      }
      // Trường hợp bình thường
      return time >= slotStart && time <= slotEnd
    })

    if (!timeSlot) {
      // Nếu không tìm thấy khung giờ, lấy khung giờ mặc định hoặc khung giờ đầu tiên
      const defaultTimeSlot = priceDoc.time_slots[0] // Lấy khung giờ đầu tiên làm mặc định

      if (!defaultTimeSlot) {
        throw new ErrorWithStatus({
          message: 'Không tìm thấy khung giá phù hợp cho thời gian ' + time,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      const priceEntry = defaultTimeSlot.prices.find((p: any) => p.room_type === roomType)
      if (!priceEntry) {
        throw new ErrorWithStatus({
          message: 'Không tìm thấy giá cho loại phòng ' + roomType,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      return priceEntry.price
    }

    const priceEntry = timeSlot.prices.find((p: any) => p.room_type === roomType)
    if (!priceEntry) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy giá cho loại phòng ' + roomType,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return priceEntry.price
  }

  async getBill(
    scheduleId: string,
    actualEndTime?: string,
    paymentMethod?: string,
    promotionId?: string,
    actualStartTime?: string,
    applyFreeHourPromotion?: boolean
  ): Promise<IBill> {
    // Validate ObjectId format for scheduleId
    if (!ObjectId.isValid(scheduleId)) {
      throw new ErrorWithStatus({
        message: 'Invalid scheduleId format - must be a valid 24 character hex string',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const id = new ObjectId(scheduleId)
    const schedule = await databaseService.roomSchedule.findOne({ _id: id })

    // Lấy FNB order từ collection hiện tại trước
    let order = await fnbOrderService.getFnbOrdersByRoomSchedule(scheduleId)

    if (!order) {
      // Thử lấy từ history nếu không có order hiện tại
      const orderHistory = await fnbOrderService.getOrderHistoryByRoomSchedule(scheduleId)

      if (orderHistory.length > 0) {
        const historyOrder = orderHistory[orderHistory.length - 1]
        // Convert history record to RoomScheduleFNBOrder format
        order = {
          _id: historyOrder._id,
          roomScheduleId: historyOrder.roomScheduleId,
          order: historyOrder.order,
          createdBy: historyOrder.completedBy,
          updatedBy: historyOrder.completedBy
        } as any
      }
    }

    const room = await databaseService.rooms.findOne({ _id: schedule?.roomId })
    const menu = await databaseService.fnbMenu.find({}).toArray()

    if (!schedule) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy lịch đặt phòng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    const dayType = await this.determineDayType(dayjs.utc(schedule.startTime).tz('Asia/Ho_Chi_Minh').toDate())

    // Tính tổng snack và drinks để kiểm tra điều kiện áp dụng freeHourPromotion
    // Chỉ cần tổng snacks + drinks >= 35000 là đủ điều kiện
    let totalSnacksAndDrinks = 0
    if (order && order.order) {
      // Tính tổng đồ uống
      if (order.order.drinks && typeof order.order.drinks === 'object' && Object.keys(order.order.drinks).length > 0) {
        for (const [menuId, quantity] of Object.entries(order.order.drinks)) {
          const menuItem = await this.findMenuItemById(menuId, menu)
          if (menuItem) {
            const price = this.parsePrice(menuItem.price)
            totalSnacksAndDrinks += quantity * price
          }
        }
      }
      // Tính tổng đồ ăn
      if (order.order.snacks && typeof order.order.snacks === 'object' && Object.keys(order.order.snacks).length > 0) {
        for (const [menuId, quantity] of Object.entries(order.order.snacks)) {
          const menuItem = await this.findMenuItemById(menuId, menu)
          if (menuItem) {
            const price = this.parsePrice(menuItem.price)
            totalSnacksAndDrinks += quantity * price
          }
        }
      }
    }

    // Xử lý actualStartTime nếu được cung cấp
    let validatedStartTime: Date
    if (actualStartTime) {
      if (/^\d{2}:\d{2}$/.test(actualStartTime)) {
        // Nếu là định dạng HH:mm
        const [hours, minutes] = actualStartTime.split(':')
        // Sử dụng schedule.startTime đã được xử lý múi giờ đúng
        const baseDate = dayjs.utc(schedule.startTime).tz('Asia/Ho_Chi_Minh')
        validatedStartTime = baseDate.hour(parseInt(hours)).minute(parseInt(minutes)).second(0).millisecond(0).toDate()
      } else {
        // Nếu là định dạng datetime đầy đủ - reset giây và millisecond về 0
        validatedStartTime = dayjs(actualStartTime).tz('Asia/Ho_Chi_Minh').second(0).millisecond(0).toDate()

        if (!dayjs(validatedStartTime).isValid()) {
          throw new ErrorWithStatus({
            message: 'Thời gian bắt đầu không hợp lệ',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
      }
    } else {
      // Nếu không có actualStartTime, sử dụng schedule.startTime và reset giây/millisecond
      // FIX: Luôn xử lý thời gian từ DB như UTC và chuyển về VN time
      const rawStartTime = schedule.startTime

      // Luôn xử lý như UTC vì thời gian từ DB luôn là UTC
      // FIXED: Trước đây có thể xử lý sai múi giờ trong production
      const processedStartTime = dayjs.utc(rawStartTime).tz('Asia/Ho_Chi_Minh').toDate()

      validatedStartTime = dayjs(processedStartTime).second(0).millisecond(0).toDate()
    }

    // Convert times to Vietnam timezone
    const startTime = validatedStartTime

    // Kiểm tra và xử lý actualEndTime
    let validatedEndTime: Date

    if (actualEndTime && /^\d{2}:\d{2}$/.test(actualEndTime)) {
      // Nếu là định dạng HH:mm
      const [hours, minutes] = actualEndTime.split(':')
      validatedEndTime = dayjs(startTime)
        .hour(parseInt(hours))
        .minute(parseInt(minutes))
        .second(0)
        .millisecond(0)
        .toDate()

      // Khi end (HH:mm) trước start (HH:mm) trên cùng ngày => session qua đêm, coi end là ngày hôm sau
      // VD: start 23:00, end "01:00" => end = ngày tiếp theo 01:00 (không còn bị ép về 00:00 hay 23:59)
      if (!this.compareTimeIgnoreSeconds(validatedEndTime, startTime)) {
        validatedEndTime = dayjs(validatedEndTime).tz('Asia/Ho_Chi_Minh').add(1, 'day').toDate()
      }
    } else if (actualEndTime) {
      // Nếu là định dạng datetime đầy đủ - reset giây và millisecond về 0
      validatedEndTime = dayjs(actualEndTime).tz('Asia/Ho_Chi_Minh').second(0).millisecond(0).toDate()

      if (!dayjs(validatedEndTime).isValid()) {
        throw new ErrorWithStatus({
          message: 'Thời gian kết thúc không hợp lệ',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
    } else {
      // Nếu không có actualEndTime, sử dụng schedule.endTime và reset giây/millisecond
      if (schedule.endTime) {
        // FIX: Luôn xử lý thời gian từ DB như UTC và chuyển về VN time
        const rawEndTime = schedule.endTime

        // Luôn xử lý như UTC vì thời gian từ DB luôn là UTC
        // FIXED: Trước đây có thể xử lý sai múi giờ trong production
        const processedEndTime = dayjs.utc(rawEndTime).tz('Asia/Ho_Chi_Minh').toDate()

        validatedEndTime = dayjs(processedEndTime).second(0).millisecond(0).toDate()
      } else {
        // Nếu không có endTime, mặc định là startTime + 1 giờ
        validatedEndTime = dayjs(startTime).add(1, 'hour').second(0).millisecond(0).toDate()
      }
    }

    const sessionDurationSeconds = dayjs(validatedEndTime).diff(dayjs(startTime), 'second')
    const sessionDurationMinutes = Math.ceil(sessionDurationSeconds / 60)

    // Kiểm tra điều kiện áp dụng freeHourPromotion:
    // 1. FE phải gửi flag applyFreeHourPromotion = true
    // 2. Tổng snacks + drinks >= 35000
    // 3. Thời gian sử dụng >= 120 phút
    const eligibleForFreeHour =
      applyFreeHourPromotion === true && totalSnacksAndDrinks >= 35000 && sessionDurationMinutes >= 120

    let freeMinutesLeft = eligibleForFreeHour ? 60 : 0
    let freeMinutesApplied = 0
    let freeAmountTotal = 0

    // Lấy thông tin bảng giá cho loại ngày (weekday/weekend)
    const priceDoc = await databaseService.price.findOne({ day_type: dayType })
    if (!priceDoc || !priceDoc.time_slots) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy cấu hình giá',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Tính toán phí dịch vụ với việc xét tất cả các khung giờ một cách linh hoạt
    let totalServiceFee = 0
    let totalHoursUsed = 0
    const timeSlotItems: Array<{
      description: string
      quantity: number
      price: number
      totalPrice: number
      discountPercentage?: number
      discountName?: string
    }> = []

    // Sắp xếp các khung giờ theo thời gian bắt đầu
    const sortedTimeSlots = [...priceDoc.time_slots].sort((a, b) => {
      return a.start.localeCompare(b.start)
    })

    // Tạo ranh giới thời gian cho các khung giờ có thể trải qua nhiều ngày
    const timeSlotBoundaries = []
    const sessionStartDate = dayjs(startTime).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
    const sessionEndDate = dayjs(validatedEndTime).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')

    // Tạo danh sách các ngày mà session đi qua
    const sessionDates = []
    let currentDate = dayjs(sessionStartDate).tz('Asia/Ho_Chi_Minh')
    const endDate = dayjs(sessionEndDate).tz('Asia/Ho_Chi_Minh')

    while (currentDate.isSameOrBefore(endDate, 'day')) {
      sessionDates.push(currentDate.format('YYYY-MM-DD'))
      currentDate = currentDate.add(1, 'day')
    }

    // Tạo khung giờ cho từng ngày mà session đi qua
    for (const dateStr of sessionDates) {
      for (const slot of sortedTimeSlots) {
        // Tạo thời gian bắt đầu và kết thúc của khung giờ cho ngày này
        const slotStartTime = dayjs.tz(`${dateStr} ${slot.start}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh')
        let slotEndTime

        // Xử lý khung giờ qua ngày
        if (slot.start > slot.end) {
          slotEndTime = dayjs.tz(`${dateStr} ${slot.end}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh').add(1, 'day')
        } else {
          slotEndTime = dayjs.tz(`${dateStr} ${slot.end}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh')
        }

        timeSlotBoundaries.push({
          start: slotStartTime.toDate(),
          end: slotEndTime.toDate(),
          prices: slot.prices,
          date: dateStr
        })
      }
    }

    // Tính toán giờ sử dụng trong từng khung giờ một cách linh hoạt
    const sessionStartVN = dayjs(startTime).tz('Asia/Ho_Chi_Minh')
    const sessionEndVN = dayjs(validatedEndTime).tz('Asia/Ho_Chi_Minh')

    // Tìm tất cả các khung giờ mà session đi qua
    const applicableTimeSlots = []

    for (const slotBoundary of timeSlotBoundaries) {
      // Kiểm tra xem session có overlap với khung giờ này không
      const sessionStart = sessionStartVN.toDate()
      const sessionEnd = sessionEndVN.toDate()

      // Tính toán thời gian overlap
      const overlapStart = new Date(Math.max(sessionStart.getTime(), slotBoundary.start.getTime()))
      const overlapEnd = new Date(Math.min(sessionEnd.getTime(), slotBoundary.end.getTime()))

      if (overlapStart < overlapEnd) {
        const overlapHours = this.calculateHours(overlapStart, overlapEnd)
        if (overlapHours > 0) {
          // Tìm slot gốc từ sortedTimeSlots để lấy thông tin slot
          const originalSlot =
            sortedTimeSlots.find(
              (slot) =>
                slot.start === dayjs(slotBoundary.start).format('HH:mm') &&
                slot.end === dayjs(slotBoundary.end).format('HH:mm')
            ) || sortedTimeSlots.find((slot) => slot.start === dayjs(slotBoundary.start).format('HH:mm'))

          applicableTimeSlots.push({
            slot: originalSlot || {
              start: dayjs(slotBoundary.start).format('HH:mm'),
              end: dayjs(slotBoundary.end).format('HH:mm'),
              prices: slotBoundary.prices
            },
            overlapStart,
            overlapEnd,
            overlapHours,
            slotStart: slotBoundary.start,
            slotEnd: slotBoundary.end,
            date: slotBoundary.date
          })
        }
      }
    }

    // Session qua đêm: đoạn 00:00 -> end (sáng sớm ngày hôm sau) không nằm trong khung nào (khung đầu ngày thường từ 09:00).
    // Tính thêm đoạn này và áp giá theo khung cuối ngày trước (cùng mức với 18:00-23:59).
    const sessionEndDateStr = sessionEndVN.format('YYYY-MM-DD')
    const sessionStartDateStr = sessionStartVN.format('YYYY-MM-DD')
    if (sessionEndDateStr > sessionStartDateStr) {
      const midnightNextDay = sessionEndVN.startOf('day').toDate()
      const sessionEndDate = sessionEndVN.toDate()
      if (sessionEndDate.getTime() > midnightNextDay.getTime()) {
        const boundariesStartDate = timeSlotBoundaries.filter((b) => b.date === sessionStartDateStr)
        const lastSlotOfPrevDay = boundariesStartDate.length
          ? boundariesStartDate.reduce((latest, b) => (b.end.getTime() > latest.end.getTime() ? b : latest))
          : null
        if (lastSlotOfPrevDay) {
          const earlyOverlapStart = midnightNextDay
          const earlyOverlapEnd = sessionEndDate
          const earlyOverlapHours = this.calculateHours(earlyOverlapStart, earlyOverlapEnd)
          if (earlyOverlapHours > 0) {
            const originalSlot =
              sortedTimeSlots.find(
                (slot) =>
                  slot.start === dayjs(lastSlotOfPrevDay.start).format('HH:mm') &&
                  slot.end === dayjs(lastSlotOfPrevDay.end).format('HH:mm')
              ) || sortedTimeSlots.find((slot) => slot.start === dayjs(lastSlotOfPrevDay.start).format('HH:mm'))
            applicableTimeSlots.push({
              slot: originalSlot || {
                start: dayjs(lastSlotOfPrevDay.start).format('HH:mm'),
                end: dayjs(lastSlotOfPrevDay.end).format('HH:mm'),
                prices: lastSlotOfPrevDay.prices
              },
              overlapStart: earlyOverlapStart,
              overlapEnd: earlyOverlapEnd,
              overlapHours: earlyOverlapHours,
              slotStart: lastSlotOfPrevDay.start,
              slotEnd: lastSlotOfPrevDay.end,
              date: sessionEndDateStr
            })
          }
        }
      }
    }

    // Sắp xếp các khung giờ theo thời gian bắt đầu
    applicableTimeSlots.sort((a, b) => a.overlapStart.getTime() - b.overlapStart.getTime())

    // Tính toán phí dịch vụ cho từng khung giờ riêng biệt (có thể áp dụng free 60 phút đầu trong khung 10-19)
    for (const timeSlotInfo of applicableTimeSlots) {
      const { slot, overlapStart, overlapEnd } = timeSlotInfo

      const priceEntry = slot.prices.find((p: any) => p.room_type === room?.roomType)
      if (!priceEntry) continue

      const localOverlapStart = dayjs(overlapStart).tz('Asia/Ho_Chi_Minh')
      const localOverlapEnd = dayjs(overlapEnd).tz('Asia/Ho_Chi_Minh')
      const overlapSeconds = localOverlapEnd.diff(localOverlapStart, 'second')
      if (overlapSeconds <= 0) continue

      let slotFreeMinutes = 0
      if (eligibleForFreeHour && freeMinutesLeft > 0) {
        const promoStart = localOverlapStart.clone().hour(10).minute(0).second(0).millisecond(0)
        const promoEnd = localOverlapStart.clone().hour(19).minute(0).second(0).millisecond(0)
        const promoOverlapStart = promoStart.isAfter(localOverlapStart) ? promoStart : localOverlapStart
        const promoOverlapEnd = promoEnd.isBefore(localOverlapEnd) ? promoEnd : localOverlapEnd

        if (promoOverlapEnd.isAfter(promoOverlapStart)) {
          const promoSeconds = promoOverlapEnd.diff(promoOverlapStart, 'second')
          const promoMinutes = Math.ceil(promoSeconds / 60)
          slotFreeMinutes = Math.min(freeMinutesLeft, promoMinutes)
          freeMinutesLeft -= slotFreeMinutes
          freeMinutesApplied += slotFreeMinutes
          const slotFreeAmount = (slotFreeMinutes / 60) * priceEntry.price
          freeAmountTotal += slotFreeAmount
        }
      }

      const overlapHoursRounded = Math.round((overlapSeconds / 3600) * 100) / 100

      const slotServiceFee = (overlapSeconds / 3600) * priceEntry.price

      totalServiceFee += slotServiceFee
      totalHoursUsed += overlapHoursRounded

      const startTimeStr = localOverlapStart.format('HH:mm')
      const endTimeStr = localOverlapEnd.format('HH:mm')

      const description = `Phi dich vu thu am\n(${startTimeStr}-${endTimeStr})`

      timeSlotItems.push({
        description,
        quantity: overlapHoursRounded,
        price: priceEntry.price,
        totalPrice: slotServiceFee
      })
    }

    // Thêm các mục F&B từ order vào items nếu có
    if (order && order.order) {
      // Xử lý đồ uống
      if (order.order.drinks && typeof order.order.drinks === 'object' && Object.keys(order.order.drinks).length > 0) {
        for (const [menuId, quantity] of Object.entries(order.order.drinks)) {
          // Sử dụng hàm helper để tìm menu item
          const menuItem = await this.findMenuItemById(menuId, menu)

          if (menuItem) {
            // Đảm bảo price là number và được xử lý đúng định dạng
            const price = this.parsePrice(menuItem.price)
            if (price === 0) {
              console.error(`Invalid price for menu item ${menuItem.name}: ${menuItem.price}`)
              continue
            }
            const totalPrice = quantity * price
            timeSlotItems.push({
              description: menuItem.name,
              quantity: quantity,
              price: price,
              totalPrice: totalPrice
            })
          }
        }
      }

      // Xử lý đồ ăn
      if (order.order.snacks && typeof order.order.snacks === 'object' && Object.keys(order.order.snacks).length > 0) {
        for (const [menuId, quantity] of Object.entries(order.order.snacks)) {
          // Sử dụng hàm helper để tìm menu item
          const menuItem = await this.findMenuItemById(menuId, menu)

          if (menuItem) {
            // Đảm bảo price là number và được xử lý đúng định dạng
            const price = this.parsePrice(menuItem.price)
            if (price === 0) {
              console.error(`Invalid price for menu item ${menuItem.name}: ${menuItem.price}`)
              continue
            }
            const totalPrice = quantity * price
            timeSlotItems.push({
              description: menuItem.name,
              quantity: quantity,
              price: price,
              totalPrice: totalPrice
            })
          }
        }
      }
    }

    // Gift từ schedule (đã được claim)
    const scheduleGift = schedule.gift && schedule.gift.status === 'claimed' ? schedule.gift : undefined

    // Nếu gift là snacks/drinks thì hiển thị line 0đ
    if (scheduleGift && scheduleGift.type === 'snacks_drinks' && scheduleGift.items) {
      for (const giftItem of scheduleGift.items) {
        timeSlotItems.push({
          description: `Gift - ${giftItem.name}`,
          quantity: giftItem.quantity,
          price: 0,
          totalPrice: 0
        })
      }
    }

    // Lấy thông tin promotion nếu có promotionId (bỏ qua nếu có gift discount để tránh chồng khuyến mãi)
    let activePromotion = undefined
    if (promotionId) {
      const promotion = await databaseService.promotions.findOne({ _id: new ObjectId(promotionId) })
      if (promotion) {
        activePromotion = promotion
      }
    }

    // Áp dụng khuyến mãi (có thể cộng dồn với gift)
    let shouldApplyPromotion = false
    const giftType = scheduleGift?.type
    const isGiftPercent = giftType === 'discount_percentage' || giftType === 'discount'
    const isGiftAmount = giftType === 'discount_amount'
    const giftDiscountPercent = isGiftPercent ? scheduleGift?.discountPercentage || 0 : 0
    const giftDiscountFixed = isGiftAmount ? scheduleGift?.discountAmount || 0 : 0
    let giftDiscountAmount = 0

    if (activePromotion) {
      // Kiểm tra xem promotion có áp dụng cho phòng này không
      const appliesTo = Array.isArray(activePromotion.appliesTo)
        ? activePromotion.appliesTo[0]?.toLowerCase()
        : activePromotion.appliesTo?.toLowerCase()

      // For all items
      if (appliesTo === 'all') {
        shouldApplyPromotion = true
      }
      // For specific room
      else if (appliesTo === 'room' && room?._id) {
        const appliesToRooms = Array.isArray(activePromotion.appliesTo)
          ? activePromotion.appliesTo
          : [activePromotion.appliesTo]

        const roomIdStr = room._id.toString()
        shouldApplyPromotion = appliesToRooms.some((room) => room === roomIdStr)
      }
      // For specific room type
      else if (appliesTo === 'room_type' && room?.roomType) {
        const appliesToRoomTypes = Array.isArray(activePromotion.appliesTo)
          ? activePromotion.appliesTo
          : [activePromotion.appliesTo]

        const roomTypeIdStr = room.roomType.toString()
        shouldApplyPromotion = appliesToRoomTypes.some((type) => type === roomTypeIdStr)
      }

      if (shouldApplyPromotion) {
        // Thêm thông tin promotion vào từng item để hiển thị
        for (let i = 0; i < timeSlotItems.length; i++) {
          timeSlotItems[i].discountPercentage = activePromotion.discountPercentage
          timeSlotItems[i].discountName = activePromotion.name
        }
      }
    }

    // Tính tổng tiền từ các mục đã được làm tròn
    let subtotal = timeSlotItems.reduce((acc, item) => {
      return acc + item.totalPrice
    }, 0)

    if (giftDiscountPercent > 0) {
      giftDiscountAmount = (subtotal * giftDiscountPercent) / 100
    }
    if (giftDiscountFixed > 0) {
      giftDiscountAmount += giftDiscountFixed
    }

    let discountAmount = 0
    if (activePromotion && shouldApplyPromotion) {
      discountAmount = (subtotal * activePromotion.discountPercentage) / 100
    }

    // Trừ khuyến mãi giờ đầu (freeAmountTotal) ở mức tổng, không bỏ record gốc
    const totalAmount = Math.max(
      Math.floor((subtotal - discountAmount - freeAmountTotal - giftDiscountAmount) / 1000) * 1000,
      0
    )

    const bill: IBill = {
      scheduleId: schedule._id,
      roomId: schedule.roomId,
      startTime: startTime, // Sử dụng startTime đã điều chỉnh
      endTime: validatedEndTime,
      createdAt: schedule.createdAt,
      note: schedule.note,
      items: timeSlotItems.map((item) => ({
        description: item.description,
        price: item.price,
        quantity: typeof item.quantity === 'number' ? parseFloat(item.quantity.toFixed(2)) : item.quantity, // Đảm bảo hiển thị đúng 2 chữ số thập phân
        discountPercentage: item.discountPercentage,
        discountName: item.discountName
      })),
      totalAmount, // ĐÃ SỬA: tổng tiền đã trừ discount
      giftDiscountAmount: giftDiscountAmount > 0 ? giftDiscountAmount : undefined,
      paymentMethod,
      activePromotion: activePromotion
        ? {
            name: activePromotion.name,
            discountPercentage: activePromotion.discountPercentage,
            appliesTo: activePromotion.appliesTo
          }
        : undefined,
      gift: scheduleGift
        ? {
            giftId: scheduleGift.giftId,
            name: scheduleGift.name,
            type: scheduleGift.type,
            discountPercentage: scheduleGift.discountPercentage,
            items: scheduleGift.items
          }
        : undefined,
      freeHourPromotion:
        freeMinutesApplied > 0
          ? {
              freeMinutesApplied,
              freeAmount: freeAmountTotal
            }
          : undefined,
      actualEndTime: actualEndTime ? new Date(actualEndTime) : undefined,
      actualStartTime: actualStartTime ? new Date(actualStartTime) : undefined,
      // Thêm thông tin FNB order vào bill
      fnbOrder: order
        ? {
            drinks: order.order.drinks || {},
            snacks: order.order.snacks || {},
            completedAt: (order as any).completedAt,
            completedBy: (order as any).completedBy
          }
        : undefined
    }

    // Tự động lưu order vào history nếu có order và chưa có trong history
    if (order && order.order) {
      try {
        // Kiểm tra xem order đã có trong history chưa
        const existingHistory = await fnbOrderService.getOrderHistoryByRoomSchedule(scheduleId)
        const orderExistsInHistory = existingHistory.some(
          (historyOrder) => JSON.stringify(historyOrder.order) === JSON.stringify(order.order)
        )

        if (!orderExistsInHistory) {
          await fnbOrderService.saveOrderHistory(
            scheduleId,
            order.order,
            'system',
            bill.invoiceCode // Sử dụng invoiceCode làm billId
          )
        }
      } catch (error) {
        console.error('Lỗi khi lưu order vào history:', error)
        // Không fail toàn bộ request nếu chỉ lỗi lưu history
      }
    }

    // Không cần làm tròn nữa vì đã làm tròn từng item rồi
    // bill.totalAmount = Math.floor(bill.totalAmount / 1000) * 1000

    // Thêm mã hóa đơn nếu chưa có
    if (!bill.invoiceCode) {
      const now = dayjs().tz('Asia/Ho_Chi_Minh')
      bill.invoiceCode = `#${now.date().toString().padStart(2, '0')}${(now.month() + 1).toString().padStart(2, '0')}${now.hour().toString().padStart(2, '0')}${now.minute().toString().padStart(2, '0')}`
    }

    return bill
  }

  // Quản lý queue in để tránh conflict
  private async managePrintQueue<T>(printFunction: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.printQueue.push(async () => {
        try {
          // Kiểm tra thời gian từ lần in cuối
          const currentTime = Date.now()
          const timeSinceLastPrint = currentTime - this.lastPrintTime
          const minCooldown = 3000 // 3 giây giữa các lần in

          if (timeSinceLastPrint < minCooldown) {
            const waitTime = minCooldown - timeSinceLastPrint
            await new Promise((resolve) => setTimeout(resolve, waitTime))
          }

          this.isPrinting = true

          const result = await printFunction()

          this.lastPrintTime = Date.now()
          this.isPrinting = false
          resolve(result)
        } catch (error) {
          this.isPrinting = false
          console.error('Loi khi in:', error)
          reject(error)
        } finally {
          // Xử lý job tiếp theo trong queue
          this.processNextInQueue()
        }
      })

      // Nếu không đang in, xử lý ngay
      if (!this.isPrinting) {
        this.processNextInQueue()
      }
    })
  }

  private async processNextInQueue() {
    if (this.printQueue.length > 0 && !this.isPrinting) {
      const nextJob = this.printQueue.shift()
      if (nextJob) {
        await nextJob()
      }
    }
  }

  /**
   * Helper method để gọi API in qua Socket.IO
   */
  private async printViaAPI(billData: IBill): Promise<any> {
    try {
      const billContent = await this.getBillText(billData)
      console.log('process.env.HTTP_API_URL', process.env.HTTP_API_URL)
      // Gọi API in
      const response = await axios.post(
        `${process.env.HTTP_API_URL}/print`,
        {
          printerId: process.env.PRINTER_ID,
          content: billContent
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      )

      return response.data
    } catch (error) {
      console.error('Error calling print API:', error)
      throw error
    }
  }

  /**
   * In hóa đơn (phương thức mới sử dụng Socket.IO)
   */
  async printBill(billData: IBill): Promise<IBill> {
    try {
      // Lưu lại thời gian bắt đầu và kết thúc chính xác khi in hóa đơn
      const exactStartTime = billData.actualStartTime || billData.startTime
      const exactEndTime = billData.endTime || new Date()

      // Tạo mã hóa đơn theo định dạng #DDMMHHMM (ngày, tháng, giờ, phút)
      const now = dayjs().tz('Asia/Ho_Chi_Minh')
      const invoiceCode = `#${now.date().toString().padStart(2, '0')}${(now.month() + 1).toString().padStart(2, '0')}${now.hour().toString().padStart(2, '0')}${now.minute().toString().padStart(2, '0')}`

      // SỬ DỤNG TRỰC TIẾP billData thay vì tạo bill object mới
      const bill: IBill = {
        ...billData,
        _id: new ObjectId(),
        scheduleId: new ObjectId(billData.scheduleId),
        roomId: new ObjectId(billData.roomId),
        createdAt: new Date(),
        actualEndTime: exactEndTime,
        actualStartTime: exactStartTime,
        invoiceCode: invoiceCode
      }

      // Gọi API in qua Socket.IO
      await this.printViaAPI(bill)

      // Lưu vào transaction history
      this.transactionHistory.push(bill)

      return bill
    } catch (error) {
      console.error('Lỗi khi in hóa đơn:', error)
      throw error
    }
  }

  /**
   * Get total revenue for a specific date
   * @param date Date to get revenue for (format: ISO date string)
   * @returns Object containing total revenue and bill details
   */
  async getDailyRevenue(date: string): Promise<{ totalRevenue: number; bills: IBill[] }> {
    try {
      // Validate date format
      if (!dayjs(date).isValid()) {
        throw new ErrorWithStatus({
          message: 'Invalid date format. Please use ISO date string format',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // FIX: Xử lý múi giờ nhất quán - chuyển đổi ngày về múi giờ Việt Nam trước khi tạo khoảng thời gian
      const targetDate = dayjs(date).tz('Asia/Ho_Chi_Minh')

      // Tạo khoảng thời gian cho ngày đó trong múi giờ Việt Nam
      const startDateObj = targetDate.startOf('day').toDate()
      const endDateObj = targetDate.endOf('day').toDate()

      // FIX: Sử dụng startTime thay vì createdAt để tính doanh thu
      // Bill được tính vào doanh thu của ngày mà session bắt đầu, không phải ngày tạo bill
      // Ví dụ: Bill bắt đầu 23:30 ngày 01/01 và kết thúc 01:00 ngày 02/01
      // thì bill đó vẫn tính vào doanh thu ngày 01/01
      const bills = await databaseService.bills
        .find({
          startTime: {
            $gte: startDateObj,
            $lte: endDateObj
          }
        })
        .sort({ startTime: -1 })
        .toArray()

      // Remove duplicates by scheduleId - keep paid bills or latest bill
      const uniqueBills = new Map<string, IBill>()

      for (const bill of bills) {
        const scheduleId = bill.scheduleId.toString()

        if (!uniqueBills.has(scheduleId)) {
          // First bill for this scheduleId
          uniqueBills.set(scheduleId, bill)
        } else {
          const existingBill = uniqueBills.get(scheduleId)!
          let shouldReplace = false

          // Priority 1: Bills with paymentMethod (paid) over bills without
          if (bill.paymentMethod && !existingBill.paymentMethod) {
            shouldReplace = true
          }
          // Priority 2: If both have same payment status, use latest createdAt
          else if (
            !!bill.paymentMethod === !!existingBill.paymentMethod &&
            bill.createdAt &&
            existingBill.createdAt &&
            new Date(bill.createdAt) > new Date(existingBill.createdAt)
          ) {
            shouldReplace = true
          }

          if (shouldReplace) {
            uniqueBills.set(scheduleId, bill)
          }
        }
      }

      const finalBills = Array.from(uniqueBills.values())

      // Simple calculation - just sum all totalAmount
      const totalRevenue = finalBills.reduce((sum, bill) => sum + bill.totalAmount, 0)

      return {
        totalRevenue,
        bills: finalBills
      }
    } catch (error) {
      console.error('[DOANH THU] Lỗi khi lấy doanh thu:', error)
      throw error
    }
  }

  /**
   * Get total revenue for a specific week
   * @param date Any date within the week to get revenue for (format: ISO date string)
   * @returns Object containing total revenue, bill details, and date range
   */
  async getWeeklyRevenue(
    date: string
  ): Promise<{ totalRevenue: number; bills: any[]; startDate: Date; endDate: Date }> {
    try {
      const targetDate = dayjs(date).tz('Asia/Ho_Chi_Minh')
      const startOfWeek = targetDate.startOf('week')
      const endOfWeek = targetDate.endOf('week')

      const startDate = startOfWeek.toDate()
      const endDate = endOfWeek.toDate()

      // FIX: Sử dụng startTime thay vì createdAt để tính doanh thu
      // Bill được tính vào doanh thu của tuần mà session bắt đầu, không phải tuần tạo bill
      const bills = await databaseService.bills
        .find({
          startTime: {
            $gte: startDate,
            $lte: endDate
          }
        })
        .sort({ startTime: -1 })
        .toArray()

      if (bills.length === 0) {
        return {
          totalRevenue: 0,
          bills: [],
          startDate,
          endDate
        }
      }

      // Remove duplicates by scheduleId (prioritize paid bills, then latest createdAt)
      const uniqueBills = new Map<string, IBill>()
      for (const bill of bills) {
        const scheduleId = bill.scheduleId.toString()

        if (!uniqueBills.has(scheduleId)) {
          // First bill for this scheduleId
          uniqueBills.set(scheduleId, bill)
        } else {
          const existingBill = uniqueBills.get(scheduleId)!
          let shouldReplace = false

          // Priority 1: Bills with paymentMethod (paid) over bills without
          if (bill.paymentMethod && !existingBill.paymentMethod) {
            shouldReplace = true
          }
          // Priority 2: If both have paymentMethod or both don't have, use latest createdAt
          else if (
            (!bill.paymentMethod && !existingBill.paymentMethod) ||
            (bill.paymentMethod && existingBill.paymentMethod)
          ) {
            if (
              bill.createdAt &&
              existingBill.createdAt &&
              new Date(bill.createdAt) > new Date(existingBill.createdAt)
            ) {
              shouldReplace = true
            }
          }

          if (shouldReplace) {
            uniqueBills.set(scheduleId, bill)
          }
        }
      }

      const finalBills = Array.from(uniqueBills.values())

      // Làm tròn tổng tiền của từng hóa đơn
      finalBills.forEach((bill) => {
        bill.totalAmount = Math.floor(bill.totalAmount / 1000) * 1000
      })

      // Tính tổng doanh thu
      const totalRevenue = finalBills.reduce((sum, bill) => sum + bill.totalAmount, 0)

      return {
        totalRevenue,
        bills: finalBills as any,
        startDate,
        endDate
      }
    } catch (error) {
      console.error('[DOANH THU] Lỗi khi tính doanh thu:', error)
      throw error
    }
  }

  /**
   * Get total revenue for a specific month
   * @param date Any date within the month to get revenue for (format: ISO date string)
   * @returns Object containing total revenue, bill details, and date range
   */
  async getMonthlyRevenue(
    date: string
  ): Promise<{ totalRevenue: number; bills: any[]; startDate: Date; endDate: Date }> {
    try {
      const targetDate = dayjs(date).tz('Asia/Ho_Chi_Minh')
      const startOfMonth = targetDate.startOf('month')
      const endOfMonth = targetDate.endOf('month')

      const startDate = startOfMonth.toDate()
      const endDate = endOfMonth.toDate()

      // FIX: Sử dụng startTime thay vì createdAt để tính doanh thu
      // Bill được tính vào doanh thu của tháng mà session bắt đầu, không phải tháng tạo bill
      const bills = await databaseService.bills
        .find({
          startTime: {
            $gte: startDate,
            $lte: endDate
          }
        })
        .sort({ startTime: -1 })
        .toArray()

      if (bills.length === 0) {
        return {
          totalRevenue: 0,
          bills: [],
          startDate,
          endDate
        }
      }

      // Remove duplicates by scheduleId (prioritize paid bills, then latest createdAt)
      const uniqueBills = new Map<string, IBill>()
      for (const bill of bills) {
        const scheduleId = bill.scheduleId.toString()

        if (!uniqueBills.has(scheduleId)) {
          // First bill for this scheduleId
          uniqueBills.set(scheduleId, bill)
        } else {
          const existingBill = uniqueBills.get(scheduleId)!
          let shouldReplace = false

          // Priority 1: Bills with paymentMethod (paid) over bills without
          if (bill.paymentMethod && !existingBill.paymentMethod) {
            shouldReplace = true
          }
          // Priority 2: If both have paymentMethod or both don't have, use latest createdAt
          else if (
            (!bill.paymentMethod && !existingBill.paymentMethod) ||
            (bill.paymentMethod && existingBill.paymentMethod)
          ) {
            if (
              bill.createdAt &&
              existingBill.createdAt &&
              new Date(bill.createdAt) > new Date(existingBill.createdAt)
            ) {
              shouldReplace = true
            }
          }

          if (shouldReplace) {
            uniqueBills.set(scheduleId, bill)
          }
        }
      }

      const finalBills = Array.from(uniqueBills.values())

      // Làm tròn tổng tiền của từng hóa đơn
      finalBills.forEach((bill) => {
        bill.totalAmount = Math.floor(bill.totalAmount / 1000) * 1000
      })

      // Tính tổng doanh thu
      const totalRevenue = finalBills.reduce((sum, bill) => sum + bill.totalAmount, 0)

      return {
        totalRevenue,
        bills: finalBills as any,
        startDate,
        endDate
      }
    } catch (error) {
      console.error('[DOANH THU] Lỗi khi tính doanh thu:', error)
      throw error
    }
  }

  /**
   * Get total revenue for a custom date range
   * @param startDate Start date (format: ISO date string)
   * @param endDate End date (format: ISO date string)
   * @returns Object containing total revenue, bill details, and date range
   */
  async getRevenueByCustomRange(
    startDate: string,
    endDate: string
  ): Promise<{ totalRevenue: number; bills: any[]; startDate: Date; endDate: Date }> {
    try {
      const start = dayjs(startDate).tz('Asia/Ho_Chi_Minh').startOf('day')
      const end = dayjs(endDate).tz('Asia/Ho_Chi_Minh').endOf('day')

      const startDateObj = start.toDate()
      const endDateObj = end.toDate()

      if (start.isAfter(end)) {
        throw new ErrorWithStatus({
          message: 'Ngày bắt đầu phải trước ngày kết thúc',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      // FIX: Sử dụng startTime thay vì createdAt để tính doanh thu
      // Bill được tính vào doanh thu của khoảng thời gian mà session bắt đầu, không phải khoảng thời gian tạo bill
      const bills = await databaseService.bills
        .find({
          startTime: {
            $gte: startDateObj,
            $lte: endDateObj
          }
        })
        .sort({ startTime: -1 })
        .toArray()

      if (bills.length === 0) {
        return {
          totalRevenue: 0,
          bills: [],
          startDate: startDateObj,
          endDate: endDateObj
        }
      }

      // Remove duplicates by scheduleId (prioritize paid bills, then latest createdAt)
      const uniqueBills = new Map<string, IBill>()
      for (const bill of bills) {
        const scheduleId = bill.scheduleId.toString()

        if (!uniqueBills.has(scheduleId)) {
          // First bill for this scheduleId
          uniqueBills.set(scheduleId, bill)
        } else {
          const existingBill = uniqueBills.get(scheduleId)!
          let shouldReplace = false

          // Priority 1: Bills with paymentMethod (paid) over bills without
          if (bill.paymentMethod && !existingBill.paymentMethod) {
            shouldReplace = true
          }
          // Priority 2: If both have paymentMethod or both don't have, use latest createdAt
          else if (
            (!bill.paymentMethod && !existingBill.paymentMethod) ||
            (bill.paymentMethod && existingBill.paymentMethod)
          ) {
            if (
              bill.createdAt &&
              existingBill.createdAt &&
              new Date(bill.createdAt) > new Date(existingBill.createdAt)
            ) {
              shouldReplace = true
            }
          }

          if (shouldReplace) {
            uniqueBills.set(scheduleId, bill)
          }
        }
      }

      const finalBills = Array.from(uniqueBills.values())

      // Làm tròn tổng tiền của từng hóa đơn
      finalBills.forEach((bill) => {
        bill.totalAmount = Math.floor(bill.totalAmount / 1000) * 1000
      })

      // Tính tổng doanh thu
      const totalRevenue = finalBills.reduce((sum, bill) => sum + bill.totalAmount, 0)

      return {
        totalRevenue,
        bills: finalBills as any,
        startDate: startDateObj,
        endDate: endDateObj
      }
    } catch (error) {
      console.error('[DOANH THU] Lỗi khi tính doanh thu:', error)
      throw error
    }
  }

  /**
   * Tạo key duy nhất cho một hóa đơn dựa trên các thông tin chính
   * @private
   * @param bill - Hóa đơn cần tạo key
   * @returns key duy nhất cho hóa đơn
   */
  private getBillUniqueKey(bill: IBill): string {
    // Tạo hash string từ các mục trong hóa đơn
    const itemsHash = bill.items
      .map((item) => `${item.description}:${item.quantity}:${item.price}`)
      .sort()
      .join('|')

    return `${bill.scheduleId}-${bill.roomId}-${new Date(bill.startTime).getTime()}-${new Date(bill.endTime).getTime()}-${bill.totalAmount}-${itemsHash}`
  }

  /**
   * Dọn dẹp hóa đơn trùng lặp trong cơ sở dữ liệu
   * @param dateString Ngày cần dọn dẹp (ISO string)
   * @returns Số lượng hóa đơn trùng lặp đã xóa
   */
  async cleanDuplicateBills(dateString?: string): Promise<{
    removedCount: number
    beforeCount: number
    afterCount: number
  }> {
    try {
      let startDate: Date, endDate: Date

      if (dateString) {
        // Nếu có ngày cụ thể, chỉ xóa trong ngày đó
        const date = dayjs(dateString).tz('Asia/Ho_Chi_Minh')
        startDate = date.startOf('day').toDate()
        endDate = date.endOf('day').toDate()
      } else {
        // Mặc định, xóa tất cả hóa đơn trùng lặp (lấy ngày sớm nhất và muộn nhất)
        const earliestBill = await databaseService.bills.findOne({}, { sort: { createdAt: 1 } })
        const latestBill = await databaseService.bills.findOne({}, { sort: { createdAt: -1 } })

        if (!earliestBill || !latestBill) {
          return { removedCount: 0, beforeCount: 0, afterCount: 0 }
        }

        startDate = earliestBill.createdAt
        endDate = latestBill.createdAt
      }

      // Tìm tất cả hóa đơn trong khoảng thời gian
      const bills = await databaseService.bills
        .find({
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        })
        .toArray()

      const beforeCount = bills.length

      if (bills.length === 0) {
        return { removedCount: 0, beforeCount: 0, afterCount: 0 }
      }

      // Nhóm hóa đơn theo key duy nhất
      const billGroups = new Map<string, IBill[]>()

      bills.forEach((bill) => {
        const key = this.getBillUniqueKey(bill)
        if (!billGroups.has(key)) {
          billGroups.set(key, [])
        }
        billGroups.get(key)!.push(bill)
      })

      // Tìm các hóa đơn trùng lặp (có hơn 1 hóa đơn với cùng key)
      const duplicateBillIds: ObjectId[] = []

      billGroups.forEach((group) => {
        if (group.length > 1) {
          // Sắp xếp theo createdAt để giữ lại hóa đơn mới nhất
          group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

          // Lấy tất cả IDs ngoại trừ cái đầu tiên (mới nhất)
          const duplicateIds = group.slice(1).map((bill) => bill._id!)
          duplicateBillIds.push(...duplicateIds)
        }
      })

      // Xóa các hóa đơn trùng lặp
      if (duplicateBillIds.length > 0) {
        const result = await databaseService.bills.deleteMany({
          _id: { $in: duplicateBillIds }
        })

        const afterCount = beforeCount - result.deletedCount

        return {
          removedCount: result.deletedCount,
          beforeCount,
          afterCount
        }
      }

      return {
        removedCount: 0,
        beforeCount,
        afterCount: beforeCount
      }
    } catch (error) {
      console.error('Lỗi khi dọn dẹp hóa đơn trùng lặp:', error)
      throw error
    }
  }

  /**
   * Dọn dẹp hóa đơn từ lịch đặt phòng chưa hoàn thành
   * @returns Kết quả dọn dẹp
   */
  async cleanUpNonFinishedBills(): Promise<{
    removedCount: number
    beforeCount: number
    afterCount: number
  }> {
    try {
      // Lấy tất cả hóa đơn
      const allBills = await databaseService.bills.find({}).toArray()
      const beforeCount = allBills.length

      // Lấy tất cả lịch đặt phòng đã hoàn thành
      const finishedSchedules = await databaseService.roomSchedule
        .find({
          status: RoomScheduleStatus.Finished
        })
        .toArray()

      // Tạo map của các ID lịch đã hoàn thành để tra cứu nhanh
      const finishedScheduleIds = new Set(finishedSchedules.map((schedule) => schedule._id.toString()))

      // Tìm các hóa đơn từ lịch chưa hoàn thành
      const billsToRemove = allBills.filter((bill) => !finishedScheduleIds.has(bill.scheduleId.toString()))

      if (billsToRemove.length === 0) {
        return {
          removedCount: 0,
          beforeCount,
          afterCount: beforeCount
        }
      }

      // Lấy các ID hóa đơn cần xóa
      const billIdsToRemove = billsToRemove.map((bill) => bill._id)

      // Xóa các hóa đơn thuộc về lịch chưa hoàn thành
      const result = await databaseService.bills.deleteMany({
        _id: { $in: billIdsToRemove }
      })

      const afterCount = beforeCount - result.deletedCount

      return {
        removedCount: result.deletedCount,
        beforeCount,
        afterCount
      }
    } catch (error) {
      console.error('Lỗi khi dọn dẹp hóa đơn từ lịch chưa hoàn thành:', error)
      throw error
    }
  }

  /**
   * Get total revenue directly from bills collection without checking room schedules
   * @param dateType Type of date range: 'day', 'week', 'month', or 'custom'
   * @param startDate Start date (required for all types, format: ISO date string)
   * @param endDate End date (only required for 'custom' type, format: ISO date string)
   * @returns Object containing total revenue and bill details
   */
  async getRevenueFromBillsCollection(
    dateType: 'day' | 'week' | 'month' | 'custom',
    startDate: string,
    endDate?: string
  ): Promise<{
    totalRevenue: number
    bills: IBill[]
    startDate: Date
    endDate: Date
    timeRange: string
  }> {
    try {
      let start: dayjs.Dayjs
      let end: dayjs.Dayjs
      let timeRangeDescription: string

      // Xác định khoảng thời gian dựa vào dateType
      start = dayjs(startDate).tz('Asia/Ho_Chi_Minh')

      switch (dateType) {
        case 'day':
          start = start.startOf('day')
          end = start.endOf('day')
          timeRangeDescription = `ngày ${start.format('DD/MM/YYYY')}`
          break

        case 'week':
          start = start.startOf('week')
          end = start.endOf('week')
          timeRangeDescription = `tuần ${start.week()} năm ${start.year()} (${start.format('DD/MM')} - ${end.format('DD/MM/YYYY')})`
          break

        case 'month':
          start = start.startOf('month')
          end = start.endOf('month')
          timeRangeDescription = `tháng ${start.format('MM/YYYY')}`
          break

        case 'custom':
          if (!endDate) {
            throw new ErrorWithStatus({
              message: 'Cần cung cấp ngày kết thúc cho khoảng thời gian tùy chỉnh',
              status: HTTP_STATUS_CODE.BAD_REQUEST
            })
          }
          start = start.startOf('day')
          end = dayjs(endDate).tz('Asia/Ho_Chi_Minh').endOf('day')
          timeRangeDescription = `từ ${start.format('DD/MM/YYYY')} đến ${end.format('DD/MM/YYYY')}`

          if (start.isAfter(end)) {
            throw new ErrorWithStatus({
              message: 'Ngày bắt đầu phải trước ngày kết thúc',
              status: HTTP_STATUS_CODE.BAD_REQUEST
            })
          }
          break
      }

      const startDateObj = start.toDate()
      const endDateObj = end.toDate()

      // FIX: Sử dụng startTime thay vì createdAt để tính doanh thu
      // Bill được tính vào doanh thu của khoảng thời gian mà session bắt đầu, không phải khoảng thời gian tạo bill
      // Ví dụ: Bill bắt đầu 23:30 ngày 01/01 và kết thúc 01:00 ngày 02/01
      // thì bill đó vẫn tính vào doanh thu ngày 01/01
      const bills = await databaseService.bills
        .find({
          startTime: {
            $gte: startDateObj,
            $lte: endDateObj
          }
        })
        .sort({ startTime: -1 })
        .toArray()

      if (bills.length === 0) {
        return {
          totalRevenue: 0,
          bills: [],
          startDate: startDateObj,
          endDate: endDateObj,
          timeRange: timeRangeDescription
        }
      }

      // Remove duplicates by scheduleId (prioritize paid bills, then latest createdAt)
      const uniqueBills = new Map<string, IBill>()
      for (const bill of bills) {
        const scheduleId = bill.scheduleId.toString()

        if (!uniqueBills.has(scheduleId)) {
          // First bill for this scheduleId
          uniqueBills.set(scheduleId, bill)
        } else {
          const existingBill = uniqueBills.get(scheduleId)!
          let shouldReplace = false

          // Priority 1: Bills with paymentMethod (paid) over bills without
          if (bill.paymentMethod && !existingBill.paymentMethod) {
            shouldReplace = true
          }
          // Priority 2: If both have paymentMethod or both don't have, use latest createdAt
          else if (
            (!bill.paymentMethod && !existingBill.paymentMethod) ||
            (bill.paymentMethod && existingBill.paymentMethod)
          ) {
            if (
              bill.createdAt &&
              existingBill.createdAt &&
              new Date(bill.createdAt) > new Date(existingBill.createdAt)
            ) {
              shouldReplace = true
              console.log(
                `[DOANH THU] Replacing older bill ${existingBill._id} with newer bill ${bill._id} for schedule ${scheduleId}`
              )
            }
          }

          if (shouldReplace) {
            uniqueBills.set(scheduleId, bill)
            console.log(
              `[DOANH THU] Selected bill ${bill._id} (${bill.totalAmount}) over ${existingBill._id} (${existingBill.totalAmount})`
            )
          } else {
            console.log(
              `[DOANH THU] Keeping existing bill ${existingBill._id} (${existingBill.totalAmount}) over ${bill._id} (${bill.totalAmount})`
            )
          }
        }
      }

      const finalBills = Array.from(uniqueBills.values())

      // Làm tròn tổng tiền của từng hóa đơn (nếu cần)
      finalBills.forEach((bill) => {
        bill.totalAmount = Math.floor(bill.totalAmount / 1000) * 1000
      })

      // Tính tổng doanh thu
      const totalRevenue = finalBills.reduce((sum, bill) => sum + bill.totalAmount, 0)

      return {
        totalRevenue,
        bills: finalBills,
        startDate: startDateObj,
        endDate: endDateObj,
        timeRange: timeRangeDescription
      }
    } catch (error) {
      console.error('[DOANH THU MỚI] Lỗi khi tính doanh thu:', error)
      throw error
    }
  }

  // Tạo nội dung hóa đơn dạng text
  public async getBillText(bill: IBill): Promise<string> {
    const room = await databaseService.rooms.findOne({ _id: new ObjectId(bill.roomId) })
    const printer = new TextPrinter()

    printer
      .font('a')
      .align('ct')
      .style('b')
      .size(1, 1)
      .text('Jozo Music Box')
      .text('HOA DON THANH TOAN')
      .style('b')
      .size(0, 0)
      .text('--------------------------------------------')
      .text(`Ma HD: ${bill.invoiceCode || 'N/A'}`)
      .text(`${room?.roomName || 'Khong xac dinh'}`)
      .align('lt')
      .text(`Ngay: ${dayjs(ensureVNTimezone(bill.createdAt)).format('DD/MM/YYYY')}`)

    // Hiển thị thời gian với ngày nếu session đi qua nhiều ngày
    const startDateStr = dayjs(bill.startTime).tz('Asia/Ho_Chi_Minh').format('DD/MM')
    const endDateStr = dayjs(bill.endTime).tz('Asia/Ho_Chi_Minh').format('DD/MM')

    if (startDateStr === endDateStr) {
      printer
        .text(`Gio bat dau: ${dayjs(bill.startTime).tz('Asia/Ho_Chi_Minh').format('HH:mm')}`)
        .text(`Gio ket thuc: ${dayjs(bill.endTime).tz('Asia/Ho_Chi_Minh').format('HH:mm')}`)
    } else {
      printer.text(
        `Gio: ${dayjs(bill.startTime).tz('Asia/Ho_Chi_Minh').format('DD/MM HH:mm')} - ${dayjs(bill.endTime).tz('Asia/Ho_Chi_Minh').format('DD/MM HH:mm')}`
      )
    }

    const totalDurationSeconds = dayjs(bill.endTime).diff(dayjs(bill.startTime), 'second')
    const totalDurationMinutes = Math.ceil(totalDurationSeconds / 60)
    const displayHours = Math.floor(totalDurationMinutes / 60)
    const displayMinutes = totalDurationMinutes % 60

    printer
      .text(`Tong gio su dung: ${displayHours} gio ${displayMinutes} phut`)
      .align('ct')
      .text('--------------------------------------------')
      .style('b')
      .text('CHI TIET DICH VU')
      .style('b')
      .text('--------------------------------------------')

    // Tạo header cho bảng với khoảng cách đều hơn
    const tableHeader = [
      { text: 'Dich vu', width: 0.45, align: 'left' },
      { text: 'SL', width: 0.15, align: 'center' },
      { text: 'Don gia', width: 0.2, align: 'right' },
      { text: 'T.Tien', width: 0.2, align: 'right' }
    ]

    printer.style('b').tableCustom(tableHeader)

    // In chi tiết từng mục với định dạng tương tự printBill
    bill.items.forEach((item) => {
      let description = item.description
      let quantity = item.quantity

      // Xử lý đặc biệt cho phí dịch vụ thu âm
      if (description.includes('Phi dich vu thu am')) {
        // Tách description thành tên dịch vụ và thời gian
        const [serviceName, timeRange] = description.split('\n')
        const timeStr = timeRange || ''

        // Định dạng số tiền để hiển thị gọn hơn
        const formattedPrice = item.price.toLocaleString('vi-VN')
        const rawTotal = quantity * item.price
        const formattedTotal = rawTotal.toLocaleString('vi-VN')

        // In dòng đầu với tên dịch vụ và các cột số liệu
        printer.style('b').tableCustom([
          { text: serviceName, width: 0.45, align: 'left' },
          { text: quantity.toString(), width: 0.15, align: 'center' },
          { text: formattedPrice, width: 0.2, align: 'right' },
          { text: formattedTotal, width: 0.2, align: 'right' }
        ])

        // In dòng thứ hai chỉ với thời gian, các cột còn lại để trống
        if (timeStr) {
          printer.style('b').tableCustom([
            { text: timeStr, width: 0.45, align: 'left' },
            { text: '', width: 0.15, align: 'center' },
            { text: '', width: 0.2, align: 'right' },
            { text: '', width: 0.2, align: 'right' }
          ])
        }

        return
      }

      // Loại bỏ dấu nếu là món ăn/đồ uống (không phải phí dịch vụ thu âm)
      description = removeVietnameseTones(description)

      // Tách mô tả và thông tin khuyến mãi nếu mô tả có chứa thông tin khuyến mãi
      const promotionMatch = description.match(/ \(Giam (\d+)% - (.*)\)$/)
      if (promotionMatch) {
        description = description.replace(/ \(Giam (\d+)% - (.*)\)$/, '')
      }

      const maxNameLength = 21
      const nameLines = []
      let desc = description
      while (desc.length > 0) {
        nameLines.push(desc.substring(0, maxNameLength))
        desc = desc.substring(maxNameLength)
      }

      const formattedPrice = item.price.toLocaleString('vi-VN')
      const rawTotal = item.quantity * item.price
      const formattedTotal = rawTotal.toLocaleString('vi-VN')

      // In dòng đầu tiên với tên (phần đầu), SL, Đơn giá, Thành tiền
      printer.tableCustom([
        { text: nameLines[0], width: 0.45, align: 'left' },
        { text: quantity.toString(), width: 0.15, align: 'center' },
        { text: formattedPrice, width: 0.2, align: 'right' },
        { text: formattedTotal, width: 0.2, align: 'right' }
      ])
      // Nếu có nhiều dòng, in các dòng tiếp theo chỉ với tên, các cột còn lại để trống
      for (let i = 1; i < nameLines.length; i++) {
        printer.tableCustom([
          { text: nameLines[i], width: 0.45, align: 'left' },
          { text: '', width: 0.15, align: 'center' },
          { text: '', width: 0.2, align: 'right' },
          { text: '', width: 0.2, align: 'right' }
        ])
      }
    })

    // Thông tin giảm giá free giờ đầu trong khung 10-19 (đã trừ vào tổng) - in xuống dòng
    if (bill.freeHourPromotion && bill.freeHourPromotion.freeMinutesApplied > 0) {
      let promotionTimeText = 'KM gio dau tien'
      const promoStartSource = bill.actualStartTime || bill.startTime
      if (promoStartSource) {
        const startTime = dayjs(promoStartSource).tz('Asia/Ho_Chi_Minh')
        const endTime = startTime.add(60, 'minute')
        promotionTimeText = `KM (${startTime.format('HH:mm')} - ${endTime.format('HH:mm')})`
      }

      printer.text('------------------------------------------------')
      // In tên khuyến mãi trên dòng đầu
      printer.align('lt').text(promotionTimeText)
      // In số tiền giảm trên dòng thứ hai, căn phải
      printer.align('rt').text(`-${bill.freeHourPromotion.freeAmount.toLocaleString('vi-VN')}`)
    }

    // Hiển thị discount từ gift (discount_percentage hoặc discount_amount) - in thẳng hàng
    if (
      bill.gift &&
      (bill.gift.type === 'discount' ||
        bill.gift.type === 'discount_percentage' ||
        bill.gift.type === 'discount_amount')
    ) {
      let subtotalAmount = 0
      bill.items.forEach((item) => {
        const rawTotal = item.quantity * item.price
        subtotalAmount += rawTotal
      })

      const isPercentGift = bill.gift.type === 'discount' || bill.gift.type === 'discount_percentage'
      const computedGiftDiscount =
        bill.giftDiscountAmount !== undefined
          ? bill.giftDiscountAmount
          : isPercentGift && bill.gift.discountPercentage !== undefined
            ? (subtotalAmount * bill.gift.discountPercentage) / 100
            : bill.gift.discountAmount || 0

      const giftLabel =
        isPercentGift && bill.gift.discountPercentage !== undefined ? `Gift ${bill.gift.discountPercentage}%` : 'Gift'

      printer.tableCustom([
        { text: giftLabel, width: 0.45, align: 'left' },
        { text: '', width: 0.15, align: 'center' },
        { text: '', width: 0.2, align: 'right' },
        { text: `-${computedGiftDiscount.toLocaleString('vi-VN')}`, width: 0.2, align: 'right' }
      ])
    }

    // Hiển thị discount từ activePromotion nếu có - in thẳng hàng
    if (bill.activePromotion) {
      let subtotalAmount = 0
      bill.items.forEach((item) => {
        const rawTotal = item.quantity * item.price
        subtotalAmount += rawTotal
      })

      const discountAmount = (subtotalAmount * bill.activePromotion.discountPercentage) / 100

      printer.tableCustom([
        { text: 'Tong tien hang', width: 0.45, align: 'left' },
        { text: '', width: 0.15, align: 'center' },
        { text: '', width: 0.2, align: 'right' },
        { text: `${subtotalAmount.toLocaleString('vi-VN')}`, width: 0.2, align: 'right' }
      ])

      printer.tableCustom([
        { text: `Discount ${bill.activePromotion.discountPercentage}%`, width: 0.45, align: 'left' },
        { text: '', width: 0.15, align: 'center' },
        { text: '', width: 0.2, align: 'right' },
        { text: `-${discountAmount.toLocaleString('vi-VN')}`, width: 0.2, align: 'right' }
      ])
    }

    printer
      .text('--------------------------------------------')
      .align('rt')
      .style('b')
      .text(`TONG CONG: ${bill.totalAmount.toLocaleString('vi-VN')} VND`)
      .align('lt')
      .style('normal')
      .text('--------------------------------------------')

    if (bill.paymentMethod) {
      const paymentMethods: { [key: string]: string } = {
        cash: 'Tien mat',
        bank_transfer: 'Chuyen khoan',
        momo: 'MoMo',
        zalo_pay: 'Zalo Pay',
        vnpay: 'VNPay',
        visa: 'Visa',
        mastercard: 'Mastercard'
      }
      const paymentMethodText = paymentMethods[bill.paymentMethod] || bill.paymentMethod
      printer.text(`Phuong thuc thanh toan: ${paymentMethodText}`)
    }

    printer
      .align('ct')
      .text('--------------------------------------------')
      .text('Cam on quy khach da su dung dich vu cua Jozo')
      .text('Hen gap lai quy khach!')
      .text('--------------------------------------------')
      .align('ct')
      .text('Dia chi: 247/5 Phan Trung, Tam Hiep, Bien Hoa')
      .text('Website: jozo.com.vn')
      .style('i')
      .text('Powered by Jozo')
      .style('normal')
      .feed(2)

    return printer.getText()
  }

  /**
   * Tìm menu item theo ID, tìm trong cả fnb_menu và fnb_menu_item collections
   */
  private async findMenuItemById(menuId: string, menu: any[]): Promise<{ name: string; price: number } | null> {
    // Tìm menu item chính trước
    let menuItem = menu.find((m) => m._id.toString() === menuId)

    if (menuItem) {
      // Nếu tìm thấy menu chính
      return {
        name: menuItem.name,
        price: menuItem.price
      }
    } else {
      // Nếu không tìm thấy menu chính, tìm trong fnb_menu_item collection
      const menuItemFromService = await fnbMenuItemService.getMenuItemById(menuId)
      if (menuItemFromService) {
        return {
          name: menuItemFromService.name,
          price: menuItemFromService.price
        }
      } else {
        // Nếu vẫn không tìm thấy, tìm trong variants của menu chính
        for (const menuItem of menu) {
          if (menuItem.variants && Array.isArray(menuItem.variants)) {
            const variant = menuItem.variants.find((v: any) => v.id === menuId)
            if (variant) {
              // Lấy tên product cha và tên variant
              return {
                name: `${menuItem.name} - ${variant.name}`,
                price: variant.price
              }
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Chuyển đổi giá tiền từ nhiều định dạng khác nhau sang số
   * Ví dụ: "10.000" -> 10000, "10,000" -> 10000, 10 -> 10000
   */
  private parsePrice(price: string | number): number {
    if (typeof price === 'number') {
      // Nếu giá là số nhỏ (ví dụ: 10), nhân với 1000
      if (price < 1000) {
        return price * 1000
      }
      return price
    }

    // Xóa tất cả dấu chấm và phẩy, sau đó chuyển thành số
    const cleanPrice = price.replace(/[.,]/g, '')
    const numericPrice = Number(cleanPrice)

    if (isNaN(numericPrice)) {
      console.error(`Invalid price format: ${price}`)
      return 0
    }

    // Nếu giá là số nhỏ (ví dụ: 10), nhân với 1000
    if (numericPrice < 1000) {
      return numericPrice * 1000
    }

    return numericPrice
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
}

const billService = new BillService()
export default billService

export async function printUnicodeWithEscpos(text: string): Promise<void> {
  const escpos = require('escpos')
  escpos.USB = require('escpos-usb')
  const iconv = require('iconv-lite')
  const idVendor = 1137
  const idProduct = 85
  const device = new escpos.USB(idVendor, idProduct)
  const printer = new escpos.Printer(device, { encoding: 'GB18030' })

  return new Promise((resolve, reject) => {
    device.open(function (err: any) {
      if (err) return reject(err)
      const buffer = iconv.encode(text, 'cp1258')
      printer.raw(buffer)
      printer.cut()
      printer.close()
      resolve()
    })
  })
}

export async function printBitmapUnicode(text: string): Promise<void> {
  const escpos = require('escpos')
  escpos.USB = require('escpos-usb')
  const sharp = require('sharp')
  const fs = require('fs')
  const path = require('path')

  // Render text ra BMP buffer
  const imageBuffer = await sharp({
    text: {
      text: `<span foreground=\"black\">${text}</span>`,
      font: 'DejaVu Sans',
      width: 384,
      height: 100,
      rgba: true
    }
  })
    .bmp()
    .toBuffer()

  // Ghi buffer ra file tạm
  const tmpPath = path.join(__dirname, 'temp_print.bmp')
  fs.writeFileSync(tmpPath, imageBuffer)

  // In ảnh BMP bằng escpos gốc
  const idVendor = 1137
  const idProduct = 85
  const device = new escpos.USB(idVendor, idProduct)
  const printer = new escpos.Printer(device)

  return new Promise((resolve, reject) => {
    device.open(function (err: any) {
      if (err) return reject(err)
      printer.image(tmpPath, 'd24', function () {
        for (let i = 0; i < 15; i++) printer.text('\n')
        printer.cut()
        printer.close()
        fs.unlinkSync(tmpPath)
        resolve()
      })
    })
  })
}

export async function printBitmapWithEscpos(text: string): Promise<void> {
  const escpos = require('escpos')
  escpos.USB = require('escpos-usb')
  const sharp = require('sharp')
  const fs = require('fs')
  const path = require('path')

  // Render text ra PNG buffer và ghi ra file tạm
  const imageBuffer = await sharp({
    text: {
      text: `<span foreground="black">${text}</span>`,
      font: 'DejaVu Sans',
      width: 384,
      height: 100,
      rgba: true
    }
  })
    .png()
    .toBuffer()
  const tmpPath = path.join(__dirname, 'temp_print_escpos.png')
  fs.writeFileSync(tmpPath, imageBuffer)

  // In ảnh bằng escpos gốc
  const idVendor = 1137
  const idProduct = 85
  const device = new escpos.USB(idVendor, idProduct)
  const printer = new escpos.Printer(device)

  return new Promise((resolve, reject) => {
    device.open(function (err: any) {
      if (err) return reject(err)
      printer.image(tmpPath, 's8', function () {
        for (let i = 0; i < 5; i++) printer.newLine()
        printer.cut()
        printer.close()
        // Xóa file tạm sau khi in
        fs.unlinkSync(tmpPath)
        resolve()
      })
    })
  })
}

function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}
