import { NextFunction, Request, Response, Express } from 'express'
import { ObjectId } from 'mongodb'
import { ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { GIFT_MESSAGES } from '~/constants/messages'
import { GiftCreateRequest, GiftUpdateRequest } from '~/models/requests/Gift.request'
import { GiftBundleItem } from '~/models/schemas/Gift.schema'
import giftService from '~/services/gift.service'
import { uploadImageToCloudinary } from '~/services/cloudinary.service'

type UploadResult = { url?: string; publicId?: string }
type MaybeFile = Express.Multer.File | undefined
type MulterRequest = Request & { file?: Express.Multer.File; files?: Record<string, Express.Multer.File[]> }

const getUploadedFile = (req: Request): MaybeFile => {
  const mreq = req as MulterRequest
  if (mreq.file) return mreq.file
  if (mreq.files?.image?.[0]) return mreq.files.image[0]
  if (mreq.files?.file?.[0]) return mreq.files.file[0]
  return undefined
}

const normalizeGiftPayload = (body: Record<string, unknown>): GiftCreateRequest & { remainingQuantity?: number } => {
  const parseNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    const num = Number(value)
    return Number.isNaN(num) ? undefined : num
  }

  let items: GiftBundleItem[] =
    typeof body.items === 'string'
      ? (() => {
          try {
            return JSON.parse(body.items) as GiftBundleItem[]
          } catch {
            return []
          }
        })()
      : ((body.items as GiftBundleItem[] | undefined) ?? [])

  const rawItems = items
  const normalizedItems: GiftBundleItem[] = rawItems.map((raw) => {
    const item = raw as Partial<GiftBundleItem> & { itemId?: string | ObjectId; priceSnapshot?: number | string }
    const itemId = typeof item.itemId === 'string' ? new ObjectId(item.itemId) : item.itemId
    const priceSnapshot = item.priceSnapshot !== undefined ? Number(item.priceSnapshot) : item.priceSnapshot
    return {
      ...item,
      itemId,
      priceSnapshot,
      source: (item.source as 'fnb_menu' | 'fnb_menu_item') || 'fnb_menu_item'
    } as GiftBundleItem
  })

  return {
    name: typeof body.name === 'string' ? body.name : '',
    type: body.type as GiftCreateRequest['type'],
    image: typeof body.image === 'string' ? body.image : undefined,
    price: parseNumber(body.price),
    discountPercentage: parseNumber(body.discountPercentage),
    items: normalizedItems,
    totalQuantity: (parseNumber(body.totalQuantity) as number) || 0,
    remainingQuantity: parseNumber(body.remainingQuantity),
    isActive:
      body.isActive !== undefined
        ? body.isActive === 'true' || body.isActive === true || body.isActive === '1'
        : undefined
  }
}

export const listGifts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gifts = await giftService.listGifts()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.GET_GIFTS_SUCCESS,
      result: gifts
    })
  } catch (error) {
    next(error)
  }
}

export const createGift = async (
  req: Request<ParamsDictionary, unknown, GiftCreateRequest>,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = normalizeGiftPayload(req.body as unknown as Record<string, unknown>)
    const uploadFile = getUploadedFile(req)
    if (uploadFile) {
      const uploaded = (await uploadImageToCloudinary(uploadFile.buffer, 'gifts')) as UploadResult
      payload.image = uploaded.url
    }
    const gift = await giftService.createGift(payload)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: GIFT_MESSAGES.CREATE_GIFT_SUCCESS,
      result: gift
    })
  } catch (error) {
    next(error)
  }
}

export const getGiftById = async (
  req: Request<ParamsDictionary, unknown, unknown>,
  res: Response,
  next: NextFunction
) => {
  try {
    // req.params is untyped in express, cast to ensure id is treated as string
    const { id } = req.params as { id: string }
    const gift = await giftService.getGiftById(id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.GET_GIFT_BY_ID_SUCCESS,
      result: gift
    })
  } catch (error) {
    next(error)
  }
}

export const updateGift = async (
  req: Request<ParamsDictionary, unknown, GiftUpdateRequest>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const payload = normalizeGiftPayload(req.body as unknown as Record<string, unknown>)
    const uploadFile = getUploadedFile(req)
    if (uploadFile) {
      const uploaded = (await uploadImageToCloudinary(uploadFile.buffer, 'gifts')) as UploadResult
      payload.image = uploaded.url
    }
    const gift = await giftService.updateGift(id, payload)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.UPDATE_GIFT_SUCCESS,
      result: gift
    })
  } catch (error) {
    next(error)
  }
}

export const deleteGift = async (
  req: Request<ParamsDictionary, unknown, unknown>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const result = await giftService.deleteGift(id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.DELETE_GIFT_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const claimGiftForSchedule = async (
  req: Request<ParamsDictionary, unknown, { scheduleId: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { scheduleId } = req.body
    const gift = await giftService.claimRandomGift(scheduleId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.CLAIM_GIFT_SUCCESS,
      result: gift
    })
  } catch (error) {
    next(error)
  }
}

export const getGiftForRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomIndex } = req.params as { roomIndex: string }
    const result = await giftService.getGiftForRoom(Number(roomIndex))
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GIFT_MESSAGES.GET_ROOM_GIFT_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}
