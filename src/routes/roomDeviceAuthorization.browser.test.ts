import express from 'express'
import cors from 'cors'
import { createServer, Server as HttpServer } from 'http'
import { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { spawn, ChildProcess } from 'child_process'
import { resolve } from 'path'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { Db, MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Server } from 'socket.io'
import { chromium, Browser, BrowserContext, Page } from 'playwright'
import jwt from 'jsonwebtoken'
import { TokenType, UserRole } from '~/constants/enum'
import { defaultErrorHandler } from '~/middlewares/error.middleware'
import { createRoomHttpAuthorization } from '~/middlewares/roomHttpAuthorization'
import { createRoomDeviceAuthorizationRouter } from './roomDeviceAuthorization.routes'
import { installDeviceAuth } from '~/sockets/deviceAuth'
import { installManagementAuth } from '~/sockets/managementAuth'
import { RoomSocket } from '~/sockets/room.socket'

// Only unrelated service integrations are replaced; device auth, JWT, Mongo and sockets are real.
let testDb: Db
jest.mock('~/services/database.service', () => ({ __esModule: true, default: { roomDeviceAuthorizationStore: { collection: () => ({}) } } }))
jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: (id: string) => testDb.collection('users').findOne({ _id: new ObjectId(id) }) } }))
jest.mock('~/services/redis.service', () => ({ __esModule: true, default: { set: jest.fn() } }))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicServices: { getNowPlaying: async () => null }, roomMusicEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/songPruneJob.service', () => ({ songPruneJobEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/room.service', () => ({ roomEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/roomDevicePresence.service', () => ({ roomDevicePresenceService: { register: jest.fn(), unregister: jest.fn() } }))
jest.mock('~/services/song.service', () => ({ songService: {} }))

jest.setTimeout(180000)
let mongo: MongoMemoryServer, client: MongoClient, http: HttpServer, io: Server, browser: Browser
let base: string, token: string
const children: ChildProcess[] = [], contexts: BrowserContext[] = []
const viteErrors: Record<string, string> = {}
let tempDir: string
const originalEnv = { ...process.env }
const ports = { control: 17431, video: 17432 }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => Promise<boolean> | boolean, message: string, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await fn()) return; await pause(100) }
  throw new Error(`Timed out: ${message}`)
}
async function startVite(type: 'control' | 'video') {
  const root = resolve(__dirname, `../../../jozo-music-${type}`)
  const plugin = type === 'control' ? '@vitejs/plugin-react' : '@vitejs/plugin-react-swc'
  const pluginPath = require.resolve(plugin, { paths: [root] }).replace(/\.cjs$/, '.mjs')
  const config = resolve(tempDir, `${type}.mjs`)
  writeFileSync(config, `import react from ${JSON.stringify(pluginPath)}; export default {root:${JSON.stringify(root)},envDir:${JSON.stringify(tempDir)},server:{hmr:false},plugins:[react()],resolve:{alias:{'@':${JSON.stringify(resolve(root, 'src'))}}}}`)
  // Start the repository's installed Vite directly, without shell or inherited secrets.
  const child = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--config', config, '--host', '127.0.0.1', '--port', String(ports[type]), '--strictPort', '--mode', 'browser-e2e'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', VITE_ROOM_PIN: '1234', VITE_DEVICE_AUTHORIZATION: 'true', VITE_API_BASE_URL: base, VITE_SOCKET_URL: base }, stdio: ['ignore', 'pipe', 'pipe']
  })
  children.push(child)
  let failed = false
  let stderr = ''
  child.on('exit', () => { failed = true })
  child.stdout?.resume(); child.stderr?.on('data', chunk => { stderr += String(chunk); viteErrors[type] = stderr })
  await until(async () => { if (failed) throw new Error(`${type} Vite exited: ${stderr}`); try { return (await fetch(`http://127.0.0.1:${ports[type]}/`)).ok } catch { return false } }, `${type} Vite startup`)
}
async function post(path: string, body: object, auth = true) {
  const res = await fetch(`${base}/room-device-authorization/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path} returned ${res.status}`)
  return res.json() as Promise<any>
}
async function listing() {
  const res = await fetch(`${base}/room-device-authorization/admin`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`admin list returned ${res.status}`)
  return res.json() as Promise<any>
}
async function pageFor(type: 'control' | 'video', roomId: number): Promise<Page> {
  const context = await browser.newContext(); contexts.push(context)
  // No external network: block images, telemetry, video, and any accidental production URL.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' && [new URL(base).port, String(ports.control), String(ports.video)].includes(url.port) ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  let pageError = ''
  page.on('pageerror', error => { pageError = error.message })
  page.on('response', async response => { if (response.status() >= 500 && new URL(response.url()).hostname === '127.0.0.1') pageError = `${response.status()} ${new URL(response.url()).pathname}: ${(await response.text()).slice(0, 1200)}` })
  await page.goto(`http://127.0.0.1:${ports[type]}/?roomId=${roomId}`)
  try { await page.getByText(/chờ quản trị viên phê duyệt thiết bị/i).waitFor({ timeout: 10000 }) } catch { throw new Error(`${type} pending UI missing: ${(await page.locator('body').innerText()).slice(0, 500)}; page error: ${pageError}; vite: ${viteErrors[type]}`) }
  return page
}
async function connected(type: string, room: number, yes: boolean) {
  await until(() => [...io.sockets.sockets.values()].some(s => s.handshake.query.clientType === type && s.handshake.query.roomId === String(room)) === yes, `${type} room ${room} socket ${yes}`)
}
async function pending(type: string, roomId: number) {
  let item: any
  await until(async () => { item = (await listing()).pending.find((x: any) => x.clientType === type && x.roomId === roomId); return !!item }, 'pending admin list')
  return item.id as string
}
;(process.env.JOZO_BROWSER_E2E === '1' ? describe : describe.skip)('local browser integration (opt in)', () => {
beforeAll(async () => {
  tempDir = mkdtempSync(resolve(tmpdir(), 'jozo-browser-e2e-'))
  process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.HTTP_ROOM_DEVICE_AUTH = 'true'; process.env.SOCKET_DEVICE_AUTH = 'true'
  mongo = await MongoMemoryServer.create({ ...(process.env.MONGOMS_SYSTEM_BINARY ? { binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } } : {}), instance: { ip: '127.0.0.1' } })
  client = await MongoClient.connect(mongo.getUri()); testDb = client.db('browser_e2e')
  const admin = new ObjectId()
  await testDb.collection('users').insertOne({ _id: admin, role: UserRole.Admin })
  await testDb.collection('rooms').insertMany([{ roomId: 1, roomName: 'test one' }, { roomId: 2, roomName: 'test two' }])
  token = jwt.sign({ user_id: admin.toString(), token_type: TokenType.AccessToken }, process.env.JWT_SECRET)
  const app = express().use(cors()).use(express.json())
  app.use('/room-device-authorization', createRoomDeviceAuthorizationRouter(testDb))
  const music = express.Router(); music.param('roomId', createRoomHttpAuthorization(testDb))
  // Stub music state only; auth middleware is real. Other unrelated endpoints return 404.
  music.get('/:roomId/now-playing', (_req, res) => res.json({ data: null }))
  app.use('/room-music', music).use(defaultErrorHandler)
  http = createServer(app); io = new Server(http, { cors: { origin: '*' } })
  installManagementAuth(io); installDeviceAuth(io, testDb); RoomSocket(io)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  await startVite('control'); await startVite('video')
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => {
  for (const c of contexts) await c.close().catch(() => {})
  await browser?.close().catch(() => {})
  for (const child of children) child.kill('SIGTERM')
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))))
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  if (io) await new Promise<void>(resolve => io.close(() => resolve()))
  await client?.close(); await mongo?.stop()
  for (const key of ['JWT_SECRET', 'HTTP_ROOM_DEVICE_AUTH', 'SOCKET_DEVICE_AUTH', 'SOCKET_MANAGEMENT_AUTH']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]
  }
})

test.each(['control', 'video'] as const)('%s browser approval, refresh, replacement, isolation and revoke', async type => {
  const first = await pageFor(type, 1), firstId = await pending(type, 1)
  await connected(type, 1, false)
  await post('admin/approve', { roomId: 1, clientType: type, id: firstId, expectedActiveId: null })
  await connected(type, 1, true)
  const oldSocket = [...io.sockets.sockets.values()].find(s => s.handshake.query.clientType === type && s.handshake.query.roomId === '1')!.id
  await first.reload()
  await until(() => [...io.sockets.sockets.values()].some(s => s.id !== oldSocket && s.handshake.query.clientType === type && s.handshake.query.roomId === '1'), 'new socket after refresh')
  const other = await pageFor(type, 2), otherId = await pending(type, 2)
  await post('admin/approve', { roomId: 2, clientType: type, id: otherId, expectedActiveId: null })
  await connected(type, 2, true)
  // A second isolated browser in room 1 requests the same slot; no localStorage sharing.
  const replacement = await pageFor(type, 1), replacementId = await pending(type, 1)
  await post('admin/approve', { roomId: 1, clientType: type, id: replacementId, expectedActiveId: firstId })
  await first.getByText(/quyền thiết bị đã bị thu hồi/i).waitFor({ timeout: 20000 })
  await connected(type, 1, true); await connected(type, 2, true)
  await post('admin/revoke', { roomId: 1, clientType: type, expectedActiveId: replacementId })
  await replacement.getByText(/quyền thiết bị đã bị thu hồi/i).waitFor({ timeout: 20000 })
  await connected(type, 1, false); await connected(type, 2, true)
  await first.context().close(); await replacement.context().close(); await other.context().close()
})

test.each(['control', 'video'] as const)('%s expired request is shown in the browser and cannot be approved', async type => {
  const page = await pageFor(type, 1), id = await pending(type, 1)
  await testDb.collection('room_device_authorization_foundation_requests').updateOne({ _id: id } as never, { $set: { expiresAt: new Date(0) } })
  const res = await fetch(`${base}/room-device-authorization/admin/approve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ roomId: 1, clientType: type, id, expectedActiveId: null }) })
  expect(res.status).toBe(409)
  await page.getByText(/yêu cầu đã hết hạn/i).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /gửi yêu cầu mới/i }).waitFor()
  await connected(type, 1, false)
  await page.context().close()
})
})
