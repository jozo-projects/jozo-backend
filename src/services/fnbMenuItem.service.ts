import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import databaseService from './database.service'
import { ObjectId, Collection, ClientSession } from 'mongodb'
import { FnBCategory, RevenueCategory, UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_MENU_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import type { FNBOrder } from '~/models/schemas/FNB.schema'
import { aggregateQuantitiesByItemId } from '~/utils/fnbOrderLines'
import revenueAuditService from './revenueAudit.service'
import { RevenueClassificationChangeContext } from '~/models/requests/RevenueClassification.request'

const COLLECTION_NAME = 'fnb_menu_item'

const ROOT_PARENT_ID_FILTER = {
  $or: [{ parentId: null }, { parentId: '' }]
}

export const ACTIVE_MENU_ITEM_FILTER = { isActive: { $ne: false } }

export function isMenuItemActive(item: FnBMenuItem): boolean {
  return item.isActive !== false
}

function isRevenueCategory(value: unknown): value is RevenueCategory {
  return typeof value === 'string' && Object.values(RevenueCategory).includes(value as RevenueCategory)
}

function assertValidClassification(item: Partial<FnBMenuItem>, requireForSellable = false): void {
  if (item.revenueCategory !== undefined && !isRevenueCategory(item.revenueCategory)) {
    throw new ErrorWithStatus({ message: 'Revenue category không hợp lệ', status: HTTP_STATUS_CODE.BAD_REQUEST })
  }
  if (item.inventoryTracked !== undefined && typeof item.inventoryTracked !== 'boolean') {
    throw new ErrorWithStatus({ message: 'inventoryTracked phải là boolean', status: HTTP_STATUS_CODE.BAD_REQUEST })
  }
  const isActiveSellable = requireForSellable && item.hasVariant !== true && item.isActive !== false
  if (isActiveSellable && (!item.revenueCategory || item.inventoryTracked === undefined)) {
    throw new ErrorWithStatus({
      message: 'Sản phẩm đang bán phải có revenueCategory và inventoryTracked',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
}

function hasClassificationReason(context?: RevenueClassificationChangeContext): boolean {
  return Boolean(context?.reason.trim() && context?.actorId.trim())
}

const CLASSIFICATION_UPDATE_KEYS = new Set(['revenueCategory', 'inventoryTracked'])

function hasOperationalUpdate(data: Partial<FnBMenuItem>): boolean {
  return Object.keys(data).some(
    (key) => !CLASSIFICATION_UPDATE_KEYS.has(key) && data[key as keyof FnBMenuItem] !== undefined
  )
}

/**
 * Form edits (quantity, name, image) often echo revenueCategory, including a default
 * that differs from the stored value. Without a reason, ignore that echo so stock
 * updates are not blocked. A classification-only payload still requires Admin + reason.
 */
function prepareClassificationUpdate(
  data: Partial<FnBMenuItem>,
  current: FnBMenuItem,
  classificationContext?: RevenueClassificationChangeContext
): { data: Partial<FnBMenuItem>; categoryChanged: boolean } {
  const next = { ...data }
  const categoryChanged = next.revenueCategory !== undefined && next.revenueCategory !== current.revenueCategory

  if (categoryChanged && !hasClassificationReason(classificationContext)) {
    if (current.revenueCategory == null || hasOperationalUpdate(next)) {
      delete next.revenueCategory
    } else {
      throw new ErrorWithStatus({
        message: 'Thay đổi revenueCategory yêu cầu Admin và lý do',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  if (
    categoryChanged &&
    hasClassificationReason(classificationContext) &&
    classificationContext?.actorRole !== UserRole.Admin
  ) {
    throw new ErrorWithStatus({ message: 'Forbidden', status: HTTP_STATUS_CODE.FORBIDDEN })
  }

  if (
    next.inventoryTracked !== undefined &&
    current.inventoryTracked === undefined &&
    !hasClassificationReason(classificationContext)
  ) {
    delete next.inventoryTracked
  }

  return {
    data: next,
    categoryChanged: Boolean(next.revenueCategory !== undefined && next.revenueCategory !== current.revenueCategory)
  }
}

const EXTRA_MENU_ITEM_FIELDS = ['quantity', 'existingImage'] as const

export interface DeleteMenuItemResult {
  item: FnBMenuItem
  deletedVariantIds: string[]
}

export interface MenuItemCleanupSummaryItem {
  _id: string
  name: string
  parentId?: string | null
  fields?: string[]
}

export interface MenuItemCleanupResult {
  dryRun: boolean
  deletedOrphans: MenuItemCleanupSummaryItem[]
  normalizedParentIds: MenuItemCleanupSummaryItem[]
  removedExtraFields: MenuItemCleanupSummaryItem[]
}

class FnBMenuItemService {
  private get collection(): Collection<FnBMenuItem> {
    return databaseService.getCollection<FnBMenuItem>(COLLECTION_NAME)
  }

  async createMenuItem(item: FnBMenuItem, session?: ClientSession): Promise<FnBMenuItem> {
    const isActiveSellable = item.hasVariant !== true && item.isActive !== false
    if (isActiveSellable) {
      item.revenueCategory = item.revenueCategory ?? RevenueCategory.FNB_RETAIL
      item.inventoryTracked = item.inventoryTracked ?? true
    }
    assertValidClassification(item, true)
    const result = session ? await this.collection.insertOne(item, { session }) : await this.collection.insertOne(item)
    item._id = result.insertedId
    return item
  }

  async getMenuItemById(id: string, session?: ClientSession): Promise<FnBMenuItem | null> {
    const item = session
      ? await this.collection.findOne({ _id: new ObjectId(id) }, { session })
      : await this.collection.findOne({ _id: new ObjectId(id) })
    return item || null
  }

  async getAllMenuItems(): Promise<FnBMenuItem[]> {
    return await this.collection.find({}).toArray()
  }

  async getActiveMenuItems(): Promise<FnBMenuItem[]> {
    return await this.collection.find(ACTIVE_MENU_ITEM_FILTER).toArray()
  }

  async getRootMenuItems(): Promise<FnBMenuItem[]> {
    return await this.collection.find(ROOT_PARENT_ID_FILTER).toArray()
  }

  async getActiveRootMenuItems(): Promise<FnBMenuItem[]> {
    return await this.collection.find({ ...ROOT_PARENT_ID_FILTER, ...ACTIVE_MENU_ITEM_FILTER }).toArray()
  }

  async updateMenuItem(
    id: string,
    data: Partial<FnBMenuItem>,
    classificationContext?: RevenueClassificationChangeContext,
    session?: ClientSession
  ): Promise<FnBMenuItem | null> {
    assertValidClassification(data)
    if (data.revenueCategory !== undefined && session === undefined) {
      return databaseService.withTransaction((transactionSession) =>
        this.commitMenuItemUpdate(id, data, classificationContext, transactionSession)
      )
    }
    return this.commitMenuItemUpdate(id, data, classificationContext, session)
  }

  private async commitMenuItemUpdate(
    id: string,
    data: Partial<FnBMenuItem>,
    classificationContext: RevenueClassificationChangeContext | undefined,
    session?: ClientSession
  ): Promise<FnBMenuItem | null> {
    const current = await this.getMenuItemById(id, session)
    if (!current) return null

    const prepared = prepareClassificationUpdate(data, current, classificationContext)
    data = prepared.data
    const categoryChanged = prepared.categoryChanged

    // Existing catalog rows may predate classification. Checkout already defaults
    // unclassified F&B to FNB_RETAIL, so ordinary edits must not require these fields.
    assertValidClassification(data)
    const write = async (transactionSession?: ClientSession) => {
      if (transactionSession) {
        await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: data }, { session: transactionSession })
      } else {
        await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: data })
      }

      if (categoryChanged) {
        await revenueAuditService.recordProductCategoryChange({
          entityId: id,
          oldValue: current.revenueCategory ?? null,
          newValue: data.revenueCategory!,
          reason: classificationContext!.reason.trim(),
          changedBy: classificationContext!.actorId.trim(),
          changedAt: new Date(),
          session: transactionSession
        })
      }
    }

    if (categoryChanged && !session) await databaseService.withTransaction(write)
    else await write(session)
    return this.collection.findOne({ _id: new ObjectId(id) }, session ? { session } : undefined)
  }

  async deleteMenuItem(id: string, session?: ClientSession): Promise<DeleteMenuItemResult | null> {
    const item = await this.getMenuItemById(id, session)
    if (!item) return null

    const variants = await this.getVariantsByParentId(id, session)
    const deletedVariantIds = variants.map((variant) => variant._id!.toString())

    if (deletedVariantIds.length > 0) {
      await this.collection.deleteMany({ parentId: id }, session ? { session } : undefined)
    }

    await this.collection.deleteOne({ _id: new ObjectId(id) }, session ? { session } : undefined)

    return { item, deletedVariantIds }
  }

  async getVariantsByParentId(parentId: string, session?: ClientSession): Promise<FnBMenuItem[]> {
    const variants = await this.collection.find({ parentId: parentId }, session ? { session } : undefined).toArray()

    return variants
  }

  async getActiveVariantsByParentId(parentId: string): Promise<FnBMenuItem[]> {
    const parent = await this.getMenuItemById(parentId)
    if (!parent || !isMenuItemActive(parent)) return []

    return await this.collection.find({ parentId, ...ACTIVE_MENU_ITEM_FILTER }).toArray()
  }

  async getVariantByNameAndParentId(
    name: string,
    parentId: string,
    session?: ClientSession
  ): Promise<FnBMenuItem | null> {
    const variant = await this.collection.findOne({ name: name, parentId: parentId }, session ? { session } : undefined)
    return variant || null
  }

  async getMenuItemsByCategory(category: FnBCategory): Promise<FnBMenuItem[]> {
    return await this.collection.find({ category, ...ROOT_PARENT_ID_FILTER }).toArray()
  }

  async getActiveMenuItemsByCategory(category: FnBCategory): Promise<FnBMenuItem[]> {
    return await this.collection.find({ category, ...ROOT_PARENT_ID_FILTER, ...ACTIVE_MENU_ITEM_FILTER }).toArray()
  }

  async isMenuItemEffectivelyActive(item: FnBMenuItem): Promise<boolean> {
    if (!isMenuItemActive(item)) return false
    if (!item.parentId) return true
    const parent = await this.getMenuItemById(item.parentId)
    return Boolean(parent && isMenuItemActive(parent))
  }

  async resolveMenuItemDisplayName(item: FnBMenuItem): Promise<string> {
    if (!item.parentId) return item.name
    const parent = await this.getMenuItemById(item.parentId)
    return parent ? `${parent.name} - ${item.name}` : item.name
  }

  async assertMenuItemIsOrderable(itemId: string): Promise<void> {
    const menuItem = await this.getMenuItemById(itemId)
    if (!menuItem) {
      const legacy = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
      if (legacy) return
      return
    }

    if (!(await this.isMenuItemEffectivelyActive(menuItem))) {
      const name = await this.resolveMenuItemDisplayName(menuItem)
      throw new ErrorWithStatus({
        message: FNB_MENU_MESSAGES.MENU_ITEM_INACTIVE.replace('{name}', name),
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  async assertActiveMenuItemsForOrderDelta(before: FNBOrder, after: FNBOrder): Promise<void> {
    const beforeQty = aggregateQuantitiesByItemId(before)
    const afterQty = aggregateQuantitiesByItemId(after)

    for (const [itemId, newQuantity] of Object.entries(afterQty)) {
      const oldQuantity = beforeQty[itemId] ?? 0
      if (newQuantity > oldQuantity) {
        await this.assertMenuItemIsOrderable(itemId)
      }
    }
  }

  /**
   * Item orderable còn hàng: leaf/variant (không list parent hasVariant),
   * active (+ parent active), inventory.quantity > 0.
   */
  async getSelectableStockItems(options?: { category?: FnBCategory }): Promise<
    Array<{
      itemId: string
      name: string
      category: FnBCategory
      quantity: number
      price: number
      image?: string
      parentId: string | null
    }>
  > {
    const filter: Record<string, unknown> = {
      ...ACTIVE_MENU_ITEM_FILTER,
      hasVariant: { $ne: true },
      'inventory.quantity': { $gt: 0 }
    }
    if (options?.category) {
      filter.category = options.category
    }

    const items = await this.collection.find(filter).toArray()
    const parentIds = [
      ...new Set(items.map((item) => item.parentId).filter((id): id is string => Boolean(id && id !== '')))
    ]
    const parents =
      parentIds.length > 0
        ? await this.collection.find({ _id: { $in: parentIds.map((id) => new ObjectId(id)) } }).toArray()
        : []
    const parentById = new Map(parents.map((p) => [p._id!.toString(), p]))

    const result: Array<{
      itemId: string
      name: string
      category: FnBCategory
      quantity: number
      price: number
      image?: string
      parentId: string | null
    }> = []

    for (const item of items) {
      if (!item._id) continue
      const parentId = item.parentId && item.parentId !== '' ? item.parentId : null
      if (parentId) {
        const parent = parentById.get(parentId)
        if (!parent || !isMenuItemActive(parent)) continue
      }

      const displayName = parentId
        ? `${parentById.get(parentId)?.name ?? ''} - ${item.name}`.replace(/^ - /, '')
        : item.name

      result.push({
        itemId: item._id.toString(),
        name: displayName,
        category: item.category,
        quantity: item.inventory?.quantity ?? 0,
        price: item.price,
        image: item.image,
        parentId
      })
    }

    return result
  }

  /** Trừ kho atomic; throw nếu không đủ stock / không tồn tại. */
  async deductStock(itemId: string, quantity: number): Promise<FnBMenuItem> {
    if (!ObjectId.isValid(itemId) || quantity <= 0) {
      throw new ErrorWithStatus({
        message: 'itemId hoặc quantity không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(itemId),
        ...ACTIVE_MENU_ITEM_FILTER,
        hasVariant: { $ne: true },
        'inventory.quantity': { $gte: quantity }
      },
      {
        $inc: { 'inventory.quantity': -quantity },
        $set: { 'inventory.lastUpdated': new Date(), updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    )

    const updated = result as FnBMenuItem | null
    if (!updated?._id) {
      const existing = await this.getMenuItemById(itemId)
      if (!existing) {
        throw new ErrorWithStatus({
          message: `Không tìm thấy món ${itemId}`,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }
      throw new ErrorWithStatus({
        message: `Không đủ tồn kho cho món ${existing.name}. Available: ${existing.inventory?.quantity ?? 0}, Required: ${quantity}`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return updated
  }

  async restoreStock(itemId: string, quantity: number): Promise<void> {
    if (!ObjectId.isValid(itemId) || quantity <= 0) return
    await this.collection.updateOne(
      { _id: new ObjectId(itemId) },
      {
        $inc: { 'inventory.quantity': quantity },
        $set: { 'inventory.lastUpdated': new Date(), updatedAt: new Date() }
      }
    )
  }

  async cleanupMenuItems(dryRun = true): Promise<MenuItemCleanupResult> {
    const allItems = await this.getAllMenuItems()
    const existingIds = new Set(allItems.map((item) => item._id!.toString()))

    const orphans = allItems.filter((item) => {
      const parentId = item.parentId
      if (parentId == null || parentId === '') return false
      return !existingIds.has(parentId)
    })

    const needNormalizeParentId = allItems.filter((item) => item.parentId === '')

    const needRemoveExtraFields: Array<{ item: FnBMenuItem; fields: string[] }> = []

    for (const item of allItems) {
      const fields = EXTRA_MENU_ITEM_FIELDS.filter((field) => field in (item as unknown as Record<string, unknown>))
      if (fields.length > 0) {
        needRemoveExtraFields.push({ item, fields: [...fields] })
      }
    }

    if (!dryRun) {
      if (orphans.length > 0) {
        await this.collection.deleteMany({
          _id: { $in: orphans.map((item) => item._id!) }
        })
      }

      for (const item of needNormalizeParentId) {
        await this.collection.updateOne({ _id: item._id }, { $set: { parentId: null, updatedAt: new Date() } })
      }

      for (const { item, fields } of needRemoveExtraFields) {
        const unsetFields = Object.fromEntries(fields.map((field) => [field, ''])) as Record<string, ''>
        await this.collection.updateOne({ _id: item._id }, { $unset: unsetFields })
      }
    }

    return {
      dryRun,
      deletedOrphans: orphans.map((item) => ({
        _id: item._id!.toString(),
        name: item.name,
        parentId: item.parentId
      })),
      normalizedParentIds: needNormalizeParentId.map((item) => ({
        _id: item._id!.toString(),
        name: item.name
      })),
      removedExtraFields: needRemoveExtraFields.map(({ item, fields }) => ({
        _id: item._id!.toString(),
        name: item.name,
        fields
      }))
    }
  }
}

const fnBMenuItemService = new FnBMenuItemService()
export default fnBMenuItemService
