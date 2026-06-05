import dayjs from 'dayjs'

/** Ngày bắt đầu kỳ báo cáo tháng (mặc định: ngày 6). */
export const REPORTING_MONTH_START_DAY = 6

/**
 * Kỳ báo cáo tháng: từ ngày 6 tháng M đến hết ngày 5 tháng M+1 (theo múi giờ của anchorDate).
 * Ví dụ anchor 2026-06-05 → 06/05/2026 – 05/06/2026; anchor 2026-06-06 → 06/06/2026 – 05/07/2026.
 */
export function resolveReportingMonthRange(
  anchorDate: dayjs.Dayjs,
  startDayOfMonth = REPORTING_MONTH_START_DAY
): { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs } {
  const endDayOfMonth = startDayOfMonth - 1

  if (anchorDate.date() >= startDayOfMonth) {
    return {
      fromDate: anchorDate.date(startDayOfMonth).startOf('day'),
      toDate: anchorDate.add(1, 'month').date(endDayOfMonth).endOf('day')
    }
  }

  return {
    fromDate: anchorDate.subtract(1, 'month').date(startDayOfMonth).startOf('day'),
    toDate: anchorDate.date(endDayOfMonth).endOf('day')
  }
}
