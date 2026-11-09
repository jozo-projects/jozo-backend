import { createServer } from 'http'
import { AddressInfo } from 'net'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { TokenType } from '~/constants/enum'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'
import { installManagementAuth } from './managementAuth'
import { installDeviceAuth, mutateDeviceSlot } from './deviceAuth'
import { RoomSocket } from './room.socket'

jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: jest.fn(async () => ({ role: 'staff' })) } }))
jest.mock('~/services/redis.service', () => ({ __esModule: true, default: { set: jest.fn(), get: jest.fn(), del: jest.fn() } }))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicServices: { getNowPlaying: jest.fn(), getSongsInQueue: jest.fn(async () => []), sendNotificationToAdmin: jest.fn() }, roomMusicEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/songPruneJob.service', () => ({ songPruneJobEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/room.service', () => ({ roomEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/roomDevicePresence.service', () => ({ roomDevicePresenceService: { register: jest.fn(), unregister: jest.fn() } }))
jest.mock('~/services/song.service', () => ({ songService: { getSavedSongsByVideoIds: jest.fn(async () => ({})) } }))
const WebSocket = require('ws')
const clients: any[] = []
const db: any = { collection: (name: string) => name === 'rooms' ? { findOne: async ({ roomId }: any) => roomId === 1 || roomId === 2 ? { _id: `id${roomId}` } : null } : {} }
let active = true
let io: Server, url: string
const observed: Array<{ id: string; event: string; payload: any }> = []
async function connect(query: Record<string, string> = {}, auth: object = {}) {
  const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket&${new URLSearchParams(query)}`)
  clients.push(ws)
  return new Promise<{ ws: any; id: string }>((resolve, reject) => {
    ws.on('error', reject)
    ws.on('message', (raw: Buffer) => {
      const msg = raw.toString()
      if (msg.startsWith('0')) ws.send(`40${JSON.stringify(auth)}`)
      else if (msg.startsWith('40')) resolve({ ws, id: JSON.parse(msg.slice(2)).sid })
      else if (msg.startsWith('44')) reject(new Error('Unauthorized'))
    })
  })
}
const delay = () => new Promise(resolve => setTimeout(resolve, 100))
beforeAll(async () => {
  process.env.JWT_SECRET = 'device-test-secret'
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(RoomDeviceAuthorizationFoundation.prototype, 'verify').mockImplementation(async (id, type, proof) => active && id === 'id1' && ((type === 'control' && proof === 'good') || (type === 'video' && proof === 'video-good')))
  const http = createServer(); io = new Server(http)
  installManagementAuth(io); installDeviceAuth(io, db); RoomSocket(io)
  io.on('connection', socket => {
    for (const event of ['command', 'adjustVolume', 'get_video_state', 'play_song', 'next_song', 'clear_room_data', 'remove_current_song', 'send_notification', 'video_ready', 'time_update', 'sync_time', 'check_now_playing', 'song_ended', 'video_event', 'future_room_event']) {
      socket.on(event, payload => observed.push({ id: socket.id, event, payload }))
    }
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(async () => {
  clients.forEach(ws => ws.terminate()); await new Promise<void>(resolve => io.close(() => resolve()))
  delete process.env.SOCKET_DEVICE_AUTH; delete process.env.SOCKET_MANAGEMENT_AUTH; jest.restoreAllMocks()
})
test('opt-in binds device, blocks spoofed payloads and anonymous room actions, allows verified management', async () => {
  process.env.SOCKET_DEVICE_AUTH = 'true'
  await expect(connect({ roomId: '1', clientType: 'control' })).rejects.toThrow('Unauthorized')
  await expect(connect({ roomId: '1', clientType: 'video' }, { deviceProof: 'good' })).rejects.toThrow('Unauthorized')
  await expect(connect({ roomId: '1', clientType: 'admin' }, { deviceProof: 'good' })).rejects.toThrow('Unauthorized')
  const device = await connect({ roomId: '1', clientType: 'control' }, { deviceProof: 'good' })
  const video = await connect({ roomId: '1', clientType: 'video' }, { deviceProof: 'video-good' })
  const anonymous = await connect()
  const token = jwt.sign({ user_id: 'staff', token_type: TokenType.AccessToken }, process.env.JWT_SECRET!)
  const manager = await connect({}, { token })
  expect(io.sockets.sockets.get(device.id)!.rooms.has('1')).toBe(true)
  expect(io.sockets.sockets.get(manager.id)!.rooms.has('management')).toBe(true)
  const received: string[] = []
  device.ws.on('message', (m: Buffer) => received.push(m.toString()))
  device.ws.send('42["video_ready",{"roomId":"2","videoId":"bad"}]')
  video.ws.send('42["video_ready",{"roomId":"1","videoId":"self"}]')
  anonymous.ws.send('42["video_ready",{"roomId":"1","videoId":"bad"}]')
  manager.ws.send('42["video_ready",{"roomId":"1","videoId":"manager"}]')
  await delay()
  expect(received.some(m => m.includes('manager'))).toBe(true)
  expect(received.some(m => m.includes('self'))).toBe(true)
  expect(received.some(m => m.includes('bad'))).toBe(false)
  const closed = new Promise(resolve => device.ws.once('close', resolve))
  await mutateDeviceSlot('id1', 'control', async () => { active = false })
  await closed
  await expect(connect({ roomId: '1', clientType: 'control' }, { deviceProof: 'good' })).rejects.toThrow('Unauthorized')
})
test('event permissions use authenticated type and bound room, not payload claims', async () => {
  process.env.SOCKET_DEVICE_AUTH = 'true'
  active = true
  const control = await connect({ roomId: '1', clientType: 'control' }, { deviceProof: 'good' })
  const video = await connect({ roomId: '1', clientType: 'video' }, { deviceProof: 'video-good' })
  const anonymous = await connect()
  const cases: Array<[string, 'control' | 'video' | 'both', any]> = [
    ['command', 'control', { command: 'play' }], ['adjustVolume', 'control', 5],
    ['get_video_state', 'control', {}], ['play_song', 'control', { videoId: 'x' }],
    ['next_song', 'control', { roomId: '1' }], ['clear_room_data', 'control', { roomId: '1' }],
    ['remove_current_song', 'control', { roomId: '1' }], ['send_notification', 'control', { roomId: '1' }],
    ['video_ready', 'video', { roomId: '1', videoId: 'x' }], ['time_update', 'video', { roomId: '1' }],
    ['sync_time', 'video', { roomId: '1' }], ['check_now_playing', 'video', { roomId: '1' }],
    ['song_ended', 'both', { roomId: '1' }], ['video_event', 'both', { roomId: '1', event: 'play' }]
  ]
  for (const [event, , payload] of cases) {
    for (const client of [control, video, anonymous]) client.ws.send(`42${JSON.stringify([event, payload])}`)
  }
  video.ws.send('42["next_song",{"roomId":"1","clientType":"control","role":"admin"}]')
  video.ws.send('42["video_ready",{"roomId":"2","videoId":"cross"}]')
  control.ws.send('42["video_event",{"roomId":"2","event":"play"}]')
  video.ws.send('42["future_room_event",{"roomId":"1"}]')
  anonymous.ws.send('42["future_room_event",{"roomId":"1"}]')
  await delay()
  for (const [event, who] of cases) {
    expect(observed.filter(x => x.id === control.id && x.event === event)).toHaveLength(who === 'video' ? 0 : 1)
    expect(observed.filter(x => x.id === video.id && x.event === event)).toHaveLength(who === 'control' ? 0 : 1)
    expect(observed.filter(x => x.id === anonymous.id && x.event === event)).toHaveLength(0)
  }
  expect(observed.filter(x => [video.id, anonymous.id].includes(x.id) && x.event === 'future_room_event')).toHaveLength(0)
  expect(io.sockets.sockets.get(video.id)!.rooms.has('1')).toBe(true)
  expect(io.sockets.sockets.get(video.id)!.rooms.has('2')).toBe(false)
  expect(io.sockets.sockets.get(anonymous.id)!.rooms.has('1')).toBe(false)
})
test('handshake verification racing a slot mutation cannot join', async () => {
  process.env.SOCKET_DEVICE_AUTH='true'
  let release!: () => void
  let started!: () => void
  const begun = new Promise<void>(resolve => { started = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  jest.spyOn(RoomDeviceAuthorizationFoundation.prototype, 'verify').mockImplementationOnce(async () => {
    started(); await blocked; return true
  })
  const pending = connect({ roomId: '1', clientType: 'control' }, { deviceProof: 'good' })
  await begun
  await mutateDeviceSlot('id1', 'control', async () => {})
  release()
  await expect(pending).rejects.toThrow('Unauthorized')
})
test('flag off preserves legacy room query and event behavior', async () => {
  delete process.env.SOCKET_DEVICE_AUTH
  const legacy = await connect({ roomId: '1' })
  expect(io.sockets.sockets.get(legacy.id)!.rooms.has('1')).toBe(true)
  const received: string[] = []
  legacy.ws.on('message', (m: Buffer) => received.push(m.toString()))
  legacy.ws.send('42["video_ready",{"roomId":"1","videoId":"legacy"}]')
  await delay()
  expect(received.some(m => m.includes('legacy'))).toBe(true)
})
