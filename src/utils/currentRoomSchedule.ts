import { RoomScheduleStatus } from '~/constants/enum'

export type ScheduleForClientFnbPick = {
  status: RoomScheduleStatus | string
  startTime: Date | string
  endTime?: Date | string | null
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function coversNow(schedule: ScheduleForClientFnbPick, nowMs: number): boolean {
  const startMs = toTime(schedule.startTime)
  if (startMs === null || startMs > nowMs) return false
  const endMs = toTime(schedule.endTime ?? null)
  return endMs === null || endMs > nowMs
}

function pickLatestStart<T extends ScheduleForClientFnbPick>(schedules: T[]): T {
  return [...schedules].sort((a, b) => (toTime(b.startTime) ?? 0) - (toTime(a.startTime) ?? 0))[0]
}

/**
 * Tablet/client FNB chỉ biết roomId, không gửi scheduleId.
 * Ưu tiên phiên In Use đang chiếm phòng — kể cả overtime — để không gắn món vào booking tương lai
 * chỉ vì booking đó được tạo sau (createdAt mới hơn).
 */
export function pickCurrentRoomScheduleForClientFnb<T extends ScheduleForClientFnbPick>(
  schedules: T[],
  now: Date = new Date()
): T | null {
  const nowMs = now.getTime()
  const inUse = schedules.filter((schedule) => schedule.status === RoomScheduleStatus.InUse)

  if (inUse.length > 0) {
    const coveringNow = inUse.filter((schedule) => coversNow(schedule, nowMs))
    const startedAlready = inUse.filter((schedule) => {
      const startMs = toTime(schedule.startTime)
      return startMs !== null && startMs <= nowMs
    })
    const pool = coveringNow.length > 0 ? coveringNow : startedAlready.length > 0 ? startedAlready : inUse
    return pickLatestStart(pool)
  }

  const bookedCoveringNow = schedules.filter(
    (schedule) => schedule.status === RoomScheduleStatus.Booked && coversNow(schedule, nowMs)
  )
  if (bookedCoveringNow.length === 0) return null
  return pickLatestStart(bookedCoveringNow)
}
