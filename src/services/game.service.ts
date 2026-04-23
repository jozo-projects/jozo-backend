import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  ICreateGameRequestBody,
  ICreateGameTypeRequestBody,
  IUpdateGameRequestBody,
  IUpdateGameTypeRequestBody
} from '~/models/requests/Game.request'
import { Game } from '~/models/schemas/Game.schema'
import { GameType } from '~/models/schemas/GameType.schema'
import databaseService from './database.service'

interface GetGamesQuery {
  typeId?: string
  isActive?: boolean
  keyword?: string
}

interface GameTypeLabel {
  slug: string
  name: string
  description?: string
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')

class GameService {
  private buildGameTypeLabel(type: { slug?: string; name?: string; description?: string } | null): GameTypeLabel | null {
    if (!type?.slug || !type?.name) {
      return null
    }

    return {
      slug: type.slug,
      name: type.name,
      description: type.description
    }
  }

  async createGameType(payload: ICreateGameTypeRequestBody) {
    const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name)
    const existed = await databaseService.gameTypes.findOne({ slug })
    if (existed) {
      throw new ErrorWithStatus({
        message: 'Game type slug already exists',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const now = new Date()
    const gameType = new GameType({
      name: payload.name.trim(),
      slug,
      description: payload.description?.trim(),
      image: payload.image,
      isActive: payload.isActive ?? true,
      createdAt: now,
      updatedAt: now
    })

    const result = await databaseService.gameTypes.insertOne(gameType)
    return { ...gameType, _id: result.insertedId }
  }

  async getGameTypes() {
    const types = await databaseService.gameTypes.find({}).sort({ createdAt: -1 }).toArray()
    const gameCounts = await databaseService.games
      .aggregate<{ _id: ObjectId; totalGames: number }>([
        { $group: { _id: '$typeId', totalGames: { $sum: 1 } } }
      ])
      .toArray()

    const countMap = new Map(gameCounts.map((item) => [item._id.toString(), item.totalGames]))
    return types.map((type) => ({
      ...type,
      totalGames: countMap.get(type._id?.toString() || '') || 0
    }))
  }

  async getGameTypeById(id: string) {
    const gameType = await databaseService.gameTypes.findOne({ _id: new ObjectId(id) })
    if (!gameType) {
      throw new ErrorWithStatus({
        message: 'Game type not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return gameType
  }

  async updateGameType(id: string, payload: IUpdateGameTypeRequestBody) {
    const current = await databaseService.gameTypes.findOne({ _id: new ObjectId(id) })
    if (!current) {
      throw new ErrorWithStatus({
        message: 'Game type not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    let nextSlug: string | undefined
    if (payload.slug || payload.name) {
      nextSlug = slugify(payload.slug || payload.name || current.name)
      const duplicated = await databaseService.gameTypes.findOne({
        slug: nextSlug,
        _id: { $ne: new ObjectId(id) }
      })
      if (duplicated) {
        throw new ErrorWithStatus({
          message: 'Game type slug already exists',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
    }

    const updateDoc = {
      ...(payload.name ? { name: payload.name.trim() } : {}),
      ...(nextSlug ? { slug: nextSlug } : {}),
      ...(payload.description !== undefined ? { description: payload.description?.trim() } : {}),
      ...(payload.image !== undefined ? { image: payload.image } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      updatedAt: new Date()
    }

    await databaseService.gameTypes.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc })
    return { ...current, ...updateDoc, _id: current._id }
  }

  async deleteGameType(id: string) {
    const totalGames = await databaseService.games.countDocuments({ typeId: new ObjectId(id) })
    if (totalGames > 0) {
      throw new ErrorWithStatus({
        message: 'Cannot delete game type that still has games',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const result = await databaseService.gameTypes.deleteOne({ _id: new ObjectId(id) })
    if (result.deletedCount === 0) {
      throw new ErrorWithStatus({
        message: 'Game type not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return result
  }

  async createGame(payload: ICreateGameRequestBody) {
    const typeObjectId = new ObjectId(payload.typeId)
    const gameType = await databaseService.gameTypes.findOne({ _id: typeObjectId })
    if (!gameType) {
      throw new ErrorWithStatus({
        message: 'Game type not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name)
    const duplicated = await databaseService.games.findOne({
      slug,
      typeId: typeObjectId
    })
    if (duplicated) {
      throw new ErrorWithStatus({
        message: 'Game slug already exists in this type',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const now = new Date()
    const game = new Game({
      typeId: typeObjectId,
      name: payload.name.trim(),
      slug,
      shortDescription: payload.shortDescription?.trim(),
      guideContent: payload.guideContent,
      images: payload.images || [],
      isActive: payload.isActive ?? true,
      createdAt: now,
      updatedAt: now
    })

    const result = await databaseService.games.insertOne(game)
    return {
      ...game,
      _id: result.insertedId,
      gameTypeLabel: this.buildGameTypeLabel(gameType)
    }
  }

  async getGames(query: GetGamesQuery) {
    const filter: {
      typeId?: ObjectId
      isActive?: boolean
      $or?: Array<Record<string, { $regex: string; $options: string }>>
    } = {}

    if (query.typeId) {
      filter.typeId = new ObjectId(query.typeId)
    }
    if (typeof query.isActive === 'boolean') {
      filter.isActive = query.isActive
    }
    if (query.keyword) {
      filter.$or = [
        { name: { $regex: query.keyword, $options: 'i' } },
        { shortDescription: { $regex: query.keyword, $options: 'i' } },
        { guideContent: { $regex: query.keyword, $options: 'i' } }
      ]
    }

    return await databaseService.games
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'game_types',
            localField: 'typeId',
            foreignField: '_id',
            as: 'type'
          }
        },
        { $unwind: { path: '$type', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            gameTypeLabel: {
              slug: '$type.slug',
              name: '$type.name',
              description: '$type.description'
            }
          }
        },
        {
          $project: {
            type: 0
          }
        },
        { $sort: { createdAt: -1 } }
      ])
      .toArray()
  }

  async getGameById(id: string) {
    const result = await databaseService.games
      .aggregate([
        { $match: { _id: new ObjectId(id) } },
        {
          $lookup: {
            from: 'game_types',
            localField: 'typeId',
            foreignField: '_id',
            as: 'type'
          }
        },
        { $unwind: { path: '$type', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            gameTypeLabel: {
              slug: '$type.slug',
              name: '$type.name',
              description: '$type.description'
            }
          }
        },
        {
          $project: {
            type: 0
          }
        }
      ])
      .toArray()

    if (!result.length) {
      throw new ErrorWithStatus({
        message: 'Game not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return result[0]
  }

  async updateGame(id: string, payload: IUpdateGameRequestBody) {
    const current = await databaseService.games.findOne({ _id: new ObjectId(id) })
    if (!current) {
      throw new ErrorWithStatus({
        message: 'Game not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const nextTypeId = payload.typeId ? new ObjectId(payload.typeId) : current.typeId
    let nextGameType = payload.typeId ? null : await databaseService.gameTypes.findOne({ _id: current.typeId })
    if (payload.typeId) {
      const gameType = await databaseService.gameTypes.findOne({ _id: nextTypeId })
      if (!gameType) {
        throw new ErrorWithStatus({
          message: 'Game type not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }
      nextGameType = gameType
    }

    let nextSlug: string | undefined
    if (payload.slug || payload.name || payload.typeId) {
      nextSlug = slugify(payload.slug || payload.name || current.name)
      const duplicated = await databaseService.games.findOne({
        slug: nextSlug,
        typeId: nextTypeId,
        _id: { $ne: new ObjectId(id) }
      })
      if (duplicated) {
        throw new ErrorWithStatus({
          message: 'Game slug already exists in this type',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
    }

    const updateDoc = {
      ...(payload.typeId ? { typeId: nextTypeId } : {}),
      ...(payload.name ? { name: payload.name.trim() } : {}),
      ...(nextSlug ? { slug: nextSlug } : {}),
      ...(payload.shortDescription !== undefined ? { shortDescription: payload.shortDescription?.trim() } : {}),
      ...(payload.guideContent !== undefined ? { guideContent: payload.guideContent } : {}),
      ...(payload.images !== undefined ? { images: payload.images } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      updatedAt: new Date()
    }

    await databaseService.games.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc })
    return {
      ...current,
      ...updateDoc,
      _id: current._id,
      gameTypeLabel: this.buildGameTypeLabel(nextGameType)
    }
  }

  async deleteGame(id: string) {
    const result = await databaseService.games.deleteOne({ _id: new ObjectId(id) })
    if (result.deletedCount === 0) {
      throw new ErrorWithStatus({
        message: 'Game not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return result
  }
}

const gameService = new GameService()
export default gameService
