import { SupportRequestStatus } from '~/models/schemas/SupportRequest.schema'
import {
  acknowledgeSupportRequestById,
  createSupportRequestRecord,
  resolveSupportRequestById
} from '~/services/supportRequest.service'

describe('support request persistence service', () => {
  const createdAt = new Date('2026-09-21T10:00:00.000Z')
  const actor = { userId: 'staff-1', name: 'Staff A', role: 'staff' as const }

  it('persists a separate pending record for every customer attempt', async () => {
    const insertOne = jest.fn().mockResolvedValue({ insertedId: 'ignored' })
    const collection = { insertOne } as never

    const first = await createSupportRequestRecord('101', { collection, now: () => createdAt })
    const second = await createSupportRequestRecord('101', { collection, now: () => createdAt })

    expect(first.requestId).not.toBe(second.requestId)
    expect(insertOne).toHaveBeenCalledTimes(2)
    expect(insertOne.mock.calls[0][0]).toMatchObject({ roomId: '101', status: SupportRequestStatus.Pending })
  })

  it('acknowledges atomically using a pending and unexpired filter', async () => {
    const updated = {
      requestId: 'req-1',
      roomId: '101',
      status: SupportRequestStatus.Acknowledged,
      acknowledgedBy: actor
    }
    const findOneAndUpdate = jest.fn().mockResolvedValue(updated)
    const result = await acknowledgeSupportRequestById('req-1', actor, {
      collection: { findOneAndUpdate } as never,
      now: () => createdAt
    })

    expect(result).toEqual(updated)
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        requestId: 'req-1',
        status: { $in: [SupportRequestStatus.Pending, SupportRequestStatus.NotSupported] }
      },
      expect.objectContaining({ $set: expect.objectContaining({ status: SupportRequestStatus.Acknowledged }) }),
      { returnDocument: 'after' }
    )
  })

  it('rejects resolving without a note and persists a trimmed note after acknowledgement', async () => {
    const findOne = jest.fn().mockResolvedValue({
      requestId: 'req-1',
      roomId: '101',
      status: SupportRequestStatus.Acknowledged
    })
    const findOneAndUpdate = jest.fn().mockResolvedValue({
      requestId: 'req-1',
      status: SupportRequestStatus.Resolved,
      supportNote: 'Đã thay pin remote'
    })
    const collection = { findOne, findOneAndUpdate } as never

    await expect(
      resolveSupportRequestById('req-1', actor, '   ', { collection, now: () => createdAt })
    ).rejects.toThrow('Support note is required')

    const result = await resolveSupportRequestById('req-1', actor, '  Đã thay pin remote  ', {
      collection,
      now: () => createdAt
    })

    expect(result.supportNote).toBe('Đã thay pin remote')
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { requestId: 'req-1', status: SupportRequestStatus.Acknowledged },
      expect.objectContaining({ $set: expect.objectContaining({ supportNote: 'Đã thay pin remote' }) }),
      { returnDocument: 'after' }
    )
  })
})
