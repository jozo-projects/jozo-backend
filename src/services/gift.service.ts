/* eslint-disable @typescript-eslint/no-explicit-any */
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { RoomScheduleStatus } from '~/constants/enum'
import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { Gift, GiftBundleItem, GiftType, ScheduleGift } from '~/models/schemas/Gift.schema'
import databaseService from './database.service'
import { roomEventEmitter } from './room.service'

type GiftSource = 'fnb_menu' | 'fnb_menu_item'

class GiftService {
  private giftsCollection() {
    return databaseService.gifts
  }

  private getInventoryCollection(source: GiftSource) {
    if (source === 'fnb_menu_item') {
      return databaseService.getCollection<FnBMenuItem>('fnb_menu_item')
    }
    return databaseService.fnbMenu
  }

  private async ensureAndAdjustInventory(items: GiftBundleItem[], bundleDelta: number) {
    for (const item of items) {
      const collection = this.getInventoryCollection(item.source)
      const found = await collection.findOne({ _id: item.itemId })
      if (!found) {
        throw new ErrorWithStatus({
          message: `Không tìm thấy menu item ${item.itemId.toString()}`,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      const change = item.quantity * bundleDelta
      const currentQuantity = (found as any).inventory?.quantity ?? 0
      if (currentQuantity + change < 0) {
        throw new ErrorWithStatus({
          message: `Tồn kho không đủ cho ${item.name}`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      await collection.updateOne(
        { _id: item.itemId },
        {
          $inc: { 'inventory.quantity': change },
          $set: { 'inventory.lastUpdated': new Date() }
        }
      )
    }
  }

  private pickWeightedRandom(gifts: Gift[]): Gift {
    const total = gifts.reduce((sum, g) => sum + (g.remainingQuantity || 0), 0)
    if (total <= 0) {
      throw new ErrorWithStatus({
        message: 'Hết quà khả dụng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    let r = Math.random() * total
    for (const gift of gifts) {
      r -= gift.remainingQuantity || 0
      if (r <= 0) return gift
    }
    return gifts[gifts.length - 1]
  }

  async listGifts() {
    return this.giftsCollection().find({}).toArray()
  }

  async createGift(payload: {
    name: string
    type: GiftType
    image?: string
    price?: number
    discountPercentage?: number
    items?: GiftBundleItem[]
    totalQuantity: number
    isActive?: boolean
  }): Promise<Gift> {
    if (payload.totalQuantity <= 0) {
      throw new ErrorWithStatus({
        message: 'totalQuantity phải lớn hơn 0',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (payload.type === 'discount' && !payload.discountPercentage) {
      throw new ErrorWithStatus({
        message: 'discountPercentage bắt buộc với gift discount',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (payload.type === 'snacks_drinks') {
      if (!payload.items || payload.items.length === 0) {
        throw new ErrorWithStatus({
          message: 'Gift snacks_drinks phải có items',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      // Trừ tồn kho theo số bundle tạo ra
      await this.ensureAndAdjustInventory(payload.items, -payload.totalQuantity)
    }

    const now = new Date()
    const doc: Gift = {
      name: payload.name,
      type: payload.type,
      image: payload.image,
      price: payload.price,
      discountPercentage: payload.discountPercentage,
      items: payload.items,
      totalQuantity: payload.totalQuantity,
      remainingQuantity: payload.totalQuantity,
      isActive: payload.isActive ?? true,
      createdAt: now,
      updatedAt: now
    }

    const result = await this.giftsCollection().insertOne(doc)
    return { ...doc, _id: result.insertedId }
  }

  async updateGift(id: string, payload: Partial<Gift>): Promise<Gift> {
    const _id = new ObjectId(id)
    const existing = await this.giftsCollection().findOne({ _id })
    if (!existing) {
      throw new ErrorWithStatus({
        message: 'Gift không tồn tại',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (payload.type && payload.type !== existing.type) {
      throw new ErrorWithStatus({
        message: 'Không hỗ trợ đổi type gift',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    let remainingQuantity = existing.remainingQuantity
    let totalQuantity = existing.totalQuantity

    if (payload.totalQuantity !== undefined) {
      const diff = payload.totalQuantity - existing.totalQuantity
      totalQuantity = payload.totalQuantity
      remainingQuantity = Math.max(existing.remainingQuantity + diff, 0)

      if (existing.type === 'snacks_drinks' && diff !== 0 && existing.items) {
        // Nếu tăng số bundle -> trừ thêm tồn kho, nếu giảm -> hoàn trả
        await this.ensureAndAdjustInventory(existing.items, -diff)
      }
    }

    const updateDoc: Partial<Gift> = {
      name: payload.name ?? existing.name,
      image: payload.image ?? existing.image,
      price: payload.price ?? existing.price,
      discountPercentage: payload.discountPercentage ?? existing.discountPercentage,
      items: payload.items ?? existing.items,
      totalQuantity,
      remainingQuantity,
      isActive: payload.isActive ?? existing.isActive,
      updatedAt: new Date()
    }

    await this.giftsCollection().updateOne({ _id }, { $set: updateDoc })
    return { ...(existing as Gift), ...updateDoc, _id }
  }

  async deleteGift(id: string) {
    const _id = new ObjectId(id)
    const existing = await this.giftsCollection().findOne({ _id })
    if (!existing) {
      return { deletedCount: 0 }
    }

    if (existing.type === 'snacks_drinks' && existing.items) {
      // Hoàn trả tồn kho cho số bundle còn lại
      await this.ensureAndAdjustInventory(existing.items, existing.remainingQuantity)
    }

    const result = await this.giftsCollection().deleteOne({ _id })
    return { deletedCount: result.deletedCount }
  }

  async claimRandomGift(scheduleId: string): Promise<ScheduleGift> {
    if (!ObjectId.isValid(scheduleId)) {
      throw new ErrorWithStatus({
        message: 'scheduleId không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const schedule = await databaseService.roomSchedule.findOne({ _id: new ObjectId(scheduleId) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy schedule',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Lấy thông tin room để emit realtime cho admin/staff nếu cần
    const room = await databaseService.rooms.findOne({ _id: schedule.roomId })
    const roomIndex = room?.roomId !== undefined && room?.roomId !== null ? String(room.roomId) : undefined

    // Nếu đã có gift được claim, trả về luôn (idempotent)
    if (schedule.gift && schedule.gift.status === 'claimed') {
      if (!schedule.gift.image) {
        const giftDoc = await this.giftsCollection().findOne({ _id: schedule.gift.giftId })
        if (giftDoc?.image) {
          return { ...schedule.gift, image: giftDoc.image }
        }
      }
      return schedule.gift
    }

    const isGiftEnabled = schedule.giftEnabled ?? false

    if (!isGiftEnabled) {
      throw new ErrorWithStatus({
        message: 'Lịch này không được nhận quà hoặc đã nhận',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const available = await this.giftsCollection()
      .find({ isActive: true, remainingQuantity: { $gt: 0 } })
      .toArray()

    if (available.length === 0) {
      throw new ErrorWithStatus({
        message: 'Hết quà khả dụng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const picked = this.pickWeightedRandom(available)

    // Atomic giảm tồn gift
    const updatedGiftResult = await this.giftsCollection().findOneAndUpdate(
      { _id: picked._id, remainingQuantity: { $gt: 0 } },
      {
        $inc: { remainingQuantity: -1 },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    )

    const updatedGift = (updatedGiftResult as any)?.value ?? updatedGiftResult

    if (!updatedGift) {
      throw new ErrorWithStatus({
        message: 'Quà đã hết, vui lòng thử lại',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const scheduleGift: ScheduleGift = {
      giftId: picked._id!,
      name: picked.name,
      type: picked.type,
      image: picked.image,
      status: 'claimed',
      assignedAt: new Date(),
      claimedAt: new Date(),
      discountPercentage: picked.discountPercentage,
      items: picked.items
    }

    const scheduleUpdateResult = await databaseService.roomSchedule.findOneAndUpdate(
      {
        _id: schedule._id,
        giftEnabled: true,
        $or: [{ gift: { $exists: false } }, { 'gift.status': { $ne: 'claimed' } }]
      },
      {
        $set: {
          gift: scheduleGift,
          giftEnabled: false,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    )

    const scheduleUpdate = (scheduleUpdateResult as any)?.value ?? scheduleUpdateResult

    // Nếu không cập nhật được (đã nhận ở request khác), hoàn trả tồn kho vừa trừ
    if (!scheduleUpdate) {
      await this.giftsCollection().updateOne(
        { _id: picked._id },
        { $inc: { remainingQuantity: 1 }, $set: { updatedAt: new Date() } }
      )

      throw new ErrorWithStatus({
        message: 'Lịch này không được nhận quà hoặc đã nhận',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Emit sự kiện cho admin/staff (management room) khi khách đã claim quà thành công
    if (roomIndex) {
      roomEventEmitter.emit('gift_claimed', {
        roomId: roomIndex,
        scheduleId: schedule._id?.toString(),
        gift: scheduleGift
      })
    }

    return scheduleGift
  }

  async getGiftById(id: string): Promise<Gift> {
    const _id = new ObjectId(id)
    const gift = await this.giftsCollection().findOne<Gift>({ _id })
    if (!gift) {
      throw new ErrorWithStatus({
        message: 'Gift không tồn tại',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return gift
  }

  async getGiftForRoom(roomIndex: number) {
    const room = await databaseService.rooms.findOne({ roomId: roomIndex })
    if (!room?._id) {
      throw new ErrorWithStatus({
        message: 'Room not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const activeSchedule = await databaseService.roomSchedule.findOne(
      {
        roomId: room._id,
        status: { $in: [RoomScheduleStatus.Booked, RoomScheduleStatus.InUse] }
      },
      { sort: { startTime: -1 } }
    )

    if (!activeSchedule) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy lịch đang hoạt động cho phòng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return {
      scheduleId: activeSchedule._id,
      gift: activeSchedule.gift,
      giftEnabled: !!activeSchedule.giftEnabled
    }
  }
}

const giftService = new GiftService()
export default giftService
