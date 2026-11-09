import { createHash } from 'crypto'
import { RequestHandler, Router } from 'express'
import { Db, ObjectId } from 'mongodb'
import { TokenType, UserRole } from '~/constants/enum'
import { protect } from '~/middlewares/auth.middleware'
import databaseService from '~/services/database.service'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'
import { verifyToken } from '~/utils/jwt'
import { mutateDeviceSlot } from '~/sockets/deviceAuth'
import { deviceAuthorizationChanged } from '~/services/roomDeviceAuthorization.events'

const requireManagementAccessToken: RequestHandler = async (req, res, next) => {
  const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '')
  if (!match) return res.status(401).json({ error: 'UNAUTHORIZED' })
  try {
    const token = await verifyToken(match[1])
    if (token.token_type !== TokenType.AccessToken) return res.status(401).json({ error: 'UNAUTHORIZED' })
    return protect([UserRole.Admin, UserRole.Staff])(req, res, next)
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }
}

type DeviceType = 'video' | 'control'
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const validProof = (value: unknown): value is string =>
  validId(value) && Buffer.from(value, 'base64url').toString('base64url') === value

// Process-local only: production with multiple replicas needs a shared gateway/store limiter.
// Proof quotas are the normal per-device limit. A much wider IP ceiling is a
// last-resort guard against rotating proofs; it can still affect shared NATs.
function limiter(ipLimit: number, proofLimit: number): RequestHandler {
  const counts = new Map<string, { count: number; until: number }>()
  const maxEntries = 10000
  return (req, res, next) => {
    const now = Date.now()
    for (const [key, entry] of counts) if (entry.until <= now) counts.delete(key)
    const p = req.body?.proof
    const ipKey = `ip:${req.ip}`
    const proofKey = validProof(p) ? `proof:${createHash('sha256').update(p).digest('hex')}` : null
    const keys = [ipKey, ...(proofKey ? [proofKey] : [])]
    // Fail closed at capacity rather than evicting live entries and resetting quotas.
    if (counts.size + keys.filter((key) => !counts.has(key)).length > maxEntries) {
      const earliest = Math.min(...Array.from(counts.values(), (entry) => entry.until))
      const retryAfterSeconds = Math.max(1, Math.ceil((earliest - now) / 1000))
      return res.set('Retry-After', String(retryAfterSeconds)).status(429).json({ error: 'RATE_LIMITED', retryAfterSeconds })
    }
    const increment = (key: string) => {
      const entry = counts.get(key) ?? { count: 0, until: now + 60000 }
      entry.count++
      counts.set(key, entry)
      return entry.count
    }
    const proofCount = proofKey ? increment(proofKey) : 0
    // One already-limited device must not consume the shared NAT budget.
    const ipCount = proofCount > proofLimit ? 0 : increment(ipKey)
    if (ipCount > ipLimit || proofCount > proofLimit) {
      const until = Math.max(ipCount > ipLimit ? counts.get(ipKey)!.until : 0, proofCount > proofLimit && proofKey ? counts.get(proofKey)!.until : 0)
      const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000))
      return res.set('Retry-After', String(retryAfterSeconds)).status(429).json({ error: 'RATE_LIMITED', retryAfterSeconds })
    }
    next()
  }
}

export function createRoomDeviceAuthorizationRouter(
  db: Pick<Db, 'collection'>,
  adminAuth: RequestHandler = requireManagementAccessToken
): Router {
  const router = Router()
  const foundation = new RoomDeviceAuthorizationFoundation(db)
  const limitCreate = limiter(3000, 30)
  const limitStatus = limiter(6000, 30)
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  const handle =
    (fn: (body: any) => Promise<{ status?: number; data: unknown }>): RequestHandler =>
    async (req, res) => {
      try {
        if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' || Array.isArray(req.body))
          return res.status(400).json({ error: 'INVALID_INPUT' })
        const result = await fn(req.body)
        return res.status(result.status ?? 200).json(result.data)
      } catch {
        return res.status(500).json({ error: 'INTERNAL_ERROR' })
      }
    }
  const resolve = async (body: any): Promise<string | null> => {
    if (!Number.isSafeInteger(body.roomId) || body.roomId < 0 || !['video', 'control'].includes(body.clientType))
      return null
    const room = await db.collection('rooms').findOne({ roomId: body.roomId }, { projection: { _id: 1 } })
    return room?._id?.toString() ?? null
  }
  const validate = async (body: any) => {
    if (!Number.isSafeInteger(body.roomId) || body.roomId < 0 || !['video', 'control'].includes(body.clientType))
      return { error: { status: 400, data: { error: 'INVALID_INPUT' } } }
    const room = await resolve(body)
    if (!room) return { error: { status: 404, data: { error: 'ROOM_NOT_FOUND' } } }
    return { room, type: body.clientType as DeviceType }
  }
  router.post(
    '/requests',
    limitCreate,
    handle(async (body) => {
      if (!validProof(body.proof)) return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const request = await foundation.request(v.room!, v.type!, body.proof)
      deviceAuthorizationChanged()
      return { data: request }
    })
  )
  router.post(
    '/status',
    limitStatus,
    handle(async (body) => {
      if (!validProof(body.proof) || !validId(body.id)) return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const status = await foundation.status(v.room!, v.type!, body.id, body.proof)
      return status ? { data: { status } } : { status: 404, data: { error: 'NOT_FOUND' } }
    })
  )
  router.get('/admin', adminAuth, async (_req, res) => {
    try {
      const pending = await db
        .collection('room_device_authorization_foundation_requests')
        .aggregate([
          { $match: { status: 'pending', $expr: { $gt: ['$expiresAt', '$$NOW'] } } },
          {
            $lookup: {
              from: 'room_device_authorization_foundation',
              localField: 'slot',
              foreignField: '_id',
              as: 'slots'
            }
          },
          { $match: { $expr: { $ne: ['$_id', { $arrayElemAt: ['$slots.active.id', 0] }] } } },
          { $sort: { createdAt: 1, _id: 1 } },
          { $limit: 1001 },
          { $project: { _id: 0, id: '$_id', slot: 1, createdAt: 1, expiresAt: 1 } }
        ])
        .toArray()
      // A rejected TV polls every 7s. Show it only while seen recently; a
      // closed or offline TV remains rejected but need not leave a stale icon.
      const rejected = await db
        .collection('room_device_authorization_foundation_requests')
        .aggregate([
          { $match: { status: 'rejected', slot: /:video$/, $expr: { $gt: ['$rejectedLastSeenAt', { $subtract: ['$$NOW', 30000] }] } } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: 1001 },
          { $project: { _id: 0, id: '$_id', slot: 1, createdAt: 1, expiresAt: 1 } }
        ])
        .toArray()
      const active = await db
        .collection('room_device_authorization_foundation')
        .aggregate([
          { $match: { active: { $ne: null } } },
          { $sort: { _id: 1 } },
          { $limit: 1001 },
          { $project: { _id: 0, slot: '$_id', id: '$active.id' } }
        ])
        .toArray()
      const records = [...pending, ...active, ...rejected]
      const ids = records.map((r) => String(r.slot).split(':')[0]).filter((id) => ObjectId.isValid(id))
      const rooms = await db
        .collection('rooms')
        .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { roomId: 1, roomName: 1 } })
        .toArray()
      const byId = new Map(rooms.map((room) => [room._id.toString(), room]))
      const display = (record: any) => {
        const [id, clientType] = String(record.slot).split(':')
        const room = byId.get(id)
        if (!room || !['video', 'control'].includes(clientType)) return null
        const { slot, ...rest } = record
        return { ...rest, roomId: room.roomId, roomName: room.roomName, clientType }
      }
      return res.json({
        pending: pending.slice(0, 1000).map(display).filter(Boolean),
        active: active.slice(0, 1000).map(display).filter(Boolean),
        rejected: rejected.slice(0, 1000).map(display).filter(Boolean),
        truncated: pending.length > 1000 || active.length > 1000 || rejected.length > 1000
      })
    } catch {
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })
  router.post(
    '/admin/approve',
    adminAuth,
    handle(async (body) => {
      if (!validId(body.id) || !(body.expectedActiveId === null || validId(body.expectedActiveId)))
        return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const ok = await mutateDeviceSlot(v.room!, v.type!, () => foundation.approve(v.room!, v.type!, body.id, body.expectedActiveId))
      if (ok) deviceAuthorizationChanged([body.id, ...(body.expectedActiveId ? [body.expectedActiveId] : [])])
      return ok ? { data: { approved: true } } : { status: 409, data: { error: 'CONFLICT_OR_EXPIRED' } }
    })
  )
  router.post(
    '/admin/reject',
    adminAuth,
    handle(async (body) => {
      if (!validId(body.id)) return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const ok = await foundation.reject(v.room!, v.type!, body.id)
      if (ok) deviceAuthorizationChanged([body.id])
      return ok ? { data: { rejected: true } } : { status: 409, data: { error: 'CONFLICT_OR_EXPIRED' } }
    })
  )
  router.post(
    '/admin/reopen',
    adminAuth,
    handle(async (body) => {
      if (!validId(body.id) || body.clientType !== 'video') return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const ok = await foundation.reopen(v.room!, body.id)
      if (ok) deviceAuthorizationChanged([body.id])
      return ok ? { data: { reopened: true } } : { status: 409, data: { error: 'CONFLICT' } }
    })
  )
  router.post(
    '/admin/revoke',
    adminAuth,
    handle(async (body) => {
      if (!validId(body.expectedActiveId)) return { status: 400, data: { error: 'INVALID_INPUT' } }
      const v = await validate(body)
      if (v.error) return v.error
      const ok = await mutateDeviceSlot(v.room!, v.type!, () => foundation.revoke(v.room!, v.type!, body.expectedActiveId))
      if (ok) deviceAuthorizationChanged([body.expectedActiveId])
      return ok ? { data: { revoked: true } } : { status: 409, data: { error: 'CONFLICT' } }
    })
  )
  return router
}
export default createRoomDeviceAuthorizationRouter(databaseService.roomDeviceAuthorizationStore)
