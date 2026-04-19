import { NextFunction, Request, Response } from 'express'
import { type ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_MESSAGES } from '~/constants/messages'
import { ICreateFNBOrderRequestBody } from '~/models/requests/FNB.request'
import { ErrorWithStatus } from '~/models/Error'
import fnbOrderService from '~/services/fnbOrder.service'
import fnbMenuItemService from '~/services/fnbMenuItem.service'
import databaseService from '~/services/database.service'
import { BillService } from '~/services/bill.service'
import { ObjectId } from 'mongodb'
import {
  aggregateLinesToLegacyMaps,
  aggregateQuantitiesByItemId,
  emptyFnbOrder,
  newFnbLineId,
  normalizeFnbOrder,
  plainQuantityForItem,
  setPlainLineQuantity
} from '~/utils/fnbOrderLines'
import type { FNBOrder, FNBOrderLine } from '~/models/schemas/FNB.schema'
import { cleanOrderDetail } from '../utils/common'

/** getBill bắt buộc actual start/end — hàm này lấy từ lịch (và now nếu lịch chưa có end) để gọi nội bộ */
async function resolveActualTimesForBill(roomScheduleId: string): Promise<{ actualStartTime: string; actualEndTime: string }> {
  const schedule = await databaseService.roomSchedule.findOne({ _id: new ObjectId(roomScheduleId) })
  if (!schedule) {
    throw new ErrorWithStatus({
      message: 'Không tìm thấy lịch đặt phòng',
      status: HTTP_STATUS_CODE.NOT_FOUND
    })
  }
  const toIso = (d: Date | string | undefined | null) =>
    !d ? new Date().toISOString() : d instanceof Date ? d.toISOString() : new Date(d).toISOString()

  return {
    actualStartTime: toIso(schedule.startTime as Date),
    actualEndTime: schedule.endTime ? toIso(schedule.endTime as Date) : new Date().toISOString()
  }
}

/**
 * @description Create FNB Order
 * @path /fnb-orders
 * @method POST
 */
export const createFnbOrder = async (
  req: Request<ParamsDictionary, any, ICreateFNBOrderRequestBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { roomScheduleId, order, createdBy } = req.body
    // Sử dụng upsertFnbOrder thay vì createFnbOrder để tránh duplicate
    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: FNB_MESSAGES.CREATE_FNB_ORDER_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get FNB Order by ID
 * @path /fnb-orders/:id
 * @method GET
 */
export const getFnbOrderById = async (
  req: Request<ParamsDictionary, any, any, any>,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await fnbOrderService.getFnbOrderById(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_MESSAGES.GET_FNB_ORDER_BY_ID_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Delete FNB Order
 * @path /fnb-orders/:id
 * @method DELETE
 */
export const deleteFnbOrder = async (req: Request<ParamsDictionary, any, any>, res: Response, next: NextFunction) => {
  try {
    const result = await fnbOrderService.deleteFnbOrder(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_MESSAGES.DELETE_FNB_ORDER_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get FNB Orders by Room Schedule ID
 * @path /fnb-orders/room-schedule/:roomScheduleId
 * @method GET
 */
export const getFnbOrdersByRoomSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fnbOrderService.getFnbOrdersByRoomSchedule(req.params.roomScheduleId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_MESSAGES.GET_FNB_ORDERS_BY_ROOM_SCHEDULE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Upsert FNB Order
 * @path /fnb-orders
 * @method POST
 */
export const upsertFnbOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId, order, createdBy } = req.body

    // Get current order to calculate delta
    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    const newNorm = normalizeFnbOrder(order)
    const currentNorm = normalizeFnbOrder(currentOrder?.order)
    const allItems = aggregateQuantitiesByItemId(newNorm)
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    const currentItems = aggregateQuantitiesByItemId(currentNorm)

    const allItemIds = new Set([...Object.keys(currentItems), ...Object.keys(allItems)])

    for (const itemId of allItemIds) {
      const newQuantity = allItems[itemId] || 0
      const currentQuantity = currentItems[itemId] || 0
      const delta = newQuantity - currentQuantity

      if (delta !== 0) {
        // Find item
        let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
        let isVariant = false

        if (!item) {
          const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
          if (menuItem) {
            item = menuItem
            isVariant = true
          }
        }

        if (item) {
          inventoryUpdates.push({ itemId, delta, item, isVariant })
        }
      }
    }

    // Check inventory availability and update inventory
    for (const { itemId, delta, item, isVariant } of inventoryUpdates) {
      // Check inventory if increasing quantity
      if (delta > 0) {
        const availableQuantity = item.inventory?.quantity ?? 0
        if (availableQuantity < delta) {
          throw new ErrorWithStatus({
            message: `Not enough inventory for item ${item.name}. Available: ${availableQuantity}, Required: ${delta}`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
      }

      // Update inventory
      if (item.inventory && delta !== 0) {
        const newInventoryQuantity = item.inventory.quantity - delta
        if (isVariant) {
          await fnbMenuItemService.updateMenuItem(itemId, {
            inventory: {
              ...item.inventory,
              quantity: newInventoryQuantity,
              lastUpdated: new Date()
            },
            updatedAt: new Date()
          })
        } else {
          await databaseService.fnbMenu.updateOne(
            { _id: new ObjectId(itemId) },
            {
              $set: {
                'inventory.quantity': newInventoryQuantity,
                'inventory.lastUpdated': new Date(),
                updatedAt: new Date()
              }
            }
          )
        }
      }
    }

    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_MESSAGES.UPSERT_FNB_ORDER_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get updated bill with latest FNB items for a room schedule
 * @path /fnb-orders/bill/:roomScheduleId
 * @method GET
 */
export const getUpdatedBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params

    const billService = new BillService()
    const { actualStartTime, actualEndTime } = await resolveActualTimesForBill(roomScheduleId)
    const bill = await billService.getBill(roomScheduleId, actualEndTime, undefined, undefined, actualStartTime)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy bill thành công',
      result: bill
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Add items to existing FNB order and update bill
 * @path /fnb-orders/add-items
 * @method POST
 */
export const addItemsToOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId, items, createdBy } = req.body

    // Step 1: Check inventory availability
    const inventoryResults = []
    for (const { itemId, quantity } of items) {
      // Tìm trong menu chính (fnb_menu collection) trước
      let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
      let isVariant = false

      // Nếu không tìm thấy, tìm trong menu items (fnb_menu_item collection)
      if (!item) {
        const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
        if (menuItem) {
          item = menuItem
          isVariant = true
        }
      }

      if (!item) {
        return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
          message: `Không tìm thấy item ${itemId}`
        })
      }

      if ((item.inventory?.quantity ?? 0) < quantity) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: `Item ${item.name} không đủ hàng (còn ${item.inventory?.quantity || 0}, cần ${quantity})`
        })
      }

      inventoryResults.push({ item, isVariant })
    }

    // Step 2: Get existing order or create new one
    let currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Prepare new items to add
    const newItems: { snacks: Record<string, number>; drinks: Record<string, number> } = {
      snacks: {},
      drinks: {}
    }

    for (const { itemId, quantity } of items) {
      const item = inventoryResults.find((i) => i.item._id.toString() === itemId)
      if (item) {
        if (item.item.category === 'snack') {
          newItems.snacks[itemId] = quantity
        } else if (item.item.category === 'drink') {
          newItems.drinks[itemId] = quantity
        }
      }
    }

    const orderResult = await fnbOrderService.upsertFnbOrder(roomScheduleId, newItems, createdBy, 'add')

    // Step 4: Generate updated bill
    const billService = new BillService()
    let updatedBill
    try {
      const { actualStartTime, actualEndTime } = await resolveActualTimesForBill(roomScheduleId)
      updatedBill = await billService.getBill(roomScheduleId, actualEndTime, undefined, undefined, actualStartTime)
      console.log('Bill đã được cập nhật với items mới')
    } catch (billError) {
      console.error('Lỗi khi tạo bill:', billError)
      updatedBill = null
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Thêm items thành công',
      result: {
        order: orderResult,
        addedItems: items,
        bill: updatedBill
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get detailed bill with FNB items breakdown
 * @path /fnb-orders/bill-details/:roomScheduleId
 * @method GET
 */
export const getBillDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params

    // Get bill
    const billService = new BillService()
    const { actualStartTime, actualEndTime } = await resolveActualTimesForBill(roomScheduleId)
    const bill = await billService.getBill(roomScheduleId, actualEndTime, undefined, undefined, actualStartTime)

    // Get FNB order for this room schedule
    const order = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Get menu items for reference
    const menu = await databaseService.fnbMenu.find({}).toArray()

    const fnbItemsBreakdown = []
    if (order) {
      const fnbNorm = normalizeFnbOrder(order.order)
      for (const line of fnbNorm.lines) {
        const itemId = line.itemId
        const quantity = line.quantity
        let menuItem = menu.find((m) => m._id.toString() === itemId)
        let itemName = ''
        let itemPrice = 0

        if (menuItem) {
          itemName = menuItem.name
          itemPrice = menuItem.price
        } else {
          for (const menuItem of menu) {
            if (menuItem.variants && Array.isArray(menuItem.variants)) {
              const variant = menuItem.variants.find((v: any) => v.id === itemId)
              if (variant) {
                itemName = `${menuItem.name} - ${variant.name}`
                itemPrice = variant.price
                break
              }
            }
          }
        }

        if (itemName && itemPrice > 0) {
          fnbItemsBreakdown.push({
            id: itemId,
            lineId: line.lineId,
            name: itemName,
            category: line.category,
            quantity,
            unitPrice: itemPrice,
            totalPrice: quantity * itemPrice,
            note: line.note,
            type: 'fnb'
          })
        }
      }
    }

    // Separate service items from FNB items in bill
    const serviceItems = bill.items.filter((item) => item.description.includes('Phi dich vu thu am'))

    const result = {
      bill: {
        ...bill,
        items: bill.items
      },
      breakdown: {
        serviceItems: serviceItems,
        fnbItems: fnbItemsBreakdown,
        totalServiceAmount: serviceItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        totalFnbAmount: fnbItemsBreakdown.reduce((sum, item) => sum + item.totalPrice, 0)
      },
      summary: {
        totalItems: bill.items.length,
        serviceItemsCount: serviceItems.length,
        fnbItemsCount: fnbItemsBreakdown.length,
        totalAmount: bill.totalAmount
      }
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy chi tiết bill thành công',
      result: result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Complete FNB Order (deduct inventory + create order + update bill)
 * @path /fnb-orders/complete
 * @method POST
 */
export const completeOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId, items, createdBy } = req.body

    // Step 1: Deduct inventory
    const inventoryResults: Array<{ item: any; isVariant: boolean }> = []
    for (const { itemId, quantity } of items) {
      // Tìm trong menu chính (fnb_menu collection) trước
      let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
      let isVariant = false

      // Nếu không tìm thấy, tìm trong menu items (fnb_menu_item collection)
      if (!item) {
        const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
        if (menuItem) {
          item = menuItem
          isVariant = true
        }
      }

      if (!item) {
        return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
          message: `Không tìm thấy item ${itemId}`
        })
      }

      if ((item.inventory?.quantity ?? 0) < quantity) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: `Item ${item.name} không đủ hàng (còn ${item.inventory?.quantity || 0}, cần ${quantity})`
        })
      }

      // Deduct inventory - cập nhật trực tiếp trong database
      if (item.inventory) {
        if (isVariant) {
          // Nếu là variant, cập nhật trong fnb_menu_item collection
          await fnbMenuItemService.updateMenuItem(itemId, {
            inventory: {
              ...item.inventory,
              quantity: item.inventory.quantity - quantity,
              lastUpdated: new Date()
            },
            updatedAt: new Date()
          })
        } else {
          // Nếu là menu chính, cập nhật trong fnb_menu collection
          await databaseService.fnbMenu.updateOne(
            { _id: new ObjectId(itemId) },
            {
              $set: {
                'inventory.quantity': item.inventory.quantity - quantity,
                'inventory.lastUpdated': new Date()
              }
            }
          )
        }
      }

      // Lấy item đã cập nhật
      const updatedItem = isVariant
        ? await fnbMenuItemService.getMenuItemById(itemId)
        : await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
      inventoryResults.push({ item: updatedItem, isVariant })
    }

    const lineRows: FNBOrderLine[] = []
    for (const { itemId, quantity } of items) {
      const row = inventoryResults.find((i) => i.item?._id?.toString() === itemId)
      if (!row?.item) continue

      let cat: 'drink' | 'snack' = row.item.category === 'drink' ? 'drink' : 'snack'
      if (!row.item.category && 'parentId' in row.item && row.item.parentId) {
        const parentItem = await fnbMenuItemService.getMenuItemById(row.item.parentId)
        if (parentItem?.category === 'drink' || parentItem?.category === 'snack') {
          cat = parentItem.category
        }
      }

      lineRows.push({
        lineId: newFnbLineId(),
        itemId,
        category: cat,
        quantity
      })
    }

    const order: FNBOrder = { lines: lineRows }
    const orderResult = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy, 'add')

    const historyRecord = await fnbOrderService.saveOrderHistory(roomScheduleId, order, createdBy || 'system')

    // Step 4: Generate updated bill with new items
    const billService = new BillService()
    let updatedBill
    try {
      const { actualStartTime, actualEndTime } = await resolveActualTimesForBill(roomScheduleId)
      updatedBill = await billService.getBill(roomScheduleId, actualEndTime, undefined, undefined, actualStartTime)
      console.log('Bill đã được cập nhật với items mới')
    } catch (billError) {
      console.error('Lỗi khi tạo bill:', billError)
      // Không fail toàn bộ request nếu chỉ lỗi bill
      updatedBill = null
    }

    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: 'Đặt món thành công',
      result: {
        order: orderResult,
        history: historyRecord,
        updatedItems: inventoryResults,
        bill: updatedBill // Trả về bill đã cập nhật với items mới
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get FNB Order Detail with item information
 * @path /fnb-orders/detail/:roomScheduleId
 * @method GET
 */
export const getOrderDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params

    // Lấy order hiện tại
    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    if (!currentOrder) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Không tìm thấy order cho room schedule này'
      })
    }

    const norm = normalizeFnbOrder(currentOrder.order)
    const maps = aggregateLinesToLegacyMaps(norm)

    const drinksDetail: any[] = []
    const snacksDetail: any[] = []
    const linesDetail: any[] = []

    for (const row of norm.lines) {
      const item = await fnbMenuItemService.getMenuItemById(row.itemId)
      if (!item) continue

      const entry = {
        lineId: row.lineId,
        itemId: row.itemId,
        name: item.name,
        price: item.price,
        quantity: row.quantity,
        category: row.category,
        note: row.note,
        selections: row.selections
      }
      linesDetail.push(entry)
      if (row.category === 'drink') drinksDetail.push(entry)
      else snacksDetail.push(entry)
    }

    let orderDetail = {
      roomScheduleId: currentOrder.roomScheduleId,
      order: {
        lines: norm.lines,
        drinks: maps.drinks,
        snacks: maps.snacks
      },
      items: {
        lines: linesDetail,
        drinks: drinksDetail,
        snacks: snacksDetail
      },
      createdAt: currentOrder.createdAt,
      updatedAt: currentOrder.updatedAt,
      createdBy: currentOrder.createdBy,
      updatedBy: currentOrder.updatedBy
    }

    // Lọc các item có quantity = 0 trước khi trả về
    orderDetail = cleanOrderDetail(orderDetail)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get order detail successfully',
      result: orderDetail
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Cleanup duplicate FNB orders
 * @path /fnb-orders/cleanup-duplicates
 * @method POST
 */
export const cleanupDuplicateOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('=== CLEANUP DUPLICATE ORDERS ENDPOINT ===')
    await fnbOrderService.cleanupDuplicateOrders()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Cleanup duplicate orders thành công',
      result: { success: true }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Ensure unique index for FNB orders
 * @path /fnb-orders/ensure-unique-index
 * @method POST
 */
export const ensureUniqueIndex = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('=== ENSURE UNIQUE INDEX ENDPOINT ===')
    await fnbOrderService.ensureUniqueIndex()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Ensure unique index thành công',
      result: { success: true }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Upsert FNB Order Item (add/update quantity)
 * @path /fnb-orders/upsert-item
 * @method POST
 */
export const upsertOrderItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId, itemId, quantity, category, createdBy } = req.body

    console.log('=== DEBUG UPSERT ORDER ITEM ===')
    console.log('Request body:', { roomScheduleId, itemId, quantity, category, createdBy })

    // Lấy order hiện tại
    let currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    console.log('Current order found:', currentOrder ? 'YES' : 'NO')
    console.log('Current order:', currentOrder ? JSON.stringify(currentOrder, null, 2) : 'NULL')

    if (!currentOrder) {
      currentOrder = await fnbOrderService.upsertFnbOrder(roomScheduleId, emptyFnbOrder(), createdBy, 'set')
    }

    const curNorm = normalizeFnbOrder(currentOrder!.order)
    const cat = category === 'drink' ? 'drink' : 'snack'
    const oldQuantity = plainQuantityForItem(curNorm, itemId, cat)
    const delta = quantity - oldQuantity

    console.log('Old quantity:', oldQuantity)
    console.log('New quantity:', quantity)
    console.log('Delta:', delta)

    // Nếu không thay đổi thì trả về luôn
    if (delta === 0) {
      console.log('No change in quantity, returning current order')
      return res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Số lượng không thay đổi',
        result: currentOrder
      })
    }

    // Lấy item từ fnb_menu_item (không dùng fnb_menu nữa)
    const item = await fnbMenuItemService.getMenuItemById(itemId)
    console.log('Item from fnb_menu_item:', item ? 'FOUND' : 'NOT FOUND')

    if (!item) {
      console.log('Item not found in fnb_menu_item collection')
      console.log('Available items in fnb_menu_item:', await fnbMenuItemService.getAllMenuItems())
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: `Không tìm thấy item ${itemId} trong fnb_menu_item. Vui lòng kiểm tra lại item ID.`
      })
    }

    console.log('Final item:', {
      id: item._id,
      name: item.name,
      inventory: item.inventory
    })

    // Kiểm tra tồn kho nếu tăng số lượng
    if (delta > 0) {
      console.log('Checking inventory for delta > 0')
      console.log('Item inventory quantity:', item.inventory?.quantity ?? 0)
      console.log('Delta:', delta)

      if ((item.inventory?.quantity ?? 0) < delta) {
        console.log('Insufficient inventory')
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: `Item ${item.name} không đủ hàng (còn ${item.inventory?.quantity || 0}, cần thêm ${delta})`
        })
      }
    }

    // Cập nhật tồn kho trong fnb_menu_item
    if (item.inventory) {
      const newInventoryQuantity = item.inventory.quantity - delta
      console.log('Updating inventory in fnb_menu_item:', {
        current: item.inventory.quantity,
        delta: delta,
        new: newInventoryQuantity
      })

      await fnbMenuItemService.updateMenuItem(itemId, {
        inventory: {
          ...item.inventory,
          quantity: newInventoryQuantity,
          lastUpdated: new Date()
        },
        updatedAt: new Date()
      })
    } else {
      console.log('Item has no inventory, skipping inventory update')
    }

    const nextOrder = setPlainLineQuantity(curNorm, itemId, cat, quantity)
    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, nextOrder, createdBy, 'set')

    console.log('Upsert result:', result ? JSON.stringify(result, null, 2) : 'NULL')
    console.log('=== END DEBUG UPSERT ORDER ITEM ===')

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Upsert order item successfully',
      result
    })
  } catch (error) {
    next(error)
  }
}

// ============================================
// NEW SEMANTIC ACTIONS API FOR ADMIN
// ============================================

/**
 * @description ADD items to FNB Order for admin (cộng dồn số lượng)
 * @path POST /fnb-orders/:roomScheduleId/add
 * @method POST
 */
export const addAdminFnbOrderItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params
    const { order, createdBy } = req.body

    // Validate roomScheduleId
    if (!ObjectId.isValid(roomScheduleId)) {
      throw new ErrorWithStatus({
        message: 'Invalid room schedule ID',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    const addNorm = normalizeFnbOrder(order)
    const allItems = aggregateQuantitiesByItemId(addNorm)
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []
    const itemsCache = new Map<string, { item: any; isVariant: boolean }>()

    for (const itemId of Object.keys(allItems)) {
      const delta = allItems[itemId] || 0

      if (delta !== 0) {
        let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
        let isVariant = false

        if (!item) {
          const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
          if (menuItem) {
            item = menuItem
            isVariant = true
          }
        }

        if (item) {
          inventoryUpdates.push({ itemId, delta, item, isVariant })
          itemsCache.set(itemId, { item, isVariant })
        }
      }
    }

    for (const { itemId, delta, item, isVariant } of inventoryUpdates) {
      if (delta > 0) {
        const availableQuantity = item.inventory?.quantity ?? 0
        if (availableQuantity < delta) {
          throw new ErrorWithStatus({
            message: `Not enough inventory for item ${item.name}. Available: ${availableQuantity}, Required: ${delta}`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
      }

      if (item.inventory && delta !== 0) {
        const newInventoryQuantity = item.inventory.quantity - delta
        if (isVariant) {
          await fnbMenuItemService.updateMenuItem(itemId, {
            inventory: {
              ...item.inventory,
              quantity: newInventoryQuantity,
              lastUpdated: new Date()
            },
            updatedAt: new Date()
          })
        } else {
          await databaseService.fnbMenu.updateOne(
            { _id: new ObjectId(itemId) },
            {
              $set: {
                'inventory.quantity': newInventoryQuantity,
                'inventory.lastUpdated': new Date(),
                updatedAt: new Date()
              }
            }
          )
        }
      }
    }

    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy, 'add')

    // Validate that order was saved successfully
    if (!result) {
      throw new ErrorWithStatus({
        message: 'Failed to save order to database',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Add items to order successfully',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description REMOVE items from FNB Order for admin (giảm số lượng)
 * @path POST /fnb-orders/:roomScheduleId/remove
 * @method POST
 */
export const removeAdminFnbOrderItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params
    const { order, createdBy } = req.body

    // Validate roomScheduleId
    if (!ObjectId.isValid(roomScheduleId)) {
      throw new ErrorWithStatus({
        message: 'Invalid room schedule ID',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    const remNorm = normalizeFnbOrder(order)
    const allItems = aggregateQuantitiesByItemId(remNorm)
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    for (const itemId of Object.keys(allItems)) {
      const removeQuantity = allItems[itemId] || 0

      if (removeQuantity !== 0) {
        // Find item
        let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
        let isVariant = false

        if (!item) {
          const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
          if (menuItem) {
            item = menuItem
            isVariant = true
          }
        }

        if (item) {
          // Delta âm vì đang trả lại inventory
          inventoryUpdates.push({ itemId, delta: -removeQuantity, item, isVariant })
        }
      }
    }

    // Update inventory (trả lại kho)
    for (const { itemId, delta, item, isVariant } of inventoryUpdates) {
      if (item.inventory) {
        const newInventoryQuantity = item.inventory.quantity - delta // delta âm nên sẽ CỘNG vào kho
        if (isVariant) {
          await fnbMenuItemService.updateMenuItem(itemId, {
            inventory: {
              ...item.inventory,
              quantity: newInventoryQuantity,
              lastUpdated: new Date()
            },
            updatedAt: new Date()
          })
        } else {
          await databaseService.fnbMenu.updateOne(
            { _id: new ObjectId(itemId) },
            {
              $set: {
                'inventory.quantity': newInventoryQuantity,
                'inventory.lastUpdated': new Date(),
                updatedAt: new Date()
              }
            }
          )
        }
      }
    }

    // REMOVE mode: Giảm số lượng
    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy, 'remove')

    // Validate that order was saved successfully
    if (!result) {
      throw new ErrorWithStatus({
        message: 'Failed to save order to database',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Remove items from order successfully',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description SET FNB Order for admin (ghi đè toàn bộ order)
 * @path PUT /fnb-orders/:roomScheduleId
 * @method PUT
 */
export const setAdminFnbOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params
    const { order, createdBy } = req.body

    // Validate roomScheduleId
    if (!ObjectId.isValid(roomScheduleId)) {
      throw new ErrorWithStatus({
        message: 'Invalid room schedule ID',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    const newNorm = normalizeFnbOrder(order)
    const currentNorm = normalizeFnbOrder(currentOrder?.order)
    const newItems = aggregateQuantitiesByItemId(newNorm)
    const currentItems = aggregateQuantitiesByItemId(currentNorm)

    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    const allItemIds = new Set([...Object.keys(currentItems), ...Object.keys(newItems)])

    for (const itemId of allItemIds) {
      const newQuantity = newItems[itemId] || 0
      const currentQuantity = currentItems[itemId] || 0
      const delta = newQuantity - currentQuantity

      if (delta !== 0) {
        // Find item
        let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
        let isVariant = false

        if (!item) {
          const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
          if (menuItem) {
            item = menuItem
            isVariant = true
          }
        }

        if (item) {
          inventoryUpdates.push({ itemId, delta, item, isVariant })
        }
      }
    }

    // Check inventory availability and update inventory
    for (const { itemId, delta, item, isVariant } of inventoryUpdates) {
      // Check inventory if increasing quantity
      if (delta > 0) {
        const availableQuantity = item.inventory?.quantity ?? 0
        if (availableQuantity < delta) {
          throw new ErrorWithStatus({
            message: `Not enough inventory for item ${item.name}. Available: ${availableQuantity}, Required: ${delta}`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
      }

      // Update inventory
      if (item.inventory && delta !== 0) {
        const newInventoryQuantity = item.inventory.quantity - delta
        if (isVariant) {
          await fnbMenuItemService.updateMenuItem(itemId, {
            inventory: {
              ...item.inventory,
              quantity: newInventoryQuantity,
              lastUpdated: new Date()
            },
            updatedAt: new Date()
          })
        } else {
          await databaseService.fnbMenu.updateOne(
            { _id: new ObjectId(itemId) },
            {
              $set: {
                'inventory.quantity': newInventoryQuantity,
                'inventory.lastUpdated': new Date(),
                updatedAt: new Date()
              }
            }
          )
        }
      }
    }

    // SET mode: Ghi đè toàn bộ order
    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy, 'set')

    // Validate that order was saved successfully
    if (!result) {
      throw new ErrorWithStatus({
        message: 'Failed to save order to database',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_MESSAGES.UPSERT_FNB_ORDER_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Thống kê FNB: số item bán được theo ngày/tuần/tháng (theo giờ Việt Nam)
 * @path GET /fnb-orders/stats
 * @query period: 'day' | 'week' | 'month'
 * @query date: YYYY-MM-DD (optional - ngày cụ thể; không gửi thì dùng hôm nay / tuần hiện tại / tháng hiện tại)
 * @query category: 'drink' | 'snack' (optional - lọc theo loại)
 * @query search: string (optional - tìm theo tên item)
 */
export const getFnbSalesStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) || 'day'
    const dateStr = req.query.date as string | undefined
    const category = req.query.category as string | undefined
    const search = req.query.search as string | undefined

    if (!['day', 'week', 'month'].includes(period)) {
      throw new ErrorWithStatus({
        message: 'period phải là day, week hoặc month',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (dateStr) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(dateStr)) {
        throw new ErrorWithStatus({
          message: 'date phải có format YYYY-MM-DD',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
    }

    if (category && !['drink', 'snack'].includes(category)) {
      throw new ErrorWithStatus({
        message: 'category phải là drink hoặc snack',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await fnbOrderService.getFnbSalesStats(
      period as 'day' | 'week' | 'month',
      dateStr,
      category as 'drink' | 'snack' | undefined,
      search
    )

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy thống kê FNB thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}
