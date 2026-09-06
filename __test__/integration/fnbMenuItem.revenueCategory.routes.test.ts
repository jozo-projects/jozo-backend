import express from 'express'
import request from 'supertest'
import { ObjectId } from 'mongodb'
import { RevenueCategory, UserRole } from '~/constants/enum'
import { defaultErrorHandler } from '~/middlewares/error.middleware'
import fnbMenuItemRouter from '~/routes/fnbMenuItem.routes'
import fnBMenuItemService from '~/services/fnbMenuItem.service'
import databaseService from '~/services/database.service'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'

jest.mock('~/utils/jwt', () => ({ verifyToken: jest.fn() }))
jest.mock('~/services/cloudinary.service', () => ({
  uploadImageToCloudinary: jest.fn().mockResolvedValue({ url: 'image.jpg', publicId: 'image-id' })
}))

const app = express()
app.use(express.json())
app.use('/fnb-menu-items', fnbMenuItemRouter)
app.use(defaultErrorHandler)

const authenticateAs = (role: UserRole) => {
  jest.mocked(verifyToken).mockResolvedValue({ user_id: `${role}-1` } as never)
  jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role } as never)
}

describe('F&B product revenue classification routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('prevents Staff from changing product revenue category', async () => {
    authenticateAs(UserRole.Staff)
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem')

    const response = await request(app)
      .put(`/fnb-menu-items/${new ObjectId()}`)
      .set('Authorization', 'Bearer valid')
      .send({ revenueCategory: RevenueCategory.FNB_PREPARED, reason: 'Changed preparation' })

    expect(response.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects non-canonical category values before updating', async () => {
    authenticateAs(UserRole.Admin)
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem')

    const response = await request(app)
      .put(`/fnb-menu-items/${new ObjectId()}`)
      .set('Authorization', 'Bearer valid')
      .send({ revenueCategory: 'fnb_retail', reason: 'Correction' })

    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('passes the authenticated admin and trimmed reason to category update', async () => {
    authenticateAs(UserRole.Admin)
    const id = new ObjectId().toString()
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem').mockResolvedValue({ _id: new ObjectId(id) } as never)

    const response = await request(app)
      .put(`/fnb-menu-items/${id}`)
      .set('Authorization', 'Bearer valid')
      .send({ revenueCategory: RevenueCategory.FNB_PREPARED, reason: '  Prepared on site  ' })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ revenueCategory: RevenueCategory.FNB_PREPARED }),
      { actorId: 'admin-1', actorRole: UserRole.Admin, reason: 'Prepared on site' },
      undefined
    )
    expect(update.mock.calls[0][1]).not.toHaveProperty('reason')
  })

  it.each([
    ['revenueCategory', null],
    ['revenueCategory', ''],
    ['inventoryTracked', null],
    ['inventoryTracked', '']
  ])('rejects an explicitly empty %s before updating', async (field, value) => {
    authenticateAs(UserRole.Admin)
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem')
    const response = await request(app)
      .put(`/fnb-menu-items/${new ObjectId()}`)
      .set('Authorization', 'Bearer valid')
      .send({ [field]: value, reason: 'Correction' })
    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('pre-parses malformed variants without mutating the parent', async () => {
    authenticateAs(UserRole.Admin)
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem').mockResolvedValue({ _id: new ObjectId() } as never)
    const response = await request(app)
      .put(`/fnb-menu-items/${new ObjectId()}`)
      .set('Authorization', 'Bearer valid')
      .send({ name: 'Must not persist', variants: { name: 'not-an-array' } })
    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('uses one Mongo transaction/session for a parent plus new-variant request', async () => {
    authenticateAs(UserRole.Admin)
    const id = new ObjectId().toString()
    const session = { id: 'request-session' }
    const transaction = jest.spyOn(databaseService, 'withTransaction').mockImplementation(async (work: any) => work(session))
    jest.spyOn(fnBMenuItemService, 'getVariantsByParentId').mockResolvedValue([])
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem').mockResolvedValue({ _id: new ObjectId(id) } as never)
    const create = jest.spyOn(fnBMenuItemService, 'createMenuItem').mockImplementation(async (item) => item)

    const response = await request(app)
      .put(`/fnb-menu-items/${id}`)
      .set('Authorization', 'Bearer valid')
      .send({
        name: 'Coffee',
        variants: [{
          name: 'Large', price: 30000,
          revenueCategory: RevenueCategory.FNB_PREPARED,
          inventoryTracked: true
        }],
        reason: 'Add size'
      })

    expect(response.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][3]).toBe(session)
    expect(create.mock.calls[0][1]).toBe(session)
  })

  it('validates the complete parent-plus-variants create payload before the first insert', async () => {
    authenticateAs(UserRole.Admin)
    const create = jest.spyOn(fnBMenuItemService, 'createMenuItem').mockImplementation(async (item) => item)
    const transaction = jest.spyOn(databaseService, 'withTransaction')

    const response = await request(app)
      .post('/fnb-menu-items')
      .set('Authorization', 'Bearer valid')
      .send({
        name: 'Coffee',
        hasVariant: true,
        revenueCategory: RevenueCategory.FNB_PREPARED,
        inventoryTracked: true,
        variants: [
          { name: 'Small', price: 20000 },
          { name: 'Large', price: 30000, revenueCategory: null }
        ]
      })

    expect(response.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('creates a parent and every variant in one transaction with the same session', async () => {
    authenticateAs(UserRole.Admin)
    const session = { id: 'create-session' } as any
    const transaction = jest.spyOn(databaseService, 'withTransaction').mockImplementation(async (work: any) => work(session))
    const create = jest.spyOn(fnBMenuItemService, 'createMenuItem').mockImplementation(async (item) => {
      item._id = new ObjectId()
      return item
    })

    const response = await request(app)
      .post('/fnb-menu-items')
      .set('Authorization', 'Bearer valid')
      .send({
        name: 'Coffee',
        hasVariant: true,
        revenueCategory: RevenueCategory.FNB_PREPARED,
        inventoryTracked: true,
        variants: [{ name: 'Small', price: 20000 }, { name: 'Large', price: 30000 }]
      })

    expect(response.status).toBe(201)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(3)
    expect(create.mock.calls.every((call) => call[1] === session)).toBe(true)
  })

  it.each([
    ['revenueCategory', null],
    ['revenueCategory', ''],
    ['revenueCategory', 'not-a-category'],
    ['inventoryTracked', null],
    ['inventoryTracked', 'yes'],
    ['inventoryTracked', 1]
  ])('does not inherit the parent when a new variant explicitly supplies invalid %s=%p', async (field, value) => {
    authenticateAs(UserRole.Admin)
    const create = jest.spyOn(fnBMenuItemService, 'createMenuItem').mockImplementation(async (item) => item)

    const response = await request(app)
      .post('/fnb-menu-items')
      .set('Authorization', 'Bearer valid')
      .send({
        name: 'Coffee',
        hasVariant: true,
        revenueCategory: RevenueCategory.FNB_PREPARED,
        inventoryTracked: true,
        variants: [{ name: 'Large', price: 30000, [field]: value }]
      })

    expect(response.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes the decisive existing-variant snapshot inside the transaction using its session', async () => {
    authenticateAs(UserRole.Admin)
    const id = new ObjectId().toString()
    const session = { id: 'snapshot-session' } as any
    let transactionActive = false
    jest.spyOn(databaseService, 'withTransaction').mockImplementation(async (work: any) => {
      transactionActive = true
      try { return await work(session) } finally { transactionActive = false }
    })
    const getVariants = jest.spyOn(fnBMenuItemService, 'getVariantsByParentId').mockImplementation(async (_id, readSession) => {
      if (!transactionActive || readSession !== session) throw new Error('stale pre-transaction read')
      return []
    })
    jest.spyOn(fnBMenuItemService, 'updateMenuItem').mockResolvedValue({ _id: new ObjectId(id) } as never)
    jest.spyOn(fnBMenuItemService, 'createMenuItem').mockImplementation(async (item) => item)

    const response = await request(app)
      .put(`/fnb-menu-items/${id}`)
      .set('Authorization', 'Bearer valid')
      .send({
        variants: [{
          name: 'Large', price: 30000,
          revenueCategory: RevenueCategory.FNB_PREPARED,
          inventoryTracked: true
        }]
      })

    expect(response.status).toBe(200)
    expect(getVariants).toHaveBeenCalled()
    expect(getVariants.mock.calls.every((call) => call[1] === session)).toBe(true)
  })

  it('keeps ordinary Admin product updates valid without a reason', async () => {
    authenticateAs(UserRole.Admin)
    const id = new ObjectId().toString()
    const update = jest.spyOn(fnBMenuItemService, 'updateMenuItem').mockResolvedValue({ _id: new ObjectId(id) } as never)

    const response = await request(app)
      .put(`/fnb-menu-items/${id}`)
      .set('Authorization', 'Bearer valid')
      .send({ name: 'Updated name' })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(id, expect.objectContaining({ name: 'Updated name' }), undefined, undefined)
  })
})
