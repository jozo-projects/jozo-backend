import { randomUUID } from 'node:crypto'
import {
  ISupportRequest,
  SUPPORT_REQUEST_CUSTOMER_WAIT_MS,
  SupportRequestActor,
  SupportRequestStatus
} from '~/models/schemas/SupportRequest.schema'

export function createSupportRequest(roomId: string, createdAt = new Date()): ISupportRequest {
  const normalizedRoomId = roomId.trim()
  if (!normalizedRoomId) {
    throw new Error('Room ID is required')
  }

  return {
    requestId: randomUUID(),
    roomId: normalizedRoomId,
    status: SupportRequestStatus.Pending,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + SUPPORT_REQUEST_CUSTOMER_WAIT_MS)
  }
}

export function acknowledgeSupportRequest(
  request: ISupportRequest,
  actor: SupportRequestActor,
  acknowledgedAt = new Date()
): ISupportRequest {
  if (request.status !== SupportRequestStatus.Pending) {
    throw new Error('Only pending support requests can be acknowledged')
  }
  return {
    ...request,
    status: SupportRequestStatus.Acknowledged,
    acknowledgedAt,
    acknowledgedBy: actor
  }
}

export function expireSupportRequest(request: ISupportRequest, expiredAt = new Date()): ISupportRequest {
  if (request.status !== SupportRequestStatus.Pending) {
    throw new Error('Only pending support requests can expire')
  }
  if (expiredAt.getTime() < request.expiresAt.getTime()) {
    throw new Error('Support request has not expired')
  }

  return {
    ...request,
    status: SupportRequestStatus.NotSupported,
    timedOutAt: expiredAt
  }
}

export function resolveSupportRequest(
  request: ISupportRequest,
  actor: SupportRequestActor,
  supportNote: string,
  resolvedAt = new Date()
): ISupportRequest {
  if (request.status !== SupportRequestStatus.Acknowledged) {
    throw new Error('Only acknowledged support requests can resolve')
  }

  const normalizedNote = supportNote.trim()
  if (!normalizedNote) {
    throw new Error('Support note is required')
  }

  return {
    ...request,
    status: SupportRequestStatus.Resolved,
    resolvedAt,
    resolvedBy: actor,
    supportNote: normalizedNote
  }
}
