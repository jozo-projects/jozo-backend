import express from 'express'
import request from 'supertest'

jest.mock('~/services/database.service', () => ({ __esModule: true, default: { roomDeviceAuthorizationStore: { collection: (name: string) => ({ findOne: async (q: any) => name === 'rooms' && q.roomId === 1 ? { _id: 'a' } : null }) } } }))
jest.mock('~/controllers/roomMusic.controller', () => new Proxy({}, { get: () => (_req: any, res: any) => res.sendStatus(204) }))
jest.mock('~/controllers/supportRequest.controller', () => new Proxy({}, { get: () => (_req: any, res: any) => res.sendStatus(204) }))
jest.mock('~/middlewares/auth.middleware', () => ({ protect: () => (_req: any, res: any) => res.sendStatus(401) }))
jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: jest.fn() } }))
jest.mock('~/middlewares/rateLimiter.middleware', () => ({ updateLimiter: () => (_req: any, _res: any, next: any) => next() }))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicServices: { getNowPlaying: async () => null } }))
jest.mock('~/services/video.service', () => ({ getMediaUrls: async () => ({}) }))
jest.mock('./musicCategory.routes', () => ({ __esModule: true, default: express.Router() }))
import router from './roomMusic.routes'
const app = express().use(router)
afterEach(() => { delete process.env.HTTP_ROOM_DEVICE_AUTH })
test('real room routes reject anonymous requests before controllers when enabled', async () => {
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  for (const [method, path] of [ ['get','/1'], ['get','/1/now-playing'], ['get','/1/bill'], ['get','/1/support-requests/active'], ['post','/1/support-requests'], ['post','/1/queue'], ['delete','/1/queue/0'], ['put','/1/queue'], ['post','/1/playback/play'], ['post','/1/request-end'], ['post','/1/add-songs'], ['get','/1/song-info/abc'] ] as const) {
    expect((await request(app)[method](path)).status).toBe(401)
  }
})
test('global catalog and internal callback are not mistaken for room endpoints', async () => {
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  expect((await request(app).get('/songs-collection')).status).toBe(204)
  expect((await request(app).get('/search-songs/local')).status).toBe(204)
  expect((await request(app).post('/internal/media-callback')).status).toBe(204)
  expect((await request(app).post('/1/move-queue')).status).toBe(401)
})
test('flag off retains legacy room access', async () => { expect((await request(app).get('/1')).status).toBe(204) })
