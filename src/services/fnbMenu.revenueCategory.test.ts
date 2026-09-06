import { ObjectId } from 'mongodb'
import { RevenueCategory, UserRole } from '~/constants/enum'
import databaseService from './database.service'
import fnbMenuService from './fnbMenu.service'
import revenueAuditService from './revenueAudit.service'
import { FnbMenu } from '~/models/schemas/FnBMenu.schema'

const id = new ObjectId()
const inventory = { quantity: 1, minStock: 0, maxStock: 10, lastUpdated: new Date() }
const base: FnbMenu = {
  _id: id,
  name: 'Coffee', price: 20000, description: '', image: '', category: 'drink',
  revenueCategory: RevenueCategory.FNB_PREPARED, inventoryTracked: true,
  hasVariants: false, inventory, createdAt: new Date()
}
const admin = { actorId: 'admin-1', actorRole: UserRole.Admin, reason: 'Menu restructure' }

describe('legacy fnb_menu resulting SKU classification', () => {
  const collection = { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() }

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(databaseService, 'fnbMenu', 'get').mockReturnValue(collection as never)
    jest.spyOn(databaseService, 'withTransaction').mockImplementation(async (work: any) => work({ id: 'session' }))
    jest.spyOn(revenueAuditService, 'recordProductCategoryChange').mockResolvedValue(undefined)
    collection.findOne.mockResolvedValue(base)
    collection.updateOne.mockResolvedValue({ matchedCount: 1 })
    collection.insertOne.mockResolvedValue({ insertedId: id })
  })

  it('allows inactive variants to be unclassified on create', async () => {
    const created = await fnbMenuService.createFnbMenu({
      ...base,
      hasVariants: true,
      variants: [{ name: 'Seasonal', price: 30000, isAvailable: false, inventory }],
      revenueCategory: undefined,
      inventoryTracked: undefined
    })

    expect(created.variants?.[0]).not.toHaveProperty('revenueCategory')
    expect(collection.insertOne).toHaveBeenCalledTimes(1)
  })

  it('rejects a hasVariants transition when an active resulting variant is unclassified', async () => {
    await expect(fnbMenuService.updateFnbMenu(id.toString(), {
      hasVariants: true,
      variants: [{ name: 'Large', price: 30000, isAvailable: true, inventory }]
    }, admin)).rejects.toMatchObject({ status: 400 })
    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('rejects a new active variant that omits its own classification', async () => {
    collection.findOne.mockResolvedValue({ ...base, hasVariants: true, variants: [{
      name: 'Small', price: 20000, isAvailable: true, inventory,
      revenueCategory: RevenueCategory.FNB_PREPARED, inventoryTracked: true
    }] })
    await expect(fnbMenuService.updateFnbMenu(id.toString(), { variants: [
      { name: 'Small', price: 20000, isAvailable: true, inventory },
      { name: 'Large', price: 30000, isAvailable: true, inventory }
    ] }, admin)).rejects.toMatchObject({ status: 400 })
    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous rename without explicit classification', async () => {
    collection.findOne.mockResolvedValue({ ...base, hasVariants: true, variants: [{
      name: 'Regular', price: 20000, isAvailable: true, inventory,
      revenueCategory: RevenueCategory.FNB_PREPARED, inventoryTracked: true
    }] })
    await expect(fnbMenuService.updateFnbMenu(id.toString(), { variants: [{
      name: 'Classic', price: 20000, isAvailable: true, inventory
    }] }, admin)).rejects.toMatchObject({ status: 400 })
    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('accepts a renamed variant with explicit classification and audits it as a first classification', async () => {
    collection.findOne.mockResolvedValue({ ...base, hasVariants: true, variants: [{
      name: 'Regular', price: 20000, isAvailable: true, inventory,
      revenueCategory: RevenueCategory.FNB_RETAIL, inventoryTracked: true
    }] })
    await fnbMenuService.updateFnbMenu(id.toString(), { variants: [{
      name: 'Classic', price: 20000, isAvailable: true, inventory,
      revenueCategory: RevenueCategory.FNB_PREPARED, inventoryTracked: true
    }] }, admin)
    expect(revenueAuditService.recordProductCategoryChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: `${id}:variant:Classic`, oldValue: null, session: { id: 'session' } })
    )
  })
})
