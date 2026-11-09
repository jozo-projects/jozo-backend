import express from 'express'
import { createServer, Server as HttpServer } from 'http'
import { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { Db, MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Server } from 'socket.io'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { TokenType, UserRole } from '~/constants/enum'
import { defaultErrorHandler } from '~/middlewares/error.middleware'
import { createRoomHttpAuthorization } from '~/middlewares/roomHttpAuthorization'
import { createRoomDeviceAuthorizationRouter } from './roomDeviceAuthorization.routes'
import { installDeviceAuth } from '~/sockets/deviceAuth'
import { installManagementAuth } from '~/sockets/managementAuth'
import { RoomSocket } from '~/sockets/room.socket'

// Prevent production service initialization. User lookup is an explicit adapter to the
// disposable database; JWT verification and role checks remain the real middleware.
let testDb: Db
jest.mock('~/services/database.service', () => ({ __esModule: true, default: { roomDeviceAuthorizationStore: { collection: () => ({}) } } }))
jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: (id: string) => testDb.collection('users').findOne({ _id: new ObjectId(id) }) } }))
jest.mock('~/services/redis.service', () => ({ __esModule: true, default: { set: jest.fn() } }))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicServices: {}, roomMusicEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/songPruneJob.service', () => ({ songPruneJobEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/room.service', () => ({ roomEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/roomDevicePresence.service', () => ({ roomDevicePresenceService: { register: jest.fn(), unregister: jest.fn() } }))
jest.mock('~/services/song.service', () => ({ songService: {} }))

// ws speaks Engine.IO/Socket.IO frames directly; no socket.io-client dependency needed.
const WebSocket = require('ws')
const proof = () => randomBytes(32).toString('base64url')
const sockets: any[] = []
let mongo: MongoMemoryServer, client: MongoClient, http: HttpServer, io: Server, url: string
let app: express.Express
const oldEnv = { ...process.env }
jest.setTimeout(30000)

async function connect(query: Record<string, string>, auth: object = {}): Promise<{ ws: any; id: string }> {
  const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket&${new URLSearchParams(query)}`)
  sockets.push(ws)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('socket handshake timeout')) }, 3000)
    ws.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    ws.on('message', (raw: Buffer) => {
      const frame = raw.toString()
      if (frame.startsWith('0')) ws.send(`40${JSON.stringify(auth)}`)
      else if (frame.startsWith('40')) { clearTimeout(timer); resolve({ ws, id: JSON.parse(frame.slice(2)).sid }) }
      else if (frame.startsWith('44')) { clearTimeout(timer); ws.close(); reject(new Error('Unauthorized')) }
      else if (frame === '2') ws.send('3')
    })
  })
}
function waitForFrame(ws: any, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`missing frame ${text}`)) }, 3000)
    const listener = (raw: Buffer) => { if (raw.toString().includes(text)) { clearTimeout(timer); ws.off('message', listener); resolve() } }
    ws.on('message', listener)
  })
}
function waitForClose(ws: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket close timeout')), 3000)
    ws.once('close', () => { clearTimeout(timer); resolve() })
  })
}
beforeAll(async () => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex')
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  process.env.SOCKET_DEVICE_AUTH = 'true'
  // Explicit local binary, no downloads or external database.
  mongo = await MongoMemoryServer.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY || '/opt/homebrew/bin/mongod' }, instance: { ip: '127.0.0.1' } })
  client = await MongoClient.connect(mongo.getUri())
  testDb = client.db('device_vertical')
  await testDb.collection('rooms').insertMany([{ roomId: 1, roomName: 'one' }, { roomId: 2, roomName: 'two' }])
  app = express().use(express.json())
  app.use('/devices', createRoomDeviceAuthorizationRouter(testDb))
  const roomRouter = express.Router()
  roomRouter.param('roomId', createRoomHttpAuthorization(testDb))
  // A harmless probe, not a production music handler: exercises real param middleware.
  roomRouter.get('/:roomId/now-playing', (req, res) => res.json({ room: req.params.roomId }))
  app.use('/music', roomRouter).use(defaultErrorHandler)
  http = createServer(app)
  io = new Server(http)
  installManagementAuth(io); installDeviceAuth(io, testDb); RoomSocket(io)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(async () => {
  sockets.forEach(ws => ws.terminate())
  if (io) await new Promise<void>(resolve => io.close(() => resolve()))
  await client?.close(); await mongo?.stop()
  for (const key of ['JWT_SECRET', 'HTTP_ROOM_DEVICE_AUTH', 'SOCKET_DEVICE_AUTH', 'SOCKET_MANAGEMENT_AUTH']) {
    if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]
  }
})

test('Mongo request, real role approval, HTTP and Socket.IO isolation, then revoke', async () => {
  const adminId = new ObjectId(), clientId = new ObjectId()
  await testDb.collection('users').insertMany([{ _id: adminId, role: UserRole.Admin }, { _id: clientId, role: UserRole.Client }])
  const token = (id: ObjectId, type = TokenType.AccessToken) => jwt.sign({ user_id: id.toString(), token_type: type }, process.env.JWT_SECRET!)
  const admin = `Bearer ${token(adminId)}`, ordinary = `Bearer ${token(clientId)}`
  const p = proof(), wrong = proof(), body = { roomId: 1, clientType: 'control', proof: p }
  const created = await request(app).post('/devices/requests').send(body).expect(200)
  const id: string = created.body.id
  const approve = { roomId: 1, clientType: 'control', id, expectedActiveId: null }
  await request(app).post('/devices/admin/approve').send(approve).expect(401)
  await request(app).post('/devices/admin/approve').set('Authorization', ordinary).send(approve).expect(403)
  expect((await request(app).post('/devices/status').send({ ...body, id }).expect(200)).body.status).toBe('pending')
  await request(app).post('/devices/admin/approve').set('Authorization', admin).send(approve).expect(200)
  expect((await request(app).post('/devices/status').send({ ...body, id }).expect(200)).body.status).toBe('approved')
  await request(app).get('/music/1/now-playing').set('X-Jozo-Device-Proof', wrong).expect(401)
  await request(app).get('/music/2/now-playing').set('X-Jozo-Device-Proof', p).expect(401)
  await request(app).get('/music/1/now-playing').set('X-Jozo-Device-Proof', p).expect(200)
  await request(app).get('/music/1/now-playing').set('Authorization', `Bearer ${token(adminId, TokenType.RefreshToken)}`).expect(401)
  await request(app).get('/music/1/now-playing').set('Authorization', admin).expect(200)
  await expect(connect({ roomId: '1', clientType: 'control' }, { deviceProof: wrong })).rejects.toThrow('Unauthorized')
  await expect(connect({ roomId: '2', clientType: 'control' }, { deviceProof: p })).rejects.toThrow('Unauthorized')
  const device = await connect({ roomId: '1', clientType: 'control' }, { deviceProof: p })
  expect(io.sockets.sockets.get(device.id)!.rooms.has('1')).toBe(true)
  // Observe real RoomSocket handler on the server; packet middleware must not deliver cross-room packets.
  const handled: string[] = []
  io.sockets.sockets.get(device.id)!.on('video_ready', (payload: { videoId: string }) => handled.push(payload.videoId))
  const selfFrame = waitForFrame(device.ws, 'allowed')
  device.ws.send('42["video_ready",{"roomId":"2","videoId":"forbidden"}]')
  device.ws.send('42["video_ready",{"roomId":"1","videoId":"allowed"}]')
  await selfFrame
  expect(handled).toEqual(['allowed'])
  const closed = waitForClose(device.ws)
  await request(app).post('/devices/admin/revoke').set('Authorization', admin).send({ roomId: 1, clientType: 'control', expectedActiveId: id }).expect(200)
  await closed
  await request(app).get('/music/1/now-playing').set('X-Jozo-Device-Proof', p).expect(401)
  expect((await request(app).post('/devices/status').send({ ...body, id }).expect(200)).body.status).toBe('revoked')
  await expect(connect({ roomId: '1', clientType: 'control' }, { deviceProof: p })).rejects.toThrow('Unauthorized')
})

test('expired request cannot be approved and flags off preserve probe/legacy socket access', async () => {
  const id = new ObjectId()
  await testDb.collection('users').insertOne({ _id: id, role: UserRole.Staff })
  const admin = `Bearer ${jwt.sign({ user_id: id.toString(), token_type: TokenType.AccessToken }, process.env.JWT_SECRET!)}`
  const body = { roomId: 2, clientType: 'video', proof: proof() }
  const created = await request(app).post('/devices/requests').send(body).expect(200)
  await testDb.collection('room_device_authorization_foundation_requests').updateOne({ _id: created.body.id } as never, { $set: { expiresAt: new Date(0) } })
  expect((await request(app).post('/devices/status').send({ ...body, id: created.body.id }).expect(200)).body.status).toBe('expired')
  await request(app).post('/devices/admin/approve').set('Authorization', admin).send({ roomId: 2, clientType: 'video', id: created.body.id, expectedActiveId: null }).expect(409)
  delete process.env.HTTP_ROOM_DEVICE_AUTH; delete process.env.SOCKET_DEVICE_AUTH; delete process.env.SOCKET_MANAGEMENT_AUTH
  await request(app).get('/music/2/now-playing').expect(200)
  const legacy = await connect({ roomId: '2' })
  expect(io.sockets.sockets.get(legacy.id)!.rooms.has('2')).toBe(true)
  const received = waitForFrame(legacy.ws, 'legacy')
  legacy.ws.send('42["video_ready",{"roomId":"2","videoId":"legacy"}]')
  await received
})
