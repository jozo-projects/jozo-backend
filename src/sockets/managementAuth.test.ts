import { createServer, Server as HttpServer } from 'http'
import { AddressInfo } from 'net'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { TokenType, UserRole } from '~/constants/enum'
import { installManagementAuth } from './managementAuth'
import { RoomSocket } from './room.socket'
import { EmployeeScheduleSocket } from './employeeSchedule.socket'
import { NotificationSocket } from './notification.socket'
import { OrderSocket } from './order.socket'
import { PrintSocket } from './print.socket'

jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: jest.fn(async (id: string) => id === 'staff-id' ? { role: 'staff' } : id === 'admin-id' ? { role: 'admin' } : { role: 'user' }) } }))
jest.mock('~/services/redis.service', () => ({}))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicServices: {}, roomMusicEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/songPruneJob.service', () => ({ songPruneJobEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/room.service', () => ({ roomEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/roomDevicePresence.service', () => ({ roomDevicePresenceService: { register: jest.fn(), unregister: jest.fn() } }))
jest.mock('~/services/song.service', () => ({ songService: {} }))
jest.mock('~/services/employeeSchedule.service', () => ({ employeeScheduleEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/notification.service', () => ({ notificationEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/coffeeOrderRealtime.service', () => ({ coffeeOrderRealtimeEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/database.service', () => ({ __esModule: true, default: { coffeeTables: { findOne: jest.fn(async () => ({ _id: 'table-id' })) } } }))

// Real Engine.IO / Socket.IO websocket client; ws is a socket.io dependency.
const WebSocket = require('ws')
let http: HttpServer
let io: Server
let url: string
const clients: any[] = []
const secret = 'socket-test-key'
const token = (id: string, type = TokenType.AccessToken, options: jwt.SignOptions = {}) => jwt.sign({ user_id: id, token_type: type }, secret, options)

async function connect(query: Record<string, string> = {}, auth: object = {}) {
  const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket&${new URLSearchParams(query)}`)
  clients.push(ws)
  return await new Promise<{ ws: any; id: string }>((resolve, reject) => {
    ws.on('error', reject)
    ws.on('message', (raw: Buffer) => {
      const msg = raw.toString()
      if (msg.startsWith('0')) ws.send(`40${JSON.stringify(auth)}`)
      else if (msg.startsWith('40')) resolve({ ws, id: JSON.parse(msg.slice(2)).sid })
      else if (msg.startsWith('44')) reject(new Error('Unauthorized'))
    })
  })
}
async function barrier(ws: any) {
  await new Promise<void>((resolve) => {
    const listener = (raw: Buffer) => { if (raw.toString().startsWith('431')) { ws.off('message', listener); resolve() } }
    ws.on('message', listener)
    ws.send('421["test_barrier"]')
  })
}
const rooms = (id: string) => io.sockets.sockets.get(id)!.rooms
beforeAll(async () => {
  process.env.JWT_SECRET = secret
  jest.spyOn(console, 'log').mockImplementation(() => {})
  http = createServer()
  io = new Server(http)
  installManagementAuth(io)
  RoomSocket(io); PrintSocket(io); EmployeeScheduleSocket(io); NotificationSocket(io); OrderSocket(io)
  io.on('connection', socket => socket.on('test_barrier', (ack) => ack()))
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(async () => {
  clients.forEach(ws => ws.terminate())
  await new Promise<void>(resolve => io.close(() => resolve()))
  jest.restoreAllMocks()
  delete process.env.SOCKET_MANAGEMENT_AUTH
})

test('enabled: verified staff identity defeats query, roomId and join_room spoofing across handlers', async () => {
  process.env.SOCKET_MANAGEMENT_AUTH = 'true'
  const attacker = await connect({ role: 'admin', userId: 'victim', roomId: 'management' })
  attacker.ws.send('42["join_room","management"]')
  attacker.ws.send('42["join_room","user:victim"]')
  await barrier(attacker.ws)
  expect([...rooms(attacker.id)]).toEqual([attacker.id])
  const other = await connect({ roomId: 'user:victim' })
  await barrier(other.ws)
  expect(rooms(other.id).has('user:victim')).toBe(false)
  const staff = await connect({ role: 'admin', userId: 'victim', roomId: 'user:victim' }, { token: token('staff-id') })
  staff.ws.send('42["join_room","user:victim"]')
  staff.ws.send('42["join_room","user:staff-id"]')
  await barrier(staff.ws)
  expect(rooms(staff.id).has('management')).toBe(true)
  expect(rooms(staff.id).has('user:staff-id')).toBe(true)
  expect(rooms(staff.id).has('user:victim')).toBe(false)
  const admin = await connect({}, { token: token('admin-id') })
  expect(rooms(admin.id).has('management')).toBe(true)
})

test('enabled: invalid, expired, refresh and non-management tokens rejected', async () => {
  process.env.SOCKET_MANAGEMENT_AUTH = 'true'
  for (const bad of ['bad', token('staff-id', TokenType.RefreshToken), token('user-id'), token('staff-id', TokenType.AccessToken, { expiresIn: -1 })]) {
    await expect(connect({}, { token: bad })).rejects.toThrow('Unauthorized')
  }
})

test('enabled: legacy room, table and printer clients retain their rooms', async () => {
  process.env.SOCKET_MANAGEMENT_AUTH = 'true'
  const device = await connect({ roomId: 'room-123', tableCode: 'T1' })
  device.ws.send('42["join-room",{"printerId":"p1"}]')
  await barrier(device.ws)
  expect([...rooms(device.id)]).toEqual(expect.arrayContaining(['room-123', 'table:T1', 'printer:p1']))
  expect(rooms(device.id).has('management')).toBe(false)
})

test('disabled: legacy query roles and user rooms still work', async () => {
  delete process.env.SOCKET_MANAGEMENT_AUTH
  const legacy = await connect({ role: 'staff', userId: 'legacy', roomId: 'management' })
  await barrier(legacy.ws)
  expect([...rooms(legacy.id)]).toEqual(expect.arrayContaining(['management', 'user:legacy']))
})
