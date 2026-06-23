import multer from 'multer'
import { randomInt } from 'crypto'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'

dayjs.extend(utc)
dayjs.extend(timezone)

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'

function normalizeUrl(url?: string): string | undefined {
  const trimmed = url?.replace(/\/$/, '')
  return trimmed || undefined
}

function isLocalhostUrl(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)
}

/** Dev: CLIENT_URL; prod: BASE_URL (bỏ qua CLIENT_URL localhost nếu BASE_URL là prod) */
export function getClientUrl(): string | undefined {
  const clientUrl = normalizeUrl(process.env.CLIENT_URL)
  const baseUrl = normalizeUrl(process.env.BASE_URL)

  if (process.env.NODE_ENV === 'production') {
    return baseUrl || clientUrl
  }

  // Server prod hay quên xóa CLIENT_URL=localhost trong .env
  if (clientUrl && baseUrl && isLocalhostUrl(clientUrl) && !isLocalhostUrl(baseUrl)) {
    return baseUrl
  }

  return clientUrl || baseUrl
}

/**
 * Parses a date string and returns a Date object.
 * Throws an ErrorWithStatus with HTTP_STATUS_CODE.BAD_REQUEST if the date is invalid.
 *
 * @param dateStr - The date string to parse
 * @returns The parsed Date object
 */
export function parseDate(dateStr: string): Date {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) {
    throw new ErrorWithStatus({
      message: `Invalid date format: ${dateStr}`,
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
  return date
}

/**
 * Multer middleware configuration for handling file uploads.
 * Uses memory storage to store files in memory as Buffer objects.
 */
export const upload = multer({ storage: multer.memoryStorage() })

import ytdl from 'youtube-dl-exec'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Hàm nội bộ dùng lại cho cả getVideoInfo & streamVideo */
export async function fetchVideoInfo(videoId: string) {
  const info = (await ytdl(`https://youtu.be/${videoId}`, {
    dumpSingleJson: true,
    forceIpv4: true,
    geoBypassCountry: 'VN',
    format: 'bestvideo+bestaudio/best',
    addHeader: [`User-Agent: ${UA}`, 'Referer: https://www.youtube.com/']
  })) as any

  const hlsFormat = info.formats.find(
    (f: any) => f.manifest_url && (f.manifest_url.includes('.m3u8') || f.protocol === 'hls')
  )

  if (!hlsFormat) {
    const playable = info.formats.find((f: any) => f.vcodec !== 'none' && f.acodec !== 'none')
    if (!playable) throw new Error('No streaming format found')

    return {
      video_id: videoId,
      title: info.title,
      duration: info.duration,
      url: playable.url,
      headers: playable.http_headers,
      thumbnail: info.thumbnail,
      author: info.uploader,
      format_type: 'progressive'
    }
  }

  return {
    video_id: videoId,
    title: info.title,
    duration: info.duration,
    url: hlsFormat.manifest_url || hlsFormat.url,
    headers: hlsFormat.http_headers,
    thumbnail: info.thumbnail,
    author: info.uploader,
    format_type: 'hls'
  }
}

/**
 * Lọc các item có quantity = 0 khỏi order detail
 */
export function cleanOrderDetail(orderDetail: any) {
  if (orderDetail.order && Array.isArray(orderDetail.order.lines)) {
    orderDetail.order.lines = orderDetail.order.lines.filter((l: any) => Number(l?.quantity) > 0)
  }
  if (orderDetail.order && orderDetail.order.drinks) {
    orderDetail.order.drinks = Object.fromEntries(
      Object.entries(orderDetail.order.drinks).filter(([_, quantity]) => (quantity as number) > 0)
    )
  }
  if (orderDetail.order && orderDetail.order.snacks) {
    orderDetail.order.snacks = Object.fromEntries(
      Object.entries(orderDetail.order.snacks).filter(([_, quantity]) => (quantity as number) > 0)
    )
  }
  // Lọc drinks/snacks array
  if (orderDetail.items && orderDetail.items.drinks) {
    orderDetail.items.drinks = orderDetail.items.drinks.filter((item: any) => item.quantity > 0)
  }
  if (orderDetail.items && orderDetail.items.snacks) {
    orderDetail.items.snacks = orderDetail.items.snacks.filter((item: any) => item.quantity > 0)
  }
  return orderDetail
}

/**
 * Sinh mã booking 4 chữ số ngẫu nhiên an toàn bằng crypto.randomInt
 * @param min - Giá trị nhỏ nhất (mặc định: 0)
 * @param max - Giá trị lớn nhất (mặc định: 10000 cho mã 0000-9999)
 * @returns string - mã booking 4 chữ số với padding (ví dụ: "0042", "1234", "9999")
 * @example
 * generateBookingCode() // "0042" (0-9999)
 * generateBookingCode(1000, 10000) // "5678" (1000-9999, tránh mã bắt đầu bằng 0)
 */
export function generateBookingCode(min: number = 0, max: number = 10000): string {
  const code = randomInt(min, max) // sinh số ngẫu nhiên an toàn
  return code.toString().padStart(4, '0') // đảm bảo luôn 4 chữ số
}

/**
 * Chuẩn hóa mã booking về dạng 4 chữ số (vd: "123" -> "0123")
 */
/** Chuẩn hóa SĐT VN về dạng 0xxxxxxxxx */
export function normalizeVietnamPhone(phone?: string | null): string | null {
  if (!phone || typeof phone !== 'string') return null

  const digits = phone.replace(/[\s\-().+]/g, '')
  if (!digits) return null

  if (digits.startsWith('84') && digits.length >= 11) {
    return `0${digits.slice(2)}`
  }

  if (digits.startsWith('0')) {
    return digits
  }

  return `0${digits}`
}

/** Các biến thể SĐT để tra user (0336…, 84336…, +84336…) */
export function buildUserPhoneLookupFilter(phone: string): { $or: Array<Record<string, unknown>> } {
  const normalized = normalizeVietnamPhone(phone)
  const digits = (normalized || phone).replace(/\D/g, '')
  const suffix = digits.startsWith('84') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : digits

  const candidates = new Set<string>()
  if (normalized) candidates.add(normalized)
  if (digits) candidates.add(digits)
  if (suffix) {
    candidates.add(`0${suffix}`)
    candidates.add(`84${suffix}`)
    candidates.add(`+84${suffix}`)
  }

  return {
    $or: [
      ...Array.from(candidates).map((value) => ({ phone_number: value })),
      { phone_number: { $regex: new RegExp(`${suffix}$`) } }
    ]
  }
}

export function normalizeBookingCode(bookingCode: string): string {
  const digits = bookingCode.replace(/\D/g, '')
  if (!digits) {
    throw new ErrorWithStatus({
      message: 'Invalid booking code',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
  return digits.padStart(4, '0').slice(-4)
}

/**
 * Lấy ngày sử dụng (YYYY-MM-DD) theo timezone Việt Nam
 */
export function getDateOfUseFromDate(date: Date): string {
  return dayjs.tz(date, VN_TIMEZONE).format('YYYY-MM-DD')
}

/**
 * Filter kiểm tra trùng mã booking trong cùng ngày (kể cả bản ghi legacy chưa có dateOfUse)
 */
export function buildBookingCodeDuplicateFilter(dateOfUse: string, bookingCode: string) {
  const normalizedCode = normalizeBookingCode(bookingCode)
  const dayStart = dayjs.tz(dateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).startOf('day').toDate()
  const dayEnd = dayjs.tz(dateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).endOf('day').toDate()

  return {
    bookingCode: normalizedCode,
    $or: [
      { dateOfUse },
      { dateOfUse: { $exists: false }, startTime: { $gte: dayStart, $lte: dayEnd } }
    ]
  }
}

/**
 * Filter tra cứu mã booking theo ngày, hỗ trợ booking qua đêm và bản ghi legacy
 */
export function buildBookingCodeLookupFilter(bookingCode: string, dateOfUse: string) {
  const normalizedCode = normalizeBookingCode(bookingCode)
  const prevDateOfUse = dayjs.tz(dateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).subtract(1, 'day').format('YYYY-MM-DD')
  const dayStart = dayjs.tz(dateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).startOf('day').toDate()
  const dayEnd = dayjs.tz(dateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).endOf('day').toDate()
  const prevDayStart = dayjs.tz(prevDateOfUse, 'YYYY-MM-DD', VN_TIMEZONE).startOf('day').toDate()

  return {
    bookingCode: normalizedCode,
    $or: [
      { dateOfUse },
      { dateOfUse: prevDateOfUse, endTime: { $gt: dayStart } },
      { dateOfUse: { $exists: false }, startTime: { $gte: prevDayStart, $lte: dayEnd } }
    ]
  }
}

/**
 * Sinh mã booking duy nhất với kiểm tra trùng lặp
 * @param checkDuplicate - hàm kiểm tra trùng lặp trong database (return true nếu trùng)
 * @param maxAttempts - số lần thử tối đa (mặc định: 10)
 * @returns Promise<string> - mã booking 4 chữ số duy nhất
 * @example
 * const code = await generateUniqueBookingCode(async (code) => {
 *   const exists = await db.bookings.findOne({ bookingCode: code, dateOfUse: '2025-10-27' })
 *   return !!exists
 * })
 */
export async function generateUniqueBookingCode(
  checkDuplicate: (code: string) => Promise<boolean>,
  maxAttempts: number = 10
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Sinh mã 4 chữ số an toàn bằng crypto.randomInt
    const code = generateBookingCode()

    // Kiểm tra trùng lặp
    const isDuplicate = await checkDuplicate(code)

    if (!isDuplicate) {
      return code // Tìm được mã duy nhất
    }
  }

  // Nếu không tìm được mã duy nhất sau maxAttempts lần thử
  throw new Error(`Không thể sinh mã booking duy nhất sau ${maxAttempts} lần thử`)
}
