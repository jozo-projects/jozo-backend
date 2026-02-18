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
import { cleanOrderDetail } from '../utils/common'

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

    // Calculate inventory changes and update inventory
    const allItems = { ...order.drinks, ...order.snacks }
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    // Get all items that were in the current order (including those being removed)
    const currentItems = {
      ...(currentOrder?.order.drinks || {}),
      ...(currentOrder?.order.snacks || {})
    }

    // Create a set of all item IDs (current + new)
    const allItemIds = new Set([...Object.keys(currentItems), ...Object.keys(allItems)])

    // Calculate deltas for each item
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
    const bill = await billService.getBill(roomScheduleId)

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

    // Step 3: Update or create order using upsertFnbOrder
    let orderResult
    if (currentOrder) {
      // Merge with existing order
      const mergedOrder = {
        snacks: { ...currentOrder.order.snacks, ...newItems.snacks },
        drinks: { ...currentOrder.order.drinks, ...newItems.drinks }
      }
      orderResult = await fnbOrderService.upsertFnbOrder(roomScheduleId, mergedOrder, createdBy)
    } else {
      // Create new order using upsertFnbOrder (sẽ tự động tạo mới nếu chưa có)
      orderResult = await fnbOrderService.upsertFnbOrder(roomScheduleId, newItems, createdBy)
    }

    // Step 4: Generate updated bill
    const billService = new BillService()
    let updatedBill
    try {
      updatedBill = await billService.getBill(roomScheduleId)
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
    const bill = await billService.getBill(roomScheduleId)

    // Get FNB order for this room schedule
    const order = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Get menu items for reference
    const menu = await databaseService.fnbMenu.find({}).toArray()

    // Process FNB items for detailed breakdown
    const fnbItemsBreakdown = []
    if (order) {
      // Process drinks
      if (order.order.drinks && Object.keys(order.order.drinks).length > 0) {
        for (const [itemId, quantity] of Object.entries(order.order.drinks)) {
          let menuItem = menu.find((m) => m._id.toString() === itemId)
          let itemName = ''
          let itemPrice = 0

          if (menuItem) {
            itemName = menuItem.name
            itemPrice = menuItem.price
          } else {
            // Check variants
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
              name: itemName,
              category: 'drink',
              quantity: quantity,
              unitPrice: itemPrice,
              totalPrice: quantity * itemPrice,
              type: 'fnb'
            })
          }
        }
      }

      // Process snacks
      if (order.order.snacks && Object.keys(order.order.snacks).length > 0) {
        for (const [itemId, quantity] of Object.entries(order.order.snacks)) {
          let menuItem = menu.find((m) => m._id.toString() === itemId)
          let itemName = ''
          let itemPrice = 0

          if (menuItem) {
            itemName = menuItem.name
            itemPrice = menuItem.price
          } else {
            // Check variants
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
              name: itemName,
              category: 'snack',
              quantity: quantity,
              unitPrice: itemPrice,
              totalPrice: quantity * itemPrice,
              type: 'fnb'
            })
          }
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

    // Step 2: Create order
    const order: { snacks: Record<string, number>; drinks: Record<string, number> } = {
      snacks: {},
      drinks: {}
    }

    // Group items by category
    console.log('=== DEBUG ORDER CREATION ===')
    console.log('Items to process:', items)
    console.log(
      'Inventory results:',
      inventoryResults.map((i) => ({ id: i.item?._id?.toString(), name: i.item?.name, category: i.item?.category }))
    )

    for (const { itemId, quantity } of items) {
      const item = inventoryResults.find((i) => i.item?._id?.toString() === itemId)
      console.log(`Looking for itemId: ${itemId}`)
      console.log(
        `Found item:`,
        item && item.item
          ? { id: item.item._id?.toString(), name: item.item.name, category: item.item.category }
          : 'NOT FOUND'
      )

      if (item && item.item) {
        console.log(`Processing item: ${item.item.name}, category: ${item.item.category}, quantity: ${quantity}`)
        console.log(`Item full data:`, JSON.stringify(item.item, null, 2))

        let category = item.item.category

        // Nếu item không có category và có parentId, tìm category từ parent
        if (!category && 'parentId' in item.item && item.item.parentId) {
          console.log(`Item has parentId: ${item.item.parentId}, looking for parent category...`)
          const parentItem = await fnbMenuItemService.getMenuItemById(item.item.parentId)
          if (parentItem && parentItem.category) {
            category = parentItem.category
            console.log(`Found parent category: ${category}`)
          }
        }

        if (category === 'snack') {
          order.snacks[itemId] = quantity
          console.log(`Added to snacks: ${itemId} = ${quantity}`)
        } else if (category === 'drink') {
          order.drinks[itemId] = quantity
          console.log(`Added to drinks: ${itemId} = ${quantity}`)
        } else {
          console.log(`Item category is not 'snack' or 'drink': ${category}`)
          // Fallback: nếu không có category hoặc category không đúng, mặc định là snack
          order.snacks[itemId] = quantity
          console.log(`Added to snacks (fallback): ${itemId} = ${quantity}`)
        }
      } else {
        console.log(`Item not found in inventoryResults for itemId: ${itemId}`)
      }
    }

    console.log('Final order:', order)
    console.log('=== END DEBUG ===')

    const orderResult = await fnbOrderService.upsertFnbOrder(roomScheduleId, order, createdBy)

    // Step 3: Save to history (NEW)
    const historyRecord = await fnbOrderService.saveOrderHistory(roomScheduleId, order, createdBy || 'system')

    // Step 4: Generate updated bill with new items
    const billService = new BillService()
    let updatedBill
    try {
      updatedBill = await billService.getBill(roomScheduleId)
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

    // Xử lý drinks
    const drinksDetail = []
    if (currentOrder.order.drinks && Object.keys(currentOrder.order.drinks).length > 0) {
      for (const [itemId, quantity] of Object.entries(currentOrder.order.drinks)) {
        // Chỉ kiểm tra fnb_menu_item (không dùng fnb_menu nữa)
        const item = await fnbMenuItemService.getMenuItemById(itemId)

        if (item) {
          drinksDetail.push({
            itemId,
            name: item.name,
            price: item.price,
            quantity,
            category: 'drink'
          })
        }
      }
    }

    // Xử lý snacks
    const snacksDetail = []
    if (currentOrder.order.snacks && Object.keys(currentOrder.order.snacks).length > 0) {
      for (const [itemId, quantity] of Object.entries(currentOrder.order.snacks)) {
        // Chỉ kiểm tra fnb_menu_item (không dùng fnb_menu nữa)
        const item = await fnbMenuItemService.getMenuItemById(itemId)

        if (item) {
          snacksDetail.push({
            itemId,
            name: item.name,
            price: item.price,
            quantity,
            category: 'snack'
          })
        }
      }
    }

    let orderDetail = {
      roomScheduleId: currentOrder.roomScheduleId,
      order: {
        drinks: currentOrder.order.drinks,
        snacks: currentOrder.order.snacks
      },
      items: {
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

    // Tạo order mới nếu chưa có
    if (!currentOrder) {
      const newOrder = {
        drinks: {},
        snacks: {}
      }
      currentOrder = await fnbOrderService.upsertFnbOrder(roomScheduleId, newOrder, createdBy)
    }

    // Lấy số lượng cũ của item (nếu có)
    let oldQuantity = 0
    if (currentOrder) {
      if (category === 'drink') {
        oldQuantity = currentOrder.order.drinks[itemId] || 0
      } else {
        oldQuantity = currentOrder.order.snacks[itemId] || 0
      }
    }
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

    // Tạo order object với item cần cập nhật
    const orderUpdate = {
      drinks: category === 'drink' ? { [itemId]: quantity } : {},
      snacks: category === 'snack' ? { [itemId]: quantity } : {}
    }

    console.log('Order update object:', orderUpdate)

    // Upsert order
    const result = await fnbOrderService.upsertFnbOrder(roomScheduleId, orderUpdate, createdBy)

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

    // Get current order to calculate delta
    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Calculate inventory changes - delta là số lượng thêm trong request
    const allItems = { ...order.drinks, ...order.snacks }
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    // Cache để tránh query lại các items đã có thông tin
    const itemsCache = new Map<string, { item: any; isVariant: boolean }>()

    // Calculate deltas for each item (delta = số lượng thêm trong request)
    for (const itemId of Object.keys(allItems)) {
      const delta = allItems[itemId] || 0

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
          itemsCache.set(itemId, { item, isVariant })
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

    // ADD mode: Cộng dồn số lượng
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

    // Get current order
    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Calculate inventory changes - delta là số lượng GIẢM (số dương)
    const allItems = { ...order.drinks, ...order.snacks }
    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    // Calculate deltas for each item (delta = số lượng giảm)
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

    // Get current order to calculate delta
    const currentOrder = await fnbOrderService.getFnbOrdersByRoomSchedule(roomScheduleId)

    // Calculate inventory changes
    const newItems = { ...order.drinks, ...order.snacks }
    const currentItems = {
      ...(currentOrder?.order.drinks || {}),
      ...(currentOrder?.order.snacks || {})
    }

    const inventoryUpdates: Array<{ itemId: string; delta: number; item: any; isVariant: boolean }> = []

    // Calculate delta for all items (new and old)
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
