import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import databaseService from './database.service'
import { ObjectId, Collection } from 'mongodb'
import { FnBCategory } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_MENU_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import type { FNBOrder } from '~/models/schemas/FNB.schema'
import { aggregateQuantitiesByItemId } from '~/utils/fnbOrderLines'

const COLLECTION_NAME = 'fnb_menu_item'

const ROOT_PARENT_ID_FILTER = {
  $or: [{ parentId: null }, { parentId: '' }]
}

export const ACTIVE_MENU_ITEM_FILTER = { isActive: { $ne: false } }

export function isMenuItemActive(item: FnBMenuItem): boolean {
  return item.isActive !== false
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

  async createMenuItem(item: FnBMenuItem): Promise<FnBMenuItem> {
    const result = await this.collection.insertOne(item)
    item._id = result.insertedId
    return item
  }

  async getMenuItemById(id: string): Promise<FnBMenuItem | null> {
    const item = await this.collection.findOne({ _id: new ObjectId(id) })
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

  async updateMenuItem(id: string, data: Partial<FnBMenuItem>): Promise<FnBMenuItem | null> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: data })
    return this.getMenuItemById(id)
  }

  async deleteMenuItem(id: string): Promise<DeleteMenuItemResult | null> {
    const item = await this.getMenuItemById(id)
    if (!item) return null

    const variants = await this.getVariantsByParentId(id)
    const deletedVariantIds = variants.map((variant) => variant._id!.toString())

    if (deletedVariantIds.length > 0) {
      await this.collection.deleteMany({ parentId: id })
    }

    await this.collection.deleteOne({ _id: new ObjectId(id) })

    return { item, deletedVariantIds }
  }

  async getVariantsByParentId(parentId: string): Promise<FnBMenuItem[]> {
    const variants = await this.collection.find({ parentId: parentId }).toArray()

    return variants
  }

  async getActiveVariantsByParentId(parentId: string): Promise<FnBMenuItem[]> {
    const parent = await this.getMenuItemById(parentId)
    if (!parent || !isMenuItemActive(parent)) return []

    return await this.collection.find({ parentId, ...ACTIVE_MENU_ITEM_FILTER }).toArray()
  }

  async getVariantByNameAndParentId(name: string, parentId: string): Promise<FnBMenuItem | null> {
    const variant = await this.collection.findOne({ name: name, parentId: parentId })
    return variant || null
  }

  async getMenuItemsByCategory(category: FnBCategory): Promise<FnBMenuItem[]> {
    return await this.collection.find({ category, ...ROOT_PARENT_ID_FILTER }).toArray()
  }

  async getActiveMenuItemsByCategory(category: FnBCategory): Promise<FnBMenuItem[]> {
    return await this.collection
      .find({ category, ...ROOT_PARENT_ID_FILTER, ...ACTIVE_MENU_ITEM_FILTER })
      .toArray()
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
      const fields = EXTRA_MENU_ITEM_FIELDS.filter(
        (field) => field in (item as unknown as Record<string, unknown>)
      )
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
        await this.collection.updateOne(
          { _id: item._id },
          { $set: { parentId: null, updatedAt: new Date() } }
        )
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
