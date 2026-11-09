import { createHash } from 'crypto'
import { Collection, Db, Document } from 'mongodb'

// Internal primitive only: callers must enforce room identity, roles, rate limits and transport.
type DeviceType = 'video' | 'control'
type Claim = { expectedRevision: number; expectedActiveId: string | null }
type RequestRecord = { _id: string; slot: string; proofHash: string; createdAt: Date; expiresAt: Date; status: 'pending' | 'approved' | 'rejected'; claim?: Claim; generation?: number; rejectedLastSeenAt?: Date }
type Slot = { _id: string; revision: number; active: null | { id: string; proofHash: string } }

export class RoomDeviceAuthorizationFoundation {
  private readonly slots: Collection<Slot>
  private readonly requests: Collection<RequestRecord>
  constructor(db: Pick<Db, 'collection'>) {
    this.slots = db.collection<Slot>('room_device_authorization_foundation')
    this.requests = db.collection<RequestRecord>('room_device_authorization_foundation_requests')
  }
  private key(room: string, type: DeviceType): string {
    if (!room || room.includes(':') || (type !== 'video' && type !== 'control')) throw new Error('Invalid slot')
    return `${room}:${type}`
  }
  private hash(proof: string): string {
    if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) || Buffer.from(proof, 'base64url').toString('base64url') !== proof) throw new Error('Invalid proof')
    return createHash('sha256').update(proof).digest('hex')
  }
  async request(room: string, type: DeviceType, proof: string): Promise<{ id: string; createdAt: Date; expiresAt: Date }> {
    const slot = this.key(room, type), proofHash = this.hash(proof)
    // Deterministic, domain-separated ID makes both proof deduplication and ID uniqueness
    // rely on the built-in _id index. Reject a cryptographic collision rather than alias owners.
    const id = createHash('sha256').update(JSON.stringify([slot, proofHash])).digest('base64url')
    try { await this.slots.updateOne({ _id: slot }, { $setOnInsert: { active: null, revision: 0 } }, { upsert: true }) }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e }
    try {
      await this.requests.updateOne({ _id: id }, [{ $set: {
        slot: { $ifNull: ['$slot', { $literal: slot }] }, proofHash: { $ifNull: ['$proofHash', proofHash] },
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, expiresAt: { $ifNull: ['$expiresAt', { $add: ['$$NOW', 300000] }] },
        status: { $ifNull: ['$status', 'pending'] }
      } }], { upsert: true })
    } catch (e) { if ((e as { code?: number }).code !== 11000) throw e }
    const r = await this.requests.findOne({ _id: id })
    if (!r || r.slot !== slot || r.proofHash !== proofHash) throw new Error('Request ID collision')
    return { id, createdAt: r.createdAt, expiresAt: r.expiresAt }
  }
  async status(room: string, type: DeviceType, id: string, proof: string): Promise<'pending' | 'approved' | 'expired' | 'revoked' | 'rejected' | null> {
    const slot = this.key(room, type), proofHash = this.hash(proof)
    const [r] = await this.requests.aggregate<RequestRecord & { serverNow: Date }>([
      { $match: { _id: id, slot, proofHash } }, { $set: { serverNow: '$$NOW' } }
    ]).toArray()
    if (!r) return null
    const current = await this.slots.findOne({ _id: slot })
    if (current?.active?.id === id && current.active.proofHash === proofHash) return 'approved'
    if (r.status === 'approved') return 'revoked'
    if (r.status === 'rejected') {
      // Rejected TVs have no socket; their authenticated status poll is only a
      // liveness hint. It never changes the rejection or grants access.
      if (type === 'video') await this.requests.updateOne(
        { _id: id, slot, proofHash, status: 'rejected' },
        { $currentDate: { rejectedLastSeenAt: true } }
      )
      return 'rejected'
    }
    return r.expiresAt.getTime() <= r.serverNow.getTime() ? 'expired' : 'pending'
  }
  async approve(room: string, type: DeviceType, id: string, expectedActiveId: string | null): Promise<boolean> {
    const key = this.key(room, type)
    let candidate = await this.requests.findOne({ _id: id, slot: key })
    if (!candidate) return false
    let slot = await this.slots.findOne({ _id: key })
    if (!slot) return false
    // A successful slot CAS is authoritative even if the process crashed before
    // recording approved on the request. Never resurrect it after replacement/revoke.
    if (slot.active?.id === id && slot.active.proofHash === candidate.proofHash) return true
    if (candidate.status !== 'pending') return false
    if (!candidate.claim) {
      if ((slot.active?.id ?? null) !== expectedActiveId) return false
      const claim: Claim = { expectedRevision: slot.revision, expectedActiveId }
      // First writer wins permanently; competing approvals cannot change the claim.
      await this.requests.updateOne({ _id: id, slot: key, proofHash: candidate.proofHash, generation: candidate.generation ?? { $exists: false }, status: 'pending', claim: { $exists: false },
        $expr: { $gt: ['$expiresAt', '$$NOW'] } } as Document, { $set: { claim } })
      candidate = await this.requests.findOne({ _id: id, slot: key })
      if (!candidate) return false
    }
    const claim = candidate.claim
    if (!claim || claim.expectedActiveId !== expectedActiveId || candidate.status !== 'pending') return false
    // There is intentionally no cross-document transaction. A crash after claim
    // leaves it retryable only at the same revision; any intervening slot write
    // makes the claim permanently stale (including an ABA back to the same id).
    const result = await this.slots.updateOne({ _id: key, revision: claim.expectedRevision,
      'active.id': claim.expectedActiveId === null ? { $exists: false } : claim.expectedActiveId,
      $expr: { $gt: [{ $literal: candidate.expiresAt }, '$$NOW'] }
    } as Document, { $set: { active: { id, proofHash: candidate.proofHash } }, $inc: { revision: 1 } })
    if (!result.modifiedCount) {
      slot = await this.slots.findOne({ _id: key })
      if (slot?.active?.id !== id || slot.active.proofHash !== candidate.proofHash) return false
    }
    await this.requests.updateOne({ _id: id, slot: key, proofHash: candidate.proofHash }, { $set: { status: 'approved' } })
    return true
  }
  async reject(room: string, type: DeviceType, id: string): Promise<boolean> {
    // Competes atomically with approve's claim on this request document. Once a
    // claim exists an approval may still perform its slot CAS, so fail closed.
    const result = await this.requests.updateOne({ _id: id, slot: this.key(room, type), status: 'pending',
      claim: { $exists: false }, $expr: { $gt: ['$expiresAt', '$$NOW'] } } as Document,
    { $set: { status: 'rejected' }, $currentDate: { rejectedLastSeenAt: true } })
    return result.modifiedCount === 1
  }
  async reopen(room: string, id: string): Promise<boolean> {
    // Compete atomically with reject and approve's claim on this request.
    const result = await this.requests.updateOne(
      { _id: id, slot: this.key(room, 'video'), status: 'rejected', claim: { $exists: false } },
      [{ $set: { status: 'pending', createdAt: '$$NOW', expiresAt: { $add: ['$$NOW', 300000] }, generation: { $add: [{ $ifNull: ['$generation', 0] }, 1] } } }]
    )
    return result.modifiedCount === 1
  }
  async revoke(room: string, type: DeviceType, expectedActiveId: string): Promise<boolean> {
    const result = await this.slots.updateOne({ _id: this.key(room, type), 'active.id': expectedActiveId }, { $set: { active: null }, $inc: { revision: 1 } })
    return result.modifiedCount === 1
  }
  async verify(room: string, type: DeviceType, proof: string): Promise<boolean> {
    return Boolean(await this.slots.findOne({ _id: this.key(room, type), 'active.proofHash': this.hash(proof) }))
  }
}
