import { ObjectId } from 'mongodb'
import { RevenueCategory, FnBCategory, UserRole } from '~/constants/enum'
import databaseService from './database.service'
import fnBMenuItemService from './fnbMenuItem.service'
import revenueAuditService from './revenueAudit.service'
import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'

const itemId = new ObjectId()
const baseItem: FnBMenuItem = {
  _id: itemId,
  name: 'Coke',
  parentId: null,
  hasVariant: false,
  price: 20000,
  category: FnBCategory.DRINK,
  revenueCategory: RevenueCategory.FNB_RETAIL,
  inventoryTracked: true,
  inventory: { quantity: 10, lastUpdated: new Date('2026-09-06T00:00:00Z') },
  isActive: true,
  createdAt: new Date('2026-09-06T00:00:00Z'),
  updatedAt: new Date('2026-09-06T00:00:00Z')
}

describe('FnBMenuItem revenue classification', () => {
  const collection = {
    insertOne: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(databaseService, 'getCollection').mockReturnValue(collection as never)
    collection.findOne.mockResolvedValue(baseItem)
    collection.updateOne.mockResolvedValue({ matchedCount: 1 })
    collection.insertOne.mockResolvedValue({ insertedId: itemId })
    jest.spyOn(revenueAuditService, 'recordProductCategoryChange').mockResolvedValue(undefined)
    jest.spyOn(databaseService, 'withTransaction').mockImplementation(async (work: any) => work({ id: 'session' }))
  })

  it('rejects a non-canonical revenue category on create', async () => {
    await expect(
      fnBMenuItemService.createMenuItem({ ...baseItem, revenueCategory: 'fnb_retail' as RevenueCategory })
    ).rejects.toMatchObject({ status: 400 })
    expect(collection.insertOne).not.toHaveBeenCalled()
  })

  it('requires every new active sellable SKU to persist its own category', async () => {
    const unclassified = { ...baseItem, revenueCategory: undefined } as unknown as FnBMenuItem
    await expect(fnBMenuItemService.createMenuItem(unclassified)).rejects.toMatchObject({ status: 400 })
    expect(collection.insertOne).not.toHaveBeenCalled()
  })

  it('requires a non-empty reason and actor when the category changes', async () => {
    await expect(
      fnBMenuItemService.updateMenuItem(
        itemId.toString(),
        { revenueCategory: RevenueCategory.FNB_PREPARED },
        { actorId: 'admin-1', actorRole: UserRole.Admin, reason: '   ' }
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      fnBMenuItemService.updateMenuItem(itemId.toString(), { revenueCategory: RevenueCategory.FNB_PREPARED })
    ).rejects.toMatchObject({ status: 400 })
    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('updates classification and writes old/new/reason/actor audit data', async () => {
    const changedAt = new Date('2026-09-06T12:00:00Z')
    jest.useFakeTimers().setSystemTime(changedAt)
    try {
      await fnBMenuItemService.updateMenuItem(
        itemId.toString(),
        { revenueCategory: RevenueCategory.FNB_PREPARED },
        { actorId: 'admin-1', actorRole: UserRole.Admin, reason: 'Prepared in store' }
      )

      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: itemId },
        { $set: { revenueCategory: RevenueCategory.FNB_PREPARED } },
        { session: { id: 'session' } }
      )
      expect(revenueAuditService.recordProductCategoryChange).toHaveBeenCalledWith({
        entityId: itemId.toString(),
        oldValue: RevenueCategory.FNB_RETAIL,
        newValue: RevenueCategory.FNB_PREPARED,
        reason: 'Prepared in store',
        changedBy: 'admin-1',
        changedAt,
        session: { id: 'session' }
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps ordinary updates backward compatible without a reason or audit', async () => {
    collection.findOne.mockResolvedValue({
      ...baseItem,
      revenueCategory: undefined,
      inventoryTracked: undefined
    })
    await fnBMenuItemService.updateMenuItem(itemId.toString(), { name: 'Coke Zero' })

    expect(collection.updateOne).toHaveBeenCalledWith({ _id: itemId }, { $set: { name: 'Coke Zero' } })
    expect(revenueAuditService.recordProductCategoryChange).not.toHaveBeenCalled()
  })

  it('does not require a reason when the supplied category is unchanged', async () => {
    await fnBMenuItemService.updateMenuItem(itemId.toString(), {
      name: 'Coke Zero',
      revenueCategory: RevenueCategory.FNB_RETAIL
    })
    expect(collection.updateOne).toHaveBeenCalled()
    expect(revenueAuditService.recordProductCategoryChange).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary actor id without an explicit Admin command context', async () => {
    await expect(fnBMenuItemService.updateMenuItem(
      itemId.toString(),
      { revenueCategory: RevenueCategory.FNB_PREPARED },
      { actorId: 'staff-1', actorRole: UserRole.Staff, reason: 'Not authorized' }
    )).rejects.toMatchObject({ status: 403 })
    expect(collection.updateOne).not.toHaveBeenCalled()
  })

  it('rolls the product mutation back when audit insertion fails', async () => {
    let persisted = { ...baseItem }
    collection.findOne.mockImplementation(async () => persisted)
    collection.updateOne.mockImplementation(async (_filter, update) => {
      persisted = { ...persisted, ...update.$set }
      return { matchedCount: 1 }
    })
    jest.mocked(revenueAuditService.recordProductCategoryChange).mockRejectedValue(new Error('audit unavailable'))
    jest.mocked(databaseService.withTransaction).mockImplementation(async (work: any) => {
      const before = persisted
      try { return await work({ id: 'transaction-session' }) }
      catch (error) { persisted = before; throw error }
    })

    await expect(fnBMenuItemService.updateMenuItem(
      itemId.toString(),
      { revenueCategory: RevenueCategory.FNB_PREPARED },
      { actorId: 'admin-1', actorRole: UserRole.Admin, reason: 'Prepared in store' }
    )).rejects.toThrow('audit unavailable')
    expect(persisted.revenueCategory).toBe(RevenueCategory.FNB_RETAIL)
  })

  it('records oldValue null when a product is classified for the first time', async () => {
    collection.findOne.mockResolvedValue({ ...baseItem, revenueCategory: undefined, isActive: false })
    await fnBMenuItemService.updateMenuItem(
      itemId.toString(),
      { revenueCategory: RevenueCategory.FNB_PREPARED },
      { actorId: 'admin-1', actorRole: UserRole.Admin, reason: 'Initial classification' }
    )
    expect(revenueAuditService.recordProductCategoryChange).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: null })
    )
  })
})
