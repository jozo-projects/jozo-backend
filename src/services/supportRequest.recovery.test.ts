import { SupportRequestStatus } from '~/models/schemas/SupportRequest.schema'
import {
  expirePendingSupportRequests,
  getActiveSupportRequests,
  getSupportRequestHistory
} from '~/services/supportRequest.service'

describe('support request recovery and expiry', () => {
  const now = new Date('2026-09-21T10:01:00.000Z')

  it('logs a timeout for pending requests without hiding them', async () => {
    const pending = {
      requestId: 'req-1',
      roomId: '101',
      status: SupportRequestStatus.Pending,
      createdAt: new Date('2026-09-21T10:00:00.000Z'),
      expiresAt: new Date('2026-09-21T10:00:09.000Z')
    }
    const findOneAndUpdate = jest.fn().mockResolvedValue({ ...pending, timedOutAt: now })
    const find = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([pending]) })
    const collection = {
      find,
      findOneAndUpdate
    } as never

    const result = await expirePendingSupportRequests({ collection, now: () => now })

    expect(result).toEqual([{ ...pending, timedOutAt: now }])
    expect(find).toHaveBeenCalledWith({
      status: SupportRequestStatus.Pending,
      createdAt: { $lte: new Date('2026-09-21T10:00:00.000Z') },
      timedOutAt: { $exists: false }
    })
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { requestId: 'req-1', status: SupportRequestStatus.Pending },
      { $set: { status: SupportRequestStatus.NotSupported, timedOutAt: now } },
      { returnDocument: 'after' }
    )
  })

  it('returns only pending and acknowledged requests for active hydration', async () => {
    const toArray = jest.fn().mockResolvedValue([{ requestId: 'req-1' }])
    const sort = jest.fn().mockReturnValue({ toArray })
    const find = jest.fn().mockReturnValue({ sort })
    const result = await getActiveSupportRequests('101', {
      collection: { find } as never
    })

    expect(result).toEqual([{ requestId: 'req-1' }])
    expect(find).toHaveBeenCalledWith({
      roomId: '101',
      status: {
        $in: [SupportRequestStatus.Pending, SupportRequestStatus.NotSupported, SupportRequestStatus.Acknowledged]
      }
    })
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
  })

  it('returns all attempts in reverse chronological order for history tracking', async () => {
    const toArray = jest.fn().mockResolvedValue([{ requestId: 'req-2' }, { requestId: 'req-1' }])
    const sort = jest.fn().mockReturnValue({ toArray })
    const find = jest.fn().mockReturnValue({ sort })

    const result = await getSupportRequestHistory('101', { collection: { find } as never })

    expect(result).toEqual([{ requestId: 'req-2' }, { requestId: 'req-1' }])
    expect(find).toHaveBeenCalledWith({ roomId: '101' })
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
  })
})
