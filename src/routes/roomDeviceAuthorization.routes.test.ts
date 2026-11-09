import express from 'express'
import request from 'supertest'
import { createHash, randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { TokenType, UserRole } from '~/constants/enum'
import { defaultErrorHandler } from '~/middlewares/error.middleware'
import { usersServices } from '~/services/users.services'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createRoomDeviceAuthorizationRouter } from './roomDeviceAuthorization.routes'

jest.setTimeout(90000)
let server: MongoMemoryServer, client: MongoClient, app: express.Express
const proof = () => randomBytes(32).toString('base64url')
beforeAll(async () => {
  server = await MongoMemoryServer.create()
  client = await MongoClient.connect(server.getUri())
})
afterAll(async () => {
  await client?.close()
  await server?.stop()
})
beforeEach(async () => {
  const db = client.db('device_api_test')
  await db.dropDatabase()
  await db.collection('rooms').insertOne({ roomId: 1, roomName: 'Room 1' })
  app = express()
    .use(express.json())
    .use(createRoomDeviceAuthorizationRouter(db, (_req, _res, next) => next()))
})
it('handles owner, approval, conflict and sanitized inventory', async () => {
  const p = proof(),
    other = proof()
  const a = await request(app).post('/requests').send({ roomId: 1, clientType: 'video', proof: p }).expect(200)
  const b = await request(app).post('/requests').send({ roomId: 1, clientType: 'video', proof: other }).expect(200)
  await request(app).post('/status').send({ roomId: 1, clientType: 'video', id: a.body.id, proof: other }).expect(404)
  await request(app)
    .post('/admin/approve')
    .send({ roomId: 1, clientType: 'video', id: a.body.id, expectedActiveId: null })
    .expect(200)
  await request(app)
    .post('/admin/approve')
    .send({ roomId: 1, clientType: 'video', id: b.body.id, expectedActiveId: null })
    .expect(409)
  const status = await request(app)
    .post('/status')
    .send({ roomId: 1, clientType: 'video', id: a.body.id, proof: p })
    .expect(200)
  expect(status.body.status).toBe('approved')
  const inventory = await request(app).get('/admin').expect(200)
  expect(JSON.stringify(inventory.body)).not.toMatch(/proof|hash/i)
  expect(inventory.body.pending.map((r: { id: string }) => r.id)).toEqual([b.body.id])
  expect(inventory.body.active[0].id).toBe(a.body.id)
  expect(inventory.body.active[0]).toMatchObject({ roomId: 1, roomName: 'Room 1', clientType: 'video' })
  await request(app)
    .post('/admin/approve')
    .send({ roomId: 1, clientType: 'video', id: b.body.id, expectedActiveId: a.body.id })
    .expect(200)
  expect(
    (await request(app).post('/status').send({ roomId: 1, clientType: 'video', id: a.body.id, proof: p }).expect(200))
      .body.status
  ).toBe('revoked')
  await request(app)
    .post('/admin/revoke')
    .send({ roomId: 1, clientType: 'video', expectedActiveId: a.body.id })
    .expect(409)
  await request(app)
    .post('/admin/revoke')
    .send({ roomId: 1, clientType: 'video', expectedActiveId: b.body.id })
    .expect(200)
  expect(
    (
      await request(app)
        .post('/status')
        .send({ roomId: 1, clientType: 'video', id: b.body.id, proof: other })
        .expect(200)
    ).body.status
  ).toBe('revoked')
})
it('rejects malformed requests and unknown rooms', async () => {
  await request(app).post('/requests').send({ roomId: 1, clientType: 'video', proof: 'bad' }).expect(400)
  await request(app).post('/requests').send({ roomId: 999, clientType: 'video', proof: proof() }).expect(404)
})

it('enforces actual role middleware', async () => {
  const old = process.env.JWT_SECRET
  const key = randomBytes(32).toString('hex')
  process.env.JWT_SECRET = key
  const getUser = jest.spyOn(usersServices, 'getUserById')
  try {
    const secured = express()
      .use(express.json())
      .use(createRoomDeviceAuthorizationRouter(client.db('device_api_test')))
      .use(defaultErrorHandler)
    await request(secured).get('/admin').expect(401)
    await request(secured).post('/admin/approve').send({}).expect(401)
    await request(secured).get('/admin').set('Authorization', 'Bearer invalid').expect(401)
    const token = jwt.sign({ user_id: 'actor', token_type: TokenType.AccessToken }, key)
    const refresh = jwt.sign({ user_id: 'actor', token_type: TokenType.RefreshToken }, key)
    getUser.mockResolvedValue({ role: UserRole.Admin } as never)
    await request(secured).get('/admin').set('Authorization', `Bearer ${refresh}`).expect(401)
    getUser.mockResolvedValue({ role: UserRole.Client } as never)
    await request(secured).get('/admin').set('Authorization', `Bearer ${token}`).expect(403)
    for (const role of [UserRole.Admin, UserRole.Staff]) {
      getUser.mockResolvedValue({ role } as never)
      await request(secured).get('/admin').set('Authorization', `Bearer ${token}`).expect(200)
    }
  } finally {
    getUser.mockRestore()
    if (old === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = old
  }
})

it('rejects expired approvals and omits expired inventory', async () => {
  const body = { roomId: 1, clientType: 'control', proof: proof() }
  const first = await request(app).post('/requests').send(body).expect(200)
  await client
    .db('device_api_test')
    .collection('room_device_authorization_foundation_requests')
    .updateOne({ _id: first.body.id } as never, { $set: { expiresAt: new Date(0) } })
  const retry = await request(app).post('/requests').send(body).expect(200)
  expect(retry.body.id).toBe(first.body.id)
  expect(retry.body.expiresAt).toBe(new Date(0).toISOString())
  expect(
    (
      await request(app)
        .post('/status')
        .send({ ...body, id: first.body.id })
        .expect(200)
    ).body.status
  ).toBe('expired')
  await request(app)
    .post('/admin/approve')
    .send({ roomId: 1, clientType: 'control', id: first.body.id, expectedActiveId: null })
    .expect(409)
  expect((await request(app).get('/admin').expect(200)).body.pending).toEqual([])
})

it('rejects a colliding record without revealing its hash', async () => {
  const db = client.db('device_api_test'),
    room = await db.collection('rooms').findOne({ roomId: 1 })
  const p = proof(),
    hash = createHash('sha256').update(p).digest('hex')
  const id = createHash('sha256')
    .update(JSON.stringify([`${room!._id}:video`, hash]))
    .digest('base64url')
  await db
    .collection('room_device_authorization_foundation_requests')
    .insertOne({ _id: id, slot: 'wrong:video', proofHash: hash } as never)
  const response = await request(app).post('/requests').send({ roomId: 1, clientType: 'video', proof: p }).expect(500)
  expect(JSON.stringify(response.body)).not.toContain(hash)
  expect(JSON.stringify(response.body)).not.toContain(p)
})

it('rejects proof in query strings and bounds invalid create floods', async () => {
  await request(app).post('/requests?proof=bad').send({ roomId: 1, clientType: 'video', proof: proof() }).expect(400)
  for (let i = 0; i < 2999; i++) await request(app).post('/requests').send({}).expect(400)
  await request(app).post('/requests').send({}).expect(429)
})

it('supports 20 devices polling every seven seconds behind one NAT', async () => {
  const db = client.db('device_api_test')
  await db.collection('rooms').insertMany(Array.from({ length: 9 }, (_, i) => ({ roomId: i + 2 })))
  const devices: Array<{ roomId: number; clientType: string; proof: string; id: string }> = []
  for (let roomId = 1; roomId <= 10; roomId++) {
    for (const clientType of ['video', 'control']) {
      const body = { roomId, clientType, proof: proof() }
      const response = await request(app).post('/requests').send(body).expect(200)
      devices.push({ ...body, id: response.body.id })
    }
  }
  const start = Date.now()
  const clock = jest.spyOn(Date, 'now')
  try {
    for (let tick = 0; tick < 9; tick++) {
      clock.mockReturnValue(start + tick * 7000)
      for (const device of devices) await request(app).post('/status').send(device).expect(200)
    }
  } finally {
    clock.mockRestore()
  }
})

it('separates create and status budgets and limits a single proof without leaking it', async () => {
  const body = { roomId: 1, clientType: 'video', proof: proof() }
  const created = await request(app).post('/requests').send(body).expect(200)
  for (let i = 0; i < 30; i++) await request(app).post('/status').send({ ...body, id: created.body.id }).expect(200)
  const limited = await request(app).post('/status').send({ ...body, id: created.body.id }).expect(429)
  for (let i = 0; i < 350; i++) await request(app).post('/status').send({ ...body, id: created.body.id }).expect(429)
  expect(JSON.stringify(limited.body)).not.toContain(body.proof)
  expect(JSON.stringify(limited.body)).not.toContain(createHash('sha256').update(body.proof).digest('hex'))
  await request(app).post('/requests').send(body).expect(200)
  const other = { ...body, proof: proof() }
  const otherCreated = await request(app).post('/requests').send(other).expect(200)
  await request(app).post('/status').send({ ...other, id: otherCreated.body.id }).expect(200)
})

it('bounds rotating proofs per IP and resets the window without exposing credentials', async () => {
  const start = Date.now()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(start)
  try {
    for (let i = 0; i < 6000; i++) {
      await request(app).post('/status').send({ roomId: 999, clientType: 'video', id: proof(), proof: proof() }).expect(404)
    }
    const p = proof()
    const body = { roomId: 999, clientType: 'video', id: proof(), proof: p }
    const response = await request(app).post('/status').send(body).expect(429)
    expect(JSON.stringify(response.body)).not.toContain(p)
    expect(JSON.stringify(response.body)).not.toContain(createHash('sha256').update(p).digest('hex'))
    clock.mockReturnValue(start + 60000)
    await request(app).post('/status').send(body).expect(404)
  } finally {
    clock.mockRestore()
  }
})

it('bounds invalid status floods separately from create requests', async () => {
  for (let i = 0; i < 6000; i++) await request(app).post('/status').send({}).expect(400)
  await request(app).post('/status').send({}).expect(429)
  await request(app).post('/requests').send({}).expect(400)
})
