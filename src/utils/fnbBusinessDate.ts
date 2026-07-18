import dayjs, { type Dayjs } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export const VIETNAM_TZ = 'Asia/Ho_Chi_Minh'

/**
 * Ngày kinh doanh FNB: quán mở ~9h đến tối đa ~3h sáng hôm sau.
 * Mốc cắt: 03:00 VN — đơn trước 03:00 thuộc ngày kinh doanh hôm trước.
 */
export const FNB_BUSINESS_DAY_CUTOFF_HOUR = 3

/** Ngày kinh doanh hiện tại (YYYY-MM-DD, Asia/Ho_Chi_Minh). */
export function getFnbBusinessDateStr(now: Dayjs | Date | string = dayjs()): string {
  const vn = dayjs(now).tz(VIETNAM_TZ)
  if (vn.hour() < FNB_BUSINESS_DAY_CUTOFF_HOUR) {
    return vn.subtract(1, 'day').format('YYYY-MM-DD')
  }
  return vn.format('YYYY-MM-DD')
}

/**
 * Khoảng thời gian nửa mở [from, to) của một ngày kinh doanh.
 * Ví dụ 2026-07-18 → [2026-07-18 03:00, 2026-07-19 03:00).
 */
export function getFnbBusinessDateRange(businessDate: string): { from: Date; to: Date } {
  const from = dayjs
    .tz(businessDate, 'YYYY-MM-DD', VIETNAM_TZ)
    .hour(FNB_BUSINESS_DAY_CUTOFF_HOUR)
    .minute(0)
    .second(0)
    .millisecond(0)
  return {
    from: from.toDate(),
    to: from.add(1, 'day').toDate()
  }
}
