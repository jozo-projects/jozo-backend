import { FnbMenu, FnbMenuModel } from '~/models/schemas/FnBMenu.schema'
import databaseService from './database.service'
import { ObjectId, ClientSession } from 'mongodb'
import { RevenueCategory, UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { RevenueClassificationChangeContext } from '~/models/requests/RevenueClassification.request'
import revenueAuditService from './revenueAudit.service'

function isRevenueCategory(value: unknown): value is RevenueCategory {
  return typeof value === 'string' && Object.values(RevenueCategory).includes(value as RevenueCategory)
}

function assertExactCategories(menu: Partial<FnbMenu>): void {
  if (menu.revenueCategory !== undefined && !isRevenueCategory(menu.revenueCategory)) {
    throw new ErrorWithStatus({ message: 'Revenue category không hợp lệ', status: HTTP_STATUS_CODE.BAD_REQUEST })
  }
  if (menu.inventoryTracked !== undefined && typeof menu.inventoryTracked !== 'boolean') {
    throw new ErrorWithStatus({ message: 'inventoryTracked phải là boolean', status: HTTP_STATUS_CODE.BAD_REQUEST })
  }
  for (const variant of menu.variants ?? []) {
    if (variant.revenueCategory !== undefined && !isRevenueCategory(variant.revenueCategory)) {
      throw new ErrorWithStatus({
        message: 'Revenue category variant không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    if (variant.inventoryTracked !== undefined && typeof variant.inventoryTracked !== 'boolean') {
      throw new ErrorWithStatus({
        message: 'inventoryTracked variant phải là boolean',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
}

function assertNewSellableSkusClassified(menu: FnbMenu): void {
  const skus = menu.hasVariants ? (menu.variants ?? []).filter((variant) => variant.isAvailable !== false) : [menu]
  if (skus.some((sku) => !sku.revenueCategory || sku.inventoryTracked === undefined)) {
    throw new ErrorWithStatus({
      message: 'Mỗi sản phẩm đang bán phải có revenueCategory và inventoryTracked',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
}

class FnbMenuService {
  async createFnbMenu(menu: FnbMenu): Promise<FnbMenu> {
    assertExactCategories(menu)
    assertNewSellableSkusClassified(menu)
    const result = await databaseService.fnbMenu.insertOne(menu)
    menu._id = result.insertedId
    return menu
  }

  async getFnbMenuById(id: string): Promise<FnbMenu | null> {
    const menu = await databaseService.fnbMenu.findOne({ _id: new ObjectId(id) })
    if (!menu) return null

    // Ensure inventory exists before accessing its properties
    const inventory = menu.inventory || { quantity: 0, unit: 'piece', minStock: 0, maxStock: 0 }

    return new FnbMenuModel(
      menu.name,
      menu.price,
      menu.description,
      menu.image,
      menu.category,
      {
        quantity: inventory.quantity,
        unit: inventory.unit,
        minStock: inventory.minStock,
        maxStock: inventory.maxStock,
        lastUpdated: new Date() // Thêm thuộc tính này
      },
      menu.createdBy,
      menu.updatedBy,
      menu.hasVariants,
      menu.variants,
      menu._id,
      menu.createdAt,
      menu.updatedAt,
      menu.revenueCategory,
      menu.inventoryTracked
    )
  }

  async getAllFnbMenu(): Promise<FnbMenuModel[]> {
    const menus = await databaseService.fnbMenu.find({}).toArray()
    return menus.map((menu) => {
      const inventory = menu.inventory || {
        quantity: 0,
        unit: 'piece',
        minStock: 0,
        maxStock: 0,
        lastUpdated: new Date()
      }
      return new FnbMenuModel(
        menu.name,
        menu.price,
        menu.description,
        menu.image,
        menu.category,
        inventory,
        menu.createdBy,
        menu.updatedBy,
        menu.hasVariants,
        menu.variants,
        menu._id,
        menu.createdAt,
        menu.updatedAt,
        menu.revenueCategory,
        menu.inventoryTracked
      )
    })
  }

  async deleteFnbMenu(id: string): Promise<FnbMenu | null> {
    const menuToDelete = await this.getFnbMenuById(id)
    if (!menuToDelete) return null

    await databaseService.fnbMenu.deleteOne({ _id: new ObjectId(id) })
    return menuToDelete
  }

  async updateFnbMenu(
    id: string,
    menu: Partial<FnbMenu>,
    classificationContext?: RevenueClassificationChangeContext,
    session?: ClientSession
  ): Promise<FnbMenu | null> {
    assertExactCategories(menu)
    const hasCategoryCommand =
      menu.revenueCategory !== undefined ||
      (menu.variants ?? []).some((variant) => variant.revenueCategory !== undefined)
    if (hasCategoryCommand && session === undefined) {
      return databaseService.withTransaction((transactionSession) =>
        this.commitFnbMenuUpdate(id, menu, classificationContext, transactionSession)
      )
    }
    return this.commitFnbMenuUpdate(id, menu, classificationContext, session)
  }

  private async commitFnbMenuUpdate(
    id: string,
    menu: Partial<FnbMenu>,
    classificationContext: RevenueClassificationChangeContext | undefined,
    session?: ClientSession
  ): Promise<FnbMenu | null> {
    const menuToUpdate = await databaseService.fnbMenu.findOne(
      { _id: new ObjectId(id) },
      session ? { session } : undefined
    )
    if (!menuToUpdate) return null

    // Embedded legacy variants do not have a stable id. Preserve classification only for an unchanged name;
    // a new/renamed variant must explicitly classify itself so we cannot silently attach the wrong category.
    if (menu.variants) {
      const oldByName = new Map((menuToUpdate.variants ?? []).map((variant) => [variant.name, variant]))
      menu.variants = menu.variants.map((variant) => {
        const old = oldByName.get(variant.name)
        return {
          ...variant,
          revenueCategory: variant.revenueCategory ?? old?.revenueCategory,
          inventoryTracked: variant.inventoryTracked ?? old?.inventoryTracked
        }
      })
    }

    const resulting = { ...menuToUpdate, ...menu }
    const activeSellableSkus = resulting.hasVariants
      ? (resulting.variants ?? []).filter((variant) => variant.isAvailable !== false)
      : [resulting]
    if (activeSellableSkus.some((sku) => !sku.revenueCategory || sku.inventoryTracked === undefined)) {
      throw new ErrorWithStatus({
        message: 'Mỗi sản phẩm đang bán phải có revenueCategory và inventoryTracked',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const categoryChanges: Array<{ entityId: string; oldValue: RevenueCategory | null; newValue: RevenueCategory }> = []
    if (menu.revenueCategory !== undefined && menu.revenueCategory !== menuToUpdate.revenueCategory) {
      categoryChanges.push({
        entityId: id,
        oldValue: menuToUpdate.revenueCategory ?? null,
        newValue: menu.revenueCategory
      })
    }
    const oldVariantsByName = new Map((menuToUpdate.variants ?? []).map((variant) => [variant.name, variant]))
    for (const variant of menu.variants ?? []) {
      const oldCategory = oldVariantsByName.get(variant.name)?.revenueCategory
      if (variant.revenueCategory !== undefined && variant.revenueCategory !== oldCategory) {
        categoryChanges.push({
          entityId: `${id}:variant:${variant.name}`,
          oldValue: oldCategory ?? null,
          newValue: variant.revenueCategory
        })
      }
    }

    if (categoryChanges.length > 0) {
      if (!classificationContext?.actorId.trim() || !classificationContext.reason.trim()) {
        throw new ErrorWithStatus({
          message: 'Thay đổi revenueCategory yêu cầu Admin và lý do',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      if (classificationContext.actorRole !== UserRole.Admin) {
        throw new ErrorWithStatus({ message: 'Forbidden', status: HTTP_STATUS_CODE.FORBIDDEN })
      }
    }

    const { _id, ...updateData } = resulting
    if (updateData.inventory) {
      updateData.inventory = { ...updateData.inventory, lastUpdated: new Date() }
    }
    updateData.updatedAt = new Date()

    const write = async (transactionSession?: ClientSession) => {
      const options = transactionSession ? { session: transactionSession } : undefined
      await databaseService.fnbMenu.updateOne({ _id: new ObjectId(id) }, { $set: updateData }, options)
      for (const change of categoryChanges) {
        await revenueAuditService.recordProductCategoryChange({
          ...change,
          reason: classificationContext!.reason.trim(),
          changedBy: classificationContext!.actorId.trim(),
          changedAt: new Date(),
          session: transactionSession
        })
      }
    }
    if (categoryChanges.length > 0 && !session) await databaseService.withTransaction(write)
    else await write(session)

    return { _id: new ObjectId(id), ...updateData }
  }
}

const fnbMenuService = new FnbMenuService()
export default fnbMenuService
