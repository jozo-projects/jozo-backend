import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export const REVENUE_TIMEZONE = 'Asia/Ho_Chi_Minh'

/** Resolves the calendar reporting date for an instant in the requested timezone. */
export function resolveRevenueBusinessDate(
  date: Date | string | number,
  timezoneName: string = REVENUE_TIMEZONE
): string {
  const instant = dayjs(date)
  if (!instant.isValid()) {
    throw new Error('Invalid date')
  }
  return instant.tz(timezoneName).format('YYYY-MM-DD')
}
