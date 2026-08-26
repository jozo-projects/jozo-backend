import { hasPendingFnbOrderForSchedule } from '~/services/fnbPendingOrder.service'

jest.mock('~/services/redis.service', () => ({
  __esModule: true,
  default: {
    keys: jest.fn(),
    get: jest.fn()
  }
}))

const redisMock = jest.requireMock('~/services/redis.service').default as {
  keys: jest.Mock
  get: jest.Mock
}

describe('fnbPendingOrderService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('detects an unserved FNB order for the schedule', async () => {
    redisMock.keys.mockResolvedValue(['room_1_new_order_order-1'])
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        orderData: {
          roomScheduleId: 'schedule-1',
          servedAt: undefined
        }
      })
    )

    await expect(hasPendingFnbOrderForSchedule('schedule-1')).resolves.toBe(true)
  })

  it('does not block a schedule when its notifications are served or belong to another schedule', async () => {
    redisMock.keys.mockResolvedValue(['room_1_new_order_order-1', 'room_1_new_order_order-2'])
    redisMock.get
      .mockResolvedValueOnce(
        JSON.stringify({
          orderData: {
            roomScheduleId: 'schedule-1',
            servedAt: new Date().toISOString()
          }
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          orderData: {
            roomScheduleId: 'schedule-2'
          }
        })
      )

    await expect(hasPendingFnbOrderForSchedule('schedule-1')).resolves.toBe(false)
  })
})
