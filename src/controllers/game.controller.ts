import { NextFunction, Request, Response, Express } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { GAME_MESSAGES } from '~/constants/messages'
import {
  ICreateGameRequestBody,
  ICreateGameTypeRequestBody,
  IUpdateGameRequestBody,
  IUpdateGameTypeRequestBody
} from '~/models/requests/Game.request'
import { uploadImageToCloudinary } from '~/services/cloudinary.service'
import gameService from '~/services/game.service'

type UploadResult = { url?: string }
type MulterRequest = Request & { file?: Express.Multer.File; files?: Express.Multer.File[] }

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

const parseStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean)
        }
      } catch {
        return [trimmed]
      }
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return undefined
}

const normalizeCreateGameTypePayload = (body: Record<string, unknown>): ICreateGameTypeRequestBody => ({
  name: String(body.name || '').trim(),
  slug: typeof body.slug === 'string' ? body.slug : undefined,
  description: typeof body.description === 'string' ? body.description : undefined,
  image: typeof body.image === 'string' ? body.image : undefined,
  isActive: parseBoolean(body.isActive)
})

const normalizeUpdateGameTypePayload = (body: Record<string, unknown>): IUpdateGameTypeRequestBody => ({
  name: typeof body.name === 'string' ? body.name : undefined,
  slug: typeof body.slug === 'string' ? body.slug : undefined,
  description: typeof body.description === 'string' ? body.description : undefined,
  image: typeof body.image === 'string' ? body.image : undefined,
  isActive: parseBoolean(body.isActive)
})

const normalizeCreateGamePayload = (body: Record<string, unknown>): ICreateGameRequestBody => ({
  typeId: String(body.typeId || ''),
  name: String(body.name || '').trim(),
  slug: typeof body.slug === 'string' ? body.slug : undefined,
  shortDescription: typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
  guideContent: String(body.guideContent || ''),
  images: parseStringArray(body.images),
  isActive: parseBoolean(body.isActive)
})

const normalizeUpdateGamePayload = (body: Record<string, unknown>): IUpdateGameRequestBody => ({
  typeId: typeof body.typeId === 'string' ? body.typeId : undefined,
  name: typeof body.name === 'string' ? body.name : undefined,
  slug: typeof body.slug === 'string' ? body.slug : undefined,
  shortDescription: typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
  guideContent: typeof body.guideContent === 'string' ? body.guideContent : undefined,
  images: parseStringArray(body.images),
  isActive: parseBoolean(body.isActive)
})

export const createGameTypeController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = normalizeCreateGameTypePayload(req.body as Record<string, unknown>)
    const file = (req as MulterRequest).file
    if (file) {
      const uploaded = (await uploadImageToCloudinary(file.buffer, 'game-types')) as UploadResult
      payload.image = uploaded.url
    }

    const result = await gameService.createGameType(payload)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: GAME_MESSAGES.CREATE_GAME_TYPE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getGameTypesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.getGameTypes()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.GET_GAME_TYPES_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getGameTypeByIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.getGameTypeById(req.params.typeId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.GET_GAME_TYPE_BY_ID_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const updateGameTypeController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = normalizeUpdateGameTypePayload(req.body as Record<string, unknown>)
    const file = (req as MulterRequest).file
    if (file) {
      const uploaded = (await uploadImageToCloudinary(file.buffer, 'game-types')) as UploadResult
      payload.image = uploaded.url
    }

    const result = await gameService.updateGameType(req.params.typeId, payload)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.UPDATE_GAME_TYPE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const deleteGameTypeController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.deleteGameType(req.params.typeId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.DELETE_GAME_TYPE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const createGameController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = normalizeCreateGamePayload(req.body as Record<string, unknown>)
    const files = ((req as MulterRequest).files || []) as Express.Multer.File[]
    if (files.length > 0) {
      const uploaded = await Promise.all(files.map((file) => uploadImageToCloudinary(file.buffer, 'games')))
      const uploadedUrls = uploaded
        .map((item) => (item as UploadResult).url)
        .filter((url): url is string => typeof url === 'string')
      payload.images = [...(payload.images || []), ...uploadedUrls]
    }

    const result = await gameService.createGame(payload)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: GAME_MESSAGES.CREATE_GAME_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getGamesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isActive =
      typeof req.query.isActive === 'string'
        ? req.query.isActive === 'true'
          ? true
          : req.query.isActive === 'false'
            ? false
            : undefined
        : undefined

    const result = await gameService.getGames({
      typeId: typeof req.query.typeId === 'string' ? req.query.typeId : undefined,
      keyword: typeof req.query.keyword === 'string' ? req.query.keyword.trim() : undefined,
      isActive
    })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.GET_GAMES_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getGameByIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.getGameById(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.GET_GAME_BY_ID_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const updateGameController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = normalizeUpdateGamePayload(req.body as Record<string, unknown>)
    const files = ((req as MulterRequest).files || []) as Express.Multer.File[]
    if (files.length > 0) {
      const uploaded = await Promise.all(files.map((file) => uploadImageToCloudinary(file.buffer, 'games')))
      const uploadedUrls = uploaded
        .map((item) => (item as UploadResult).url)
        .filter((url): url is string => typeof url === 'string')
      payload.images = [...(payload.images || []), ...uploadedUrls]
    }

    const result = await gameService.updateGame(req.params.id, payload)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.UPDATE_GAME_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const deleteGameController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gameService.deleteGame(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: GAME_MESSAGES.DELETE_GAME_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}
