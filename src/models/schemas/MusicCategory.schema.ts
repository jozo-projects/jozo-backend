import { ObjectId } from 'mongodb'

export interface MusicCategory {
  _id?: ObjectId
  name: string
  slug: string
  imageUrl: string
  imagePublicId?: string
  isActive: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}

export class MusicCategorySchema implements MusicCategory {
  _id?: ObjectId
  name: string
  slug: string
  imageUrl: string
  imagePublicId?: string
  isActive: boolean
  position: number
  createdAt: Date
  updatedAt: Date

  constructor(category: MusicCategory) {
    this._id = category._id
    this.name = category.name
    this.slug = category.slug
    this.imageUrl = category.imageUrl
    this.imagePublicId = category.imagePublicId
    this.isActive = category.isActive
    this.position = category.position
    this.createdAt = category.createdAt
    this.updatedAt = category.updatedAt
  }
}
