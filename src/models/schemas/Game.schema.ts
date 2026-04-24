import { ObjectId } from 'mongodb'

export interface IGame {
  _id?: ObjectId
  typeId: ObjectId
  name: string
  slug: string
  shortDescription?: string
  guideContent: string
  minPlayers: number
  maxPlayers: number
  playTimeMinutes: number
  images: string[]
  isActive: boolean
  createdAt: Date
  updatedAt?: Date
}

export class Game implements IGame {
  _id?: ObjectId
  typeId: ObjectId
  name: string
  slug: string
  shortDescription?: string
  guideContent: string
  minPlayers: number
  maxPlayers: number
  playTimeMinutes: number
  images: string[]
  isActive: boolean
  createdAt: Date
  updatedAt?: Date

  constructor(game: IGame) {
    this._id = game._id
    this.typeId = game.typeId
    this.name = game.name
    this.slug = game.slug
    this.shortDescription = game.shortDescription
    this.guideContent = game.guideContent
    this.minPlayers = game.minPlayers
    this.maxPlayers = game.maxPlayers
    this.playTimeMinutes = game.playTimeMinutes
    this.images = game.images
    this.isActive = game.isActive
    this.createdAt = game.createdAt
    this.updatedAt = game.updatedAt
  }
}
