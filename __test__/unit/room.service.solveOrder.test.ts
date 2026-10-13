import { EventEmitter } from 'events'

jest.mock('~/services/redis.service', () => ({
  __esModule: true,
  default: {
    exists: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    keys: jest.fn()
  }
}))
jest.mock('~/services/database.service', () => ({
  __esModule: true,
  default: { rooms: { findOne: jest.fn() }, roomSchedule: { findOne: jest.fn() } }
}))
jest.mock('~/services/fnbOrder.service', () => ({
  __esModule: true,
  default: { upsertFnbOrder: jest.fn() }
}))
jest.mock('~/services/fnbSalesMovement.service', () => ({
  __esModule: true,
  default: { logDeltas: jest.fn() }
}))
jest.mock('~/services/roomMusic.service', () => ({
  roomMusicEventEmitter: new EventEmitter()
}))

import { roomServices } from '~/services/room.service'

const redisMock = jest.requireMock('~/services/redis.service').default as {
  exists: jest.Mock
  get: jest.Mock
  del: jest.Mock
}
const fnbOrderServiceMock = jest.requireMock('~/services/fnbOrder.service').default as {
  upsertFnbOrder: jest.Mock
}
const fnbSalesMovementServiceMock = jest.requireMock('~/services/fnbSalesMovement.service').default as {
  logDeltas: jest.Mock
}

describe('RoomServices.solveOrder FNB consistency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const db = jest.requireMock('~/services/database.service').default
    db.rooms.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439013', roomId: 1 })
    db.roomSchedule.findOne.mockResolvedValue({
      roomId: '507f1f77bcf86cd799439013',
      status: 'in-progress',
      endTime: null
    })
    redisMock.exists.mockResolvedValue(1)
    redisMock.del.mockResolvedValue(1)
    fnbOrderServiceMock.upsertFnbOrder.mockResolvedValue({ _id: 'saved-order' })
    fnbSalesMovementServiceMock.logDeltas.mockResolvedValue(undefined)
  })

  it('does not mark a legacy notification as served when cart data is missing', async () => {
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        notificationId: 'notification-1',
        orderData: {
          roomScheduleId: '507f1f77bcf86cd799439011',
          items: [{ itemId: '507f1f77bcf86cd799439012', quantity: 2 }]
        }
      })
    )

    await expect(roomServices.solveOrder('1', 'order-1', 'staff-1')).rejects.toMatchObject({ status: 409 })

    expect(fnbOrderServiceMock.upsertFnbOrder).not.toHaveBeenCalled()
    expect(fnbSalesMovementServiceMock.logDeltas).not.toHaveBeenCalled()
    expect(redisMock.del).not.toHaveBeenCalled()
  })

  it('adds the cart before recording sales and clears notification only after both succeed', async () => {
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        notificationId: 'notification-2',
        orderData: {
          roomScheduleId: '507f1f77bcf86cd799439011',
          itemDeltas: [{ itemId: '507f1f77bcf86cd799439012', delta: 2 }],
          cart: {
            lines: [
              {
                lineId: 'line-1',
                itemId: '507f1f77bcf86cd799439012',
                category: 'drink',
                quantity: 2
              }
            ]
          }
        }
      })
    )

    await roomServices.solveOrder('1', 'order-2', 'staff-1')

    expect(fnbOrderServiceMock.upsertFnbOrder).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      expect.objectContaining({ lines: [expect.objectContaining({ quantity: 2 })] }),
      'staff-1',
      'add',
      'notification-2'
    )
    expect(fnbSalesMovementServiceMock.logDeltas).toHaveBeenCalledWith(
      [{ itemId: '507f1f77bcf86cd799439012', delta: 2 }],
      'karaoke',
      '507f1f77bcf86cd799439011',
      'staff-1',
      'notification-2'
    )
    expect(redisMock.del).toHaveBeenCalledWith('room_1_new_order_order-2')
    expect(fnbOrderServiceMock.upsertFnbOrder.mock.invocationCallOrder[0]).toBeLessThan(
      fnbSalesMovementServiceMock.logDeltas.mock.invocationCallOrder[0]
    )
    expect(fnbSalesMovementServiceMock.logDeltas.mock.invocationCallOrder[0]).toBeLessThan(
      redisMock.del.mock.invocationCallOrder[0]
    )
  })

  it('does not clear notification or record sales when bill persistence fails', async () => {
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        notificationId: 'notification-3',
        orderData: {
          roomScheduleId: '507f1f77bcf86cd799439011',
          itemDeltas: [{ itemId: '507f1f77bcf86cd799439012', delta: 2 }],
          cart: {
            lines: [
              {
                lineId: 'line-1',
                itemId: '507f1f77bcf86cd799439012',
                category: 'drink',
                quantity: 2
              }
            ]
          }
        }
      })
    )
    fnbOrderServiceMock.upsertFnbOrder.mockRejectedValue(new Error('bill write failed'))

    await expect(roomServices.solveOrder('1', 'order-3', 'staff-1')).rejects.toThrow('bill write failed')

    expect(fnbSalesMovementServiceMock.logDeltas).not.toHaveBeenCalled()
    expect(redisMock.del).not.toHaveBeenCalled()
  })

  const pending = () =>
    JSON.stringify({
      notificationId: 'stable-id',
      orderData: {
        roomScheduleId: '507f1f77bcf86cd799439011',
        itemDeltas: [{ itemId: '507f1f77bcf86cd799439012', delta: 2 }],
        cart: { lines: [{ lineId: 'line', itemId: '507f1f77bcf86cd799439012', category: 'drink', quantity: 2 }] }
      }
    })

  it('keeps pending notification on a null canonical write', async () => {
    redisMock.get.mockResolvedValue(pending())
    fnbOrderServiceMock.upsertFnbOrder.mockResolvedValue(null)
    await expect(roomServices.solveOrder('1', 'alias', 'staff')).rejects.toMatchObject({ status: 409 })
    expect(redisMock.del).not.toHaveBeenCalled()
    expect(fnbSalesMovementServiceMock.logDeltas).not.toHaveBeenCalled()
  })

  it('retries with the same durable reference after movement failure', async () => {
    redisMock.get.mockResolvedValue(pending())
    fnbSalesMovementServiceMock.logDeltas.mockRejectedValueOnce(new Error('movement failed'))
    await expect(roomServices.solveOrder('1', 'alias', 'staff')).rejects.toThrow('movement failed')
    expect(redisMock.del).not.toHaveBeenCalled()
    await roomServices.solveOrder('1', 'stable-id', 'staff')
    expect(fnbOrderServiceMock.upsertFnbOrder.mock.calls.map((call) => call[4])).toEqual(['stable-id', 'stable-id'])
    expect(fnbSalesMovementServiceMock.logDeltas.mock.calls.map((call) => call[4])).toEqual(['stable-id', 'stable-id'])
    expect(redisMock.del).toHaveBeenCalledTimes(1)
  })

  it('allows serving an in-use schedule past its planned endTime', async () => {
    redisMock.get.mockResolvedValue(pending())
    jest.requireMock('~/services/database.service').default.roomSchedule.findOne.mockResolvedValue({
      roomId: '507f1f77bcf86cd799439013',
      status: 'in use',
      endTime: new Date(Date.now() - 3600000)
    })
    await expect(roomServices.solveOrder('1', 'alias', 'staff')).resolves.toMatchObject({ itemCount: 1 })
    expect(fnbOrderServiceMock.upsertFnbOrder).toHaveBeenCalledTimes(1)
  })

  it('allows an unfinished booked schedule with a planned future endTime', async () => {
    redisMock.get.mockResolvedValue(pending())
    jest.requireMock('~/services/database.service').default.roomSchedule.findOne.mockResolvedValue({
      roomId: '507f1f77bcf86cd799439013',
      status: 'booked',
      endTime: new Date(Date.now() + 3600000)
    })
    await expect(roomServices.solveOrder('1', 'alias', 'staff')).resolves.toMatchObject({ itemCount: 1 })
  })

  it.each([
    null,
    { roomId: 'other-room', status: 'in-progress' },
    { roomId: '507f1f77bcf86cd799439013', status: 'finished' },
    { roomId: '507f1f77bcf86cd799439013', status: 'in-progress', endTime: new Date() }
  ])('rejects missing, moved or finished schedules without mutation: %p', async (schedule) => {
    redisMock.get.mockResolvedValue(pending())
    jest.requireMock('~/services/database.service').default.roomSchedule.findOne.mockResolvedValue(schedule)
    await expect(roomServices.solveOrder('1', 'alias', 'staff')).rejects.toMatchObject({ status: 409 })
    expect(fnbOrderServiceMock.upsertFnbOrder).not.toHaveBeenCalled()
    expect(redisMock.del).not.toHaveBeenCalled()
  })
})
