import { Collection } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  ISupportRequest,
  SUPPORT_REQUEST_ADMIN_NO_ACTION_MS,
  SupportRequest,
  SupportRequestActor,
  SupportRequestStatus
} from '~/models/schemas/SupportRequest.schema'
import databaseService from '~/services/database.service'
import { roomMusicEventEmitter } from '~/services/roomMusic.service'
import { createSupportRequest } from '~/services/supportRequest.transition'

type SupportRequestCollection = Pick<Collection<SupportRequest>, 'insertOne' | 'find' | 'findOne' | 'findOneAndUpdate'>

type SupportRequestServiceDependencies = {
  collection?: SupportRequestCollection
  now?: () => Date
}

const defaultDependencies = (): Required<SupportRequestServiceDependencies> => ({
  collection: databaseService.supportRequests,
  now: () => new Date()
})

function getDependencies(deps?: SupportRequestServiceDependencies) {
  const defaults = defaultDependencies()
  return {
    collection: deps?.collection ?? defaults.collection,
    now: deps?.now ?? defaults.now
  }
}

export async function expirePendingSupportRequests(
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest[]> {
  const { collection, now } = getDependencies(deps)
  const timedOutAt = now()
  const adminNoActionDeadline = new Date(timedOutAt.getTime() - SUPPORT_REQUEST_ADMIN_NO_ACTION_MS)
  const candidates = await collection
    .find({
      status: SupportRequestStatus.Pending,
      createdAt: { $lte: adminNoActionDeadline },
      timedOutAt: { $exists: false }
    })
    .toArray()
  const timedOutRequests: ISupportRequest[] = []

  for (const candidate of candidates) {
    const updated = await collection.findOneAndUpdate(
      { requestId: candidate.requestId, status: SupportRequestStatus.Pending },
      { $set: { status: SupportRequestStatus.NotSupported, timedOutAt } },
      { returnDocument: 'after' }
    )

    if (updated) {
      timedOutRequests.push(updated)
      roomMusicEventEmitter.emit('admin_notification', {
        type: 'support_request_not_supported',
        ...updated
      })
    }
  }

  return timedOutRequests
}

export async function getActiveSupportRequests(
  roomId: string,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest[]> {
  const { collection } = getDependencies(deps)
  return collection
    .find({
      roomId,
      status: {
        $in: [SupportRequestStatus.Pending, SupportRequestStatus.NotSupported, SupportRequestStatus.Acknowledged]
      }
    })
    .sort({ createdAt: -1 })
    .toArray()
}

export async function getAllSupportRequestHistory(
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest[]> {
  const { collection } = getDependencies(deps)
  return collection.find({}).sort({ createdAt: -1 }).toArray()
}

export async function getSupportRequestHistory(
  roomId: string,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest[]> {
  const { collection } = getDependencies(deps)
  return collection.find({ roomId }).sort({ createdAt: -1 }).toArray()
}

export async function createSupportRequestRecord(
  roomId: string,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest> {
  const { collection, now } = getDependencies(deps)
  const request = createSupportRequest(roomId, now())

  await collection.insertOne(request as SupportRequest)
  roomMusicEventEmitter.emit('admin_notification', {
    type: 'support_request_created',
    ...request
  })

  return request
}

export async function acknowledgeSupportRequestById(
  requestId: string,
  actor: SupportRequestActor,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest> {
  const { collection, now } = getDependencies(deps)
  const acknowledgedAt = now()
  const request = await collection.findOneAndUpdate(
    {
      requestId,
      status: { $in: [SupportRequestStatus.Pending, SupportRequestStatus.NotSupported] }
    },
    {
      $set: {
        status: SupportRequestStatus.Acknowledged,
        acknowledgedAt,
        acknowledgedBy: actor
      }
    },
    { returnDocument: 'after' }
  )

  if (request) {
    roomMusicEventEmitter.emit('admin_notification', {
      type: 'support_request_acknowledged',
      ...request
    })
    return request
  }

  const existing = await collection.findOne({ requestId })
  if (!existing) {
    throw new ErrorWithStatus({
      message: 'Support request not found',
      status: HTTP_STATUS_CODE.NOT_FOUND
    })
  }

  throw new ErrorWithStatus({
    message: 'Support request is no longer pending',
    status: HTTP_STATUS_CODE.CONFLICT
  })
}

export async function resolveSupportRequestById(
  requestId: string,
  actor: SupportRequestActor,
  supportNote: string,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest> {
  const { collection, now } = getDependencies(deps)
  const normalizedNote = supportNote.trim()
  if (!normalizedNote) {
    throw new ErrorWithStatus({
      message: 'Support note is required',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  const resolvedAt = now()
  const request = await collection.findOneAndUpdate(
    { requestId, status: SupportRequestStatus.Acknowledged },
    {
      $set: {
        status: SupportRequestStatus.Resolved,
        resolvedAt,
        resolvedBy: actor,
        supportNote: normalizedNote
      }
    },
    { returnDocument: 'after' }
  )

  if (request) {
    roomMusicEventEmitter.emit('admin_notification', {
      type: 'support_request_resolved',
      ...request
    })
    return request
  }

  const existing = await collection.findOne({ requestId })
  if (!existing) {
    throw new ErrorWithStatus({
      message: 'Support request not found',
      status: HTTP_STATUS_CODE.NOT_FOUND
    })
  }

  throw new ErrorWithStatus({
    message: 'Only acknowledged support requests can resolve',
    status: HTTP_STATUS_CODE.CONFLICT
  })
}

export async function closeUnsupportedSupportRequestById(
  requestId: string,
  actor: SupportRequestActor,
  deps?: SupportRequestServiceDependencies
): Promise<ISupportRequest> {
  const { collection, now } = getDependencies(deps)
  const closedAt = now()
  const request = await collection.findOneAndUpdate(
    { requestId, status: SupportRequestStatus.NotSupported },
    {
      $set: {
        status: SupportRequestStatus.Closed,
        closedAt,
        closedBy: actor
      }
    },
    { returnDocument: 'after' }
  )

  if (request) {
    roomMusicEventEmitter.emit('admin_notification', {
      type: 'support_request_closed',
      ...request
    })
    return request
  }

  const existing = await collection.findOne({ requestId })
  if (!existing) {
    throw new ErrorWithStatus({
      message: 'Support request not found',
      status: HTTP_STATUS_CODE.NOT_FOUND
    })
  }

  throw new ErrorWithStatus({
    message: 'Only unsupported requests can be closed this way',
    status: HTTP_STATUS_CODE.CONFLICT
  })
}
