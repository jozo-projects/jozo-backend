import {
  acknowledgeSupportRequest,
  createSupportRequest,
  expireSupportRequest,
  resolveSupportRequest
} from '~/services/supportRequest.transition'
import { SupportRequestStatus } from '~/models/schemas/SupportRequest.schema'

describe('support request transitions', () => {
  const createdAt = new Date('2026-09-21T10:00:00.000Z')

  it('creates a new pending request for every attempt', () => {
    const first = createSupportRequest('101', createdAt)
    const second = createSupportRequest('101', createdAt)

    expect(first.requestId).not.toBe(second.requestId)
    expect(first.roomId).toBe('101')
    expect(first.status).toBe(SupportRequestStatus.Pending)
    expect(first.expiresAt).toEqual(new Date('2026-09-21T10:00:10.000Z'))
  })

  it('marks an unacknowledged request as expired after its deadline', () => {
    const request = createSupportRequest('101', createdAt)

    const expired = expireSupportRequest(request, new Date('2026-09-21T10:01:00.001Z'))

    expect(expired.status).toBe(SupportRequestStatus.NotSupported)
    expect(expired.timedOutAt).toEqual(new Date('2026-09-21T10:01:00.001Z'))
  })

  it('does not expire a request before its deadline or after acknowledgement', () => {
    const request = createSupportRequest('101', createdAt)
    const acknowledged = acknowledgeSupportRequest(
      request,
      {
        userId: 'staff-1',
        name: 'Staff A',
        role: 'staff'
      },
      new Date('2026-09-21T10:00:05.000Z')
    )

    expect(() => expireSupportRequest(request, new Date('2026-09-21T10:00:09.999Z'))).toThrow(
      'Support request has not expired'
    )
    expect(() => expireSupportRequest(acknowledged, new Date('2026-09-21T10:01:00.001Z'))).toThrow(
      'Only pending support requests can expire'
    )
  })

  it('requires an acknowledgement before resolving and requires an admin note', () => {
    const request = createSupportRequest('101', createdAt)
    const actor = { userId: 'staff-1', name: 'Staff A', role: 'staff' as const }

    expect(() => resolveSupportRequest(request, actor, 'Fixed it', new Date())).toThrow(
      'Only acknowledged support requests can resolve'
    )

    const acknowledged = acknowledgeSupportRequest(request, actor, new Date('2026-09-21T10:00:05.000Z'))
    expect(() => resolveSupportRequest(acknowledged, actor, '   ', new Date())).toThrow('Support note is required')

    const resolved = resolveSupportRequest(
      acknowledged,
      actor,
      'Đã thay pin remote',
      new Date('2026-09-21T10:01:00.000Z')
    )

    expect(resolved.status).toBe(SupportRequestStatus.Resolved)
    expect(resolved.supportNote).toBe('Đã thay pin remote')
    expect(resolved.resolvedBy).toEqual(actor)
  })
})
