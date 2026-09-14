import { RoomScheduleStatus } from '~/constants/enum'
import { pickCurrentRoomScheduleForClientFnb } from './currentRoomSchedule'

function schedule(partial: {
  id: string
  status: RoomScheduleStatus
  start: string
  end?: string
  created?: string
}) {
  return {
    _id: partial.id,
    status: partial.status,
    startTime: new Date(partial.start),
    endTime: partial.end ? new Date(partial.end) : null,
    createdAt: new Date(partial.created ?? partial.start)
  }
}

describe('pickCurrentRoomScheduleForClientFnb', () => {
  const now = new Date('2026-09-14T08:00:00.000Z') // 15:00 VN

  it('prefers In Use over a later Booked schedule created more recently', () => {
    const inUse = schedule({
      id: 'in-use',
      status: RoomScheduleStatus.InUse,
      start: '2026-09-14T07:00:00.000Z',
      end: '2026-09-14T09:00:00.000Z',
      created: '2026-09-13T10:00:00.000Z'
    })
    const booked = schedule({
      id: 'booked',
      status: RoomScheduleStatus.Booked,
      start: '2026-09-14T09:00:00.000Z',
      end: '2026-09-14T11:00:00.000Z',
      created: '2026-09-14T06:00:00.000Z'
    })

    expect(pickCurrentRoomScheduleForClientFnb([inUse, booked], now)?._id).toBe('in-use')
  })

  it('keeps overtime In Use instead of attaching to the next Booked slot', () => {
    const overtime = schedule({
      id: 'overtime',
      status: RoomScheduleStatus.InUse,
      start: '2026-09-14T06:00:00.000Z',
      end: '2026-09-14T07:30:00.000Z'
    })
    const nextBooking = schedule({
      id: 'next-booked',
      status: RoomScheduleStatus.Booked,
      start: '2026-09-14T07:30:00.000Z',
      end: '2026-09-14T09:30:00.000Z',
      created: '2026-09-14T07:40:00.000Z'
    })

    expect(pickCurrentRoomScheduleForClientFnb([overtime, nextBooking], now)?._id).toBe('overtime')
  })

  it('falls back to Booked only when that slot currently covers now', () => {
    const bookedNow = schedule({
      id: 'booked-now',
      status: RoomScheduleStatus.Booked,
      start: '2026-09-14T07:00:00.000Z',
      end: '2026-09-14T09:00:00.000Z'
    })
    const bookedLater = schedule({
      id: 'booked-later',
      status: RoomScheduleStatus.Booked,
      start: '2026-09-14T10:00:00.000Z',
      end: '2026-09-14T12:00:00.000Z',
      created: '2026-09-14T07:50:00.000Z'
    })

    expect(pickCurrentRoomScheduleForClientFnb([bookedLater, bookedNow], now)?._id).toBe('booked-now')
  })

  it('does not attach tablet orders to a future Booked schedule', () => {
    const bookedLater = schedule({
      id: 'booked-later',
      status: RoomScheduleStatus.Booked,
      start: '2026-09-14T10:00:00.000Z',
      end: '2026-09-14T12:00:00.000Z'
    })

    expect(pickCurrentRoomScheduleForClientFnb([bookedLater], now)).toBeNull()
  })
})
