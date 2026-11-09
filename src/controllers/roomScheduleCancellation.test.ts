import { getCancellations } from './roomSchedule.controller'
import { roomScheduleService } from '~/services/roomSchedule.service'

jest.mock('~/services/roomSchedule.service', () => ({ roomScheduleService: { getCancellations: jest.fn() } }))
const response = () => { const res: any = {}; res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res); return res }

it('rejects invalid ranges and pagination', async () => {
  for (const query of [
    { start: 'bad', end: '2026-01-02T00:00:00Z' },
    { start: '2026-02-30T00:00:00Z', end: '2026-03-05T00:00:00Z' },
    { start: '2026-01-02T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z', page: '0' },
    { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z', limit: '1.5' }
  ]) {
    const res = response()
    await getCancellations({ query } as any, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(400)
  }
})

it('passes a half-open range and pagination to the report service', async () => {
  const result = { items: [], total: 0, page: 2, limit: 10, bySource: [], unknownTimestampCount: 3 }
  jest.mocked(roomScheduleService.getCancellations).mockResolvedValue(result as never)
  const res = response()
  await getCancellations({ query: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z', page: '2', limit: '10' } } as any, res, jest.fn())
  expect(roomScheduleService.getCancellations).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), 2, 10)
  expect(res.json).toHaveBeenCalledWith({ message: expect.any(String), result })
})
