import { randomBytes } from 'crypto'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { RoomDeviceAuthorizationFoundation } from './roomDeviceAuthorization.foundation'

let server: MongoMemoryServer
let client: MongoClient
let service: RoomDeviceAuthorizationFoundation
const secret = () => randomBytes(32).toString('base64url')
jest.setTimeout(90000)
beforeAll(async () => {
  server = await MongoMemoryServer.create()
  client = await MongoClient.connect(server.getUri())
  service = new RoomDeviceAuthorizationFoundation(client.db('device_foundation_test'))
})
afterAll(async () => { await client?.close(); await server?.stop() })
beforeEach(async () => { await client.db('device_foundation_test').dropDatabase() })

it('retains idempotency after more than 100 distinct requests for a slot', async () => {
  const proof = secret()
  const original = await service.request('scaling', 'video', proof)
  for (let i = 0; i < 110; i++) await service.request('scaling', 'video', secret())
  expect(await service.request('scaling', 'video', proof)).toEqual(original)
})

it('deduplicates retries without extending expiry and requires possession to read', async () => {
  const proof = secret()
  const a = await service.request('room-1', 'video', proof)
  const b = await service.request('room-1', 'video', proof)
  expect(b).toEqual(a)
  expect(a.expiresAt.getTime() - a.createdAt.getTime()).toBe(300000)
  expect(await service.status('room-1', 'video', a.id, secret())).toBeNull()
  expect(await service.status('room-1', 'video', a.id, proof)).toBe('pending')
})

it('deduplicates concurrent tabs and rejects non-canonical 32-byte proof encodings', async () => {
  const proof = secret()
  const requests = await Promise.all(Array.from({ length: 12 }, () => service.request('room-1', 'video', proof)))
  expect(requests.every((r) => r.id === requests[0].id && r.expiresAt.getTime() === requests[0].expiresAt.getTime())).toBe(true)
  await expect(service.request('room-1', 'video', 'A'.repeat(42) + 'B')).rejects.toThrow('Invalid proof')
})

it('serializes concurrent approvals, requires explicit expected slot for replacement and revokes', async () => {
  const a = secret(), b = secret()
  const ra = await service.request('room-1', 'control', a)
  const rb = await service.request('room-1', 'control', b)
  const results = await Promise.all([service.approve('room-1', 'control', ra.id, null), service.approve('room-1', 'control', rb.id, null)])
  expect(results.filter(Boolean)).toHaveLength(1)
  const winner = results[0] ? ra : rb
  const loser = results[0] ? rb : ra
  const winnerProof = results[0] ? a : b
  const loserProof = results[0] ? b : a
  expect(await service.verify('room-1', 'control', winnerProof)).toBe(true)
  expect(await service.approve('room-1', 'control', loser.id, null)).toBe(false)
  // A losing claim may already have been installed; it must never be rebound.
  const replacement = await service.request('room-1', 'control', secret())
  const replacementRecord = await client.db('device_foundation_test').collection('room_device_authorization_foundation_requests').findOne({ _id: replacement.id } as never)
  expect(await service.approve('room-1', 'control', replacement.id, winner.id)).toBe(true)
  expect(await service.verify('room-1', 'control', winnerProof)).toBe(false)
  expect(await service.verify('room-1', 'control', loserProof)).toBe(false)
  expect(replacementRecord).toBeTruthy()
  expect(await service.revoke('room-1', 'control', winner.id)).toBe(false)
  expect(await service.revoke('room-1', 'control', replacement.id)).toBe(true)
  expect(await service.verify('room-1', 'control', loserProof)).toBe(false)
})

it('retains expired proof history without resetting another tab', async () => {
  const collection = client.db('device_foundation_test').collection('room_device_authorization_foundation_requests')
  const oldProof = secret()
  const oldRequest = await service.request('room-1', 'video', oldProof)
  await collection.updateOne({ _id: oldRequest.id } as never, { $set: { expiresAt: new Date(0) } })
  for (let i = 1; i < 50; i++) {
    await service.request('room-1', 'video', secret())
  }
  await service.request('room-1', 'video', secret())
  expect(await service.request('room-1', 'video', oldProof)).toEqual({ ...oldRequest, expiresAt: new Date(0) })
  expect(await service.status('room-1', 'video', oldRequest.id, oldProof)).toBe('expired')
})

it('uses Mongo time for creation and expiry rather than the application clock', async () => {
  const original = Date.now
  Date.now = () => 0
  try {
    const proof = secret()
    const request = await service.request('clock', 'video', proof)
    expect(request.createdAt.getUTCFullYear()).toBeGreaterThan(2020)
    expect(request.expiresAt.getTime() - request.createdAt.getTime()).toBe(300000)
    expect(await service.status('clock', 'video', request.id, proof)).toBe('pending')
    await client.db('device_foundation_test').collection('room_device_authorization_foundation_requests').updateOne(
      { _id: request.id } as never, { $set: { expiresAt: new Date(1) } }
    )
    expect(await service.status('clock', 'video', request.id, proof)).toBe('expired')
  } finally { Date.now = original }
})

it('cannot approve expired requests, even if still present in storage', async () => {
  const proof = secret()
  const req = await service.request('room-1', 'video', proof)
  await client.db('device_foundation_test').collection('room_device_authorization_foundation_requests').updateOne(
    { _id: req.id } as never, { $set: { expiresAt: new Date(0) } }
  )
  expect(await service.approve('room-1', 'video', req.id, null)).toBe(false)
  expect(await service.status('room-1', 'video', req.id, proof)).toBe('expired')
})

it('recovers a claim after a crash before slot CAS and never resurrects after replacement', async () => {
  const proof = secret(), r = await service.request('crash', 'video', proof)
  const other = await service.request('crash', 'video', secret())
  const slots = (service as any).slots
  const fail = jest.spyOn(slots, 'updateOne').mockImplementationOnce(async () => { throw new Error('crash before CAS') })
  await expect(service.approve('crash', 'video', r.id, null)).rejects.toThrow('crash before CAS')
  fail.mockRestore()
  const requests = client.db('device_foundation_test').collection('room_device_authorization_foundation_requests')
  expect((await requests.findOne({ _id: r.id } as never))?.claim).toEqual({ expectedRevision: 0, expectedActiveId: null })
  expect(await service.approve('crash', 'video', r.id, null)).toBe(true)
  expect(await service.approve('crash', 'video', r.id, null)).toBe(true)
  expect(await service.approve('crash', 'video', other.id, r.id)).toBe(true)
  expect(await service.revoke('crash', 'video', other.id)).toBe(true)
  expect(await service.approve('crash', 'video', r.id, null)).toBe(false)
  expect(await service.verify('crash', 'video', proof)).toBe(false)
})

it('fails closed when a claim loses to another approval and an ABA revoke', async () => {
  const a = await service.request('aba', 'video', secret())
  const b = await service.request('aba', 'video', secret())
  const slots = (service as any).slots
  const fail = jest.spyOn(slots, 'updateOne').mockImplementationOnce(async () => { throw new Error('crash') })
  await expect(service.approve('aba', 'video', a.id, null)).rejects.toThrow('crash')
  fail.mockRestore()
  expect(await service.approve('aba', 'video', b.id, null)).toBe(true)
  expect(await service.revoke('aba', 'video', b.id)).toBe(true)
  expect(await service.approve('aba', 'video', a.id, null)).toBe(false)
  expect((await slots.findOne({ _id: 'aba:video' })).revision).toBe(2)
})

it('recovers after successful CAS and request-finalization crash, without resurrecting after revoke', async () => {
  const proof = secret(), r = await service.request('after', 'video', proof)
  const requests = (service as any).requests
  const update = requests.updateOne.bind(requests)
  const spy = jest.spyOn(requests, 'updateOne').mockImplementation(async (...args: any[]) => {
    if (args[1].$set?.status === 'approved') throw new Error('crash after CAS')
    return update(...args)
  })
  await expect(service.approve('after', 'video', r.id, null)).rejects.toThrow('crash after CAS')
  spy.mockRestore()
  expect(await service.status('after', 'video', r.id, proof)).toBe('approved')
  expect(await service.approve('after', 'video', r.id, null)).toBe(true)
  expect(await service.revoke('after', 'video', r.id)).toBe(true)
  expect(await service.approve('after', 'video', r.id, null)).toBe(false)
})

it('checks expiry again at slot CAS using Mongo time', async () => {
  const r = await service.request('expiry-cas', 'video', secret())
  const requests = client.db('device_foundation_test').collection('room_device_authorization_foundation_requests')
  await requests.updateOne({ _id: r.id } as never, [{ $set: { expiresAt: { $add: ['$$NOW', 300] } } }])
  const slots = (service as any).slots
  const update = slots.updateOne.bind(slots)
  const spy = jest.spyOn(slots, 'updateOne').mockImplementationOnce(async (...args: any[]) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return update(...args)
  })
  try { expect(await service.approve('expiry-cas', 'video', r.id, null)).toBe(false) }
  finally { spy.mockRestore() }
  expect((await requests.findOne({ _id: r.id } as never))?.claim).toBeDefined()
})

it('fails closed on an ID collision instead of changing an existing proof owner', async () => {
  const proof = secret(), r = await service.request('collision', 'video', proof)
  const requests = client.db('device_foundation_test').collection('room_device_authorization_foundation_requests')
  await requests.updateOne({ _id: r.id } as never, { $set: { proofHash: 'different-owner' } })
  await expect(service.request('collision', 'video', proof)).rejects.toThrow('Request ID collision')
  expect((await requests.findOne({ _id: r.id } as never))?.proofHash).toBe('different-owner')
})
