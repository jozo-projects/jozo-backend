import { Request, Response } from 'express'
import { UserRole } from '~/constants/enum'
import { getRevenueByRange } from '~/controllers/bill.controller'
import billService from './bill.service'
import databaseService from './database.service'

jest.mock('./database.service', () => ({
  __esModule: true,
  default: {
    bills: { find: jest.fn() },
    retailSales: { find: jest.fn() },
    users: { findOne: jest.fn(async () => ({ role: UserRole.Admin })) }
  }
}))
jest.mock('./fnbOrder.service', () => ({ __esModule: true, default: {} }))
jest.mock('./membership.service', () => ({ __esModule: true, default: {} }))
jest.mock('./holiday.service', () => ({ holidayService: {} }))
jest.mock('./fnbPendingOrder.service', () => ({ hasPendingFnbOrderForSchedule: jest.fn() }))
jest.mock('./revenueCheckout.persistence', () => ({ createRoomBillRevenuePersistence: jest.fn() }))
jest.mock('escpos-usb', () => ({ findPrinter: jest.fn(() => []) }))

const startDate = '2026-11-05T09:12:00+07:00'
const endDate = '2026-11-08T03:45:00+07:00'
async function request(query: Record<string, unknown>) {
  const json = jest.fn()
  const status = jest.fn().mockReturnValue({ json })
  await getRevenueByRange(
    { query, decoded_authorization: { user_id: '68bd00000000000000000004' } } as unknown as Request,
    { status } as unknown as Response
  )
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const collection of [databaseService.bills, databaseService.retailSales]) {
    jest.mocked(collection.find).mockReturnValue({ sort: () => ({ toArray: async () => [] }) } as never)
  }
})

it.each([
  [startDate, endDate],
  ['2026-11-05T02:12:00.000Z', '2026-11-07T20:45:00.000Z']
])(
  'exact mode passes half-open predicates to BOTH sources and returns canonical requested instants (%s)',
  async (startDate, endDate) => {
    const result = await request({ startDate, endDate, rangeMode: 'exact' })
    expect(result.status).toBe(200)
    const bounds = { $gte: new Date(startDate), $lt: new Date(endDate) }
    expect(databaseService.bills.find).toHaveBeenCalledWith({ startTime: bounds })
    expect(databaseService.retailSales.find).toHaveBeenCalledWith({ createdAt: bounds })
    expect(result.body.result.startDate.toISOString()).toBe('2026-11-05T02:12:00.000Z')
    expect(result.body.result.endDate.toISOString()).toBe('2026-11-07T20:45:00.000Z')
  }
)

it('omitted mode keeps legacy inclusive VN calendar-day predicates and metadata', async () => {
  const result = await billService.getRevenueByDateRange(startDate, endDate)
  const bounds = { $gte: new Date('2026-11-04T17:00:00.000Z'), $lte: new Date('2026-11-08T16:59:59.999Z') }
  expect(databaseService.bills.find).toHaveBeenCalledWith({ startTime: bounds })
  expect(databaseService.retailSales.find).toHaveBeenCalledWith({ createdAt: bounds })
  expect(result.startDate).toEqual(bounds.$gte)
  expect(result.endDate).toEqual(bounds.$lte)
})

it.each([
  ['not-a-date', endDate],
  ['2026-11-05', endDate],
  ['2026-11-05T09:12:00', endDate],
  ['2026-02-30T09:12:00Z', endDate],
  [startDate, startDate],
  [endDate, startDate],
  [startDate, 'invalid']
])('exact rejects invalid/equal/reversed bounds: %s → %s', async (startDate, endDate) => {
  expect((await request({ startDate, endDate, rangeMode: 'exact' })).status).toBe(400)
  expect(databaseService.bills.find).not.toHaveBeenCalled()
  expect(databaseService.retailSales.find).not.toHaveBeenCalled()
})

it.each(['unknown', '', ['exact'], { mode: 'exact' }])('rejects supplied unsupported mode %j', async (rangeMode) => {
  expect((await request({ startDate, endDate, rangeMode })).status).toBe(400)
  expect(databaseService.bills.find).not.toHaveBeenCalled()
})
