import { ObjectId } from 'mongodb'

export interface IGameType {
  _id?: ObjectId
  name: string
  slug: string
  description?: string
  image?: string
  isActive: boolean
  createdAt: Date
  updatedAt?: Date
}

export class GameType implements IGameType {
  _id?: ObjectId
  name: string
  slug: string
  description?: string
  image?: string
  isActive: boolean
  createdAt: Date
  updatedAt?: Date

  constructor(gameType: IGameType) {
    this._id = gameType._id
    this.name = gameType.name
    this.slug = gameType.slug
    this.description = gameType.description
    this.image = gameType.image
    this.isActive = gameType.isActive
    this.createdAt = gameType.createdAt
    this.updatedAt = gameType.updatedAt
  }
}
