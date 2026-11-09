import express from 'express'
import request from 'supertest'
import { ObjectId } from 'mongodb'

const roomA = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa')
const roomB = new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb')
const scheduleA = '111111111111111111111111'
const scheduleB = '222222222222222222222222'
const hit = jest.fn((_req: any, res: any) => res.sendStatus(204))
const verify = jest.fn(async (id: string, scope: string, proof: string) => scope === 'control' && proof === `control:${id}`)
const getUser = jest.fn(async (id: string) => id === 'staff' ? { role: 'staff' } : id === 'admin' ? { role: 'admin' } : { role: 'client' })

jest.mock('~/services/roomDeviceAuthorization.foundation', () => ({ RoomDeviceAuthorizationFoundation: jest.fn().mockImplementation(() => ({ verify })) }))
jest.mock('~/utils/jwt', () => ({ verifyToken: async (token: string) => { if (!['staff', 'admin', 'client', 'refresh'].includes(token)) throw Error(); return { token_type: token === 'refresh' ? 1 : 0, user_id: token } } }))
jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: getUser } }))
jest.mock('~/services/database.service', () => ({ __esModule: true, default: {
  roomDeviceAuthorizationStore: { collection: () => ({}) },
  rooms: { findOne: async (q: any) => q.roomId === 1 ? { _id: roomA } : q.roomId === 2 ? { _id: roomB } : q._id?.equals(roomA) ? { _id: roomA } : q._id?.equals(roomB) ? { _id: roomB } : null },
  roomSchedule: { findOne: async (q: any) => q._id.toString() === scheduleA ? { roomId: roomA } : q._id.toString() === scheduleB ? { roomId: roomB } : null }
} }))
jest.mock('~/controllers/roomScheduleFnb.controller', () => ({ getClientFnbOrderByRoomSchedule: hit, submitClientCart: hit }))
jest.mock('~/controllers/gift.controller', () => ({ claimGiftForSchedule: hit, claimSpecificGiftForSchedule: hit, getGiftForRoom: hit, listGifts: hit, createGift: hit, deleteGift: hit, getGiftById: hit, updateGift: hit }))
jest.mock('~/middlewares/auth.middleware', () => ({ protect: () => (_req: any, _res: any, next: any) => next() }))
import fnb from './clientFnb.routes'
import gifts from './gift.routes'
const app = express().use(express.json()).use('/client/fnb', fnb).use('/gifts', gifts)
afterEach(() => { delete process.env.HTTP_ROOM_DEVICE_AUTH; hit.mockClear(); verify.mockClear() })
const paths = [ ['get', '/client/fnb/orders/room/1'], ['post', '/client/fnb/orders/room/1/submit-cart'], ['get', '/gifts/room/1'], ['post', '/gifts/claim'], ['post', '/gifts/claim/by-id'] ] as const
const body = { scheduleId: scheduleA, giftId: '333333333333333333333333', roomId: 1 }
test('opt-in enforces room control on actual routes before handlers', async () => {
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  for (const [method, path] of paths) {
    expect((await request(app)[method](path).send(body)).status).toBe(401)
    expect((await request(app)[method](path).set('X-Jozo-Device-Proof', `control:${roomB}`).send(body)).status).toBe(401)
    expect((await request(app)[method](path).set('X-Jozo-Device-Proof', `video:${roomA}`).send(body)).status).toBe(401)
    expect((await request(app)[method](path).set('Authorization', 'Bearer invalid').send(body)).status).toBe(401)
    expect((await request(app)[method](path).set('X-Jozo-Device-Proof', `control:${roomA}`).send(body)).status).toBe(204)
  }
  expect(hit).toHaveBeenCalledTimes(paths.length)
})
test('schedule room is authoritative, unknown rooms fail and public remains open', async () => {
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  expect((await request(app).post('/gifts/claim').set('X-Jozo-Device-Proof', `control:${roomA}`).send({ ...body, scheduleId: scheduleB })).status).toBe(401)
  expect((await request(app).post('/gifts/claim').set('X-Jozo-Device-Proof', `control:${roomA}`).send({ ...body, scheduleId: '444444444444444444444444' })).status).toBe(401)
  expect((await request(app).get('/gifts/room/9').set('X-Jozo-Device-Proof', `control:${roomA}`)).status).toBe(401)
  expect((await request(app).get('/gifts/public')).status).toBe(204)
  expect(hit).toHaveBeenCalledTimes(1)
})
test('flag off preserves legacy access', async () => {
  for (const [method, path] of paths) expect((await request(app)[method](path).send(body)).status).toBe(204)
})
test('verified staff and admin may access known targets, clients and refresh tokens cannot', async () => {
  process.env.HTTP_ROOM_DEVICE_AUTH = 'true'
  for (const [method, path] of paths) {
    for (const token of ['staff', 'admin']) expect((await request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body)).status).toBe(204)
    for (const token of ['client', 'refresh']) expect((await request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body)).status).toBe(401)
  }
  expect((await request(app).get('/gifts/room/9').set('Authorization', 'Bearer staff')).status).toBe(401)
  expect(hit).toHaveBeenCalledTimes(paths.length * 2)
})
