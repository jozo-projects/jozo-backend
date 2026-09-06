import { Collection, MongoServerError, ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { MusicCategory } from '~/models/schemas/MusicCategory.schema'
import { Song } from '~/models/schemas/Song.schema'
import databaseService from './database.service'

type MusicCategoryDatabase = {
  musicCategories: Collection<MusicCategory>
  songs: Collection<Song>
}

export type CreateMusicCategoryInput = Pick<MusicCategory, 'name' | 'imageUrl'> &
  Partial<Pick<MusicCategory, 'imagePublicId' | 'isActive'>>
export type UpdateMusicCategoryInput = Partial<Pick<MusicCategory, 'name' | 'imageUrl' | 'imagePublicId' | 'isActive'>>

const badRequest = (message: string) => new ErrorWithStatus({ message, status: HTTP_STATUS_CODE.BAD_REQUEST })
const conflict = (message: string) => new ErrorWithStatus({ message, status: HTTP_STATUS_CODE.CONFLICT })
const notFound = (message = 'Không tìm thấy danh mục nhạc') =>
  new ErrorWithStatus({ message, status: HTTP_STATUS_CODE.NOT_FOUND })

const objectId = (value: string) => {
  if (!ObjectId.isValid(value)) throw badRequest('ID danh mục không hợp lệ')
  return new ObjectId(value)
}

const exactSet = (received: string[], expected: string[]) => {
  if (received.length !== new Set(received).size || received.length !== expected.length) return false
  const expectedSet = new Set(expected)
  return received.every((id) => expectedSet.has(id))
}

export const slugifyMusicCategoryName = (name: string) =>
  name
    .trim()
    .toLocaleLowerCase('vi')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export class MusicCategoryService {
  private readonly database: MusicCategoryDatabase

  constructor(database: MusicCategoryDatabase = databaseService) {
    this.database = database
  }

  async ensureIndexes() {
    await Promise.all([
      this.database.musicCategories.createIndex({ slug: 1 }, { unique: true }),
      this.database.musicCategories.createIndex({ position: 1, _id: 1 }),
      this.database.songs.createIndex({ 'categories.categoryId': 1 })
    ])
  }

  async listPublicCategories() {
    return this.database.musicCategories
      .find({ isActive: true }, { projection: { _id: 1, name: 1, slug: 1, imageUrl: 1, position: 1 } })
      .sort({ position: 1, _id: 1 })
      .toArray()
  }

  async getCategoryById(categoryId: string) {
    return this.database.musicCategories.findOne({ _id: objectId(categoryId) })
  }

  async listAdminCategories() {
    return this.database.musicCategories
      .aggregate<MusicCategory & { songCount: number }>([
        { $sort: { position: 1, _id: 1 } },
        {
          $lookup: {
            from: this.database.songs.collectionName,
            let: { categoryId: '$_id' },
            pipeline: [
              { $match: { $expr: { $in: ['$$categoryId', { $ifNull: ['$categories.categoryId', []] }] } } },
              { $count: 'count' }
            ],
            as: 'songStats'
          }
        },
        { $set: { songCount: { $ifNull: [{ $first: '$songStats.count' }, 0] } } },
        { $unset: 'songStats' }
      ])
      .toArray()
  }

  async createCategory(input: CreateMusicCategoryInput) {
    const now = new Date()
    const last = await this.database.musicCategories.find().sort({ position: -1 }).limit(1).next()
    const category: MusicCategory = {
      name: input.name.trim(),
      slug: slugifyMusicCategoryName(input.name),
      imageUrl: input.imageUrl,
      imagePublicId: input.imagePublicId,
      isActive: input.isActive ?? true,
      position: (last?.position ?? -1) + 1,
      createdAt: now,
      updatedAt: now
    }
    if (!category.slug) throw badRequest('Tên danh mục không hợp lệ')
    try {
      const result = await this.database.musicCategories.insertOne(category)
      return { ...category, _id: result.insertedId }
    } catch (error) {
      this.rethrowDuplicateSlug(error)
    }
  }

  async updateCategory(categoryId: string, input: UpdateMusicCategoryInput) {
    const id = objectId(categoryId)
    const update: UpdateMusicCategoryInput & { slug?: string; updatedAt: Date } = { updatedAt: new Date() }
    if (input.name !== undefined) {
      update.name = input.name.trim()
      update.slug = slugifyMusicCategoryName(input.name)
      if (!update.slug) throw badRequest('Tên danh mục không hợp lệ')
    }
    if (input.imageUrl !== undefined) update.imageUrl = input.imageUrl
    if (input.imagePublicId !== undefined) update.imagePublicId = input.imagePublicId
    if (input.isActive !== undefined) update.isActive = input.isActive
    try {
      const result = await this.database.musicCategories.findOneAndUpdate(
        { _id: id },
        { $set: update },
        { returnDocument: 'after' }
      )
      if (!result) throw notFound()
      return result
    } catch (error) {
      this.rethrowDuplicateSlug(error)
    }
  }

  async deleteCategory(categoryId: string) {
    const id = objectId(categoryId)
    const category = await this.database.musicCategories.findOneAndDelete({ _id: id })
    await this.removeCategoryReferences(id)
    if (!category) throw notFound()
    return category
  }

  async reorderCategories(categoryIds: string[]) {
    const ids = categoryIds.map(objectId)
    const current = await this.database.musicCategories.find({}, { projection: { _id: 1 } }).toArray()
    if (
      !exactSet(
        categoryIds,
        current.map((item) => item._id!.toString())
      )
    ) {
      throw conflict('Danh sách danh mục đã thay đổi, vui lòng tải lại')
    }
    if (ids.length) {
      await this.database.musicCategories.bulkWrite(
        ids.map((id, position) => ({
          updateOne: { filter: { _id: id }, update: { $set: { position, updatedAt: new Date() } } }
        }))
      )
    }
    return this.listAdminCategories()
  }

  async listCategorySongs(
    categoryId: string,
    options: { page?: number; limit?: number; keyword?: string; admin?: boolean } = {}
  ) {
    const id = objectId(categoryId)
    const category = await this.database.musicCategories.findOne({
      _id: id,
      ...(options.admin ? {} : { isActive: true })
    })
    if (!category) throw notFound()
    const page = Math.max(1, options.page ?? 1)
    const limit = Math.min(500, Math.max(1, options.limit ?? 50))
    const keyword = options.keyword?.trim()
    const escapedKeyword = keyword?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = keyword
      ? {
          $or: [
            { title: { $regex: escapedKeyword, $options: 'i' } },
            { author: { $regex: escapedKeyword, $options: 'i' } },
            { video_id: { $regex: escapedKeyword, $options: 'i' } }
          ]
        }
      : {}
    const publicProjection = options.admin
      ? []
      : [
          {
            $project: {
              _id: 0,
              video_id: 1,
              title: 1,
              author: 1,
              thumbnail: { $ifNull: ['$thumbnail', ''] },
              duration: { $ifNull: ['$duration', 0] },
              url: { $ifNull: ['$url', { $concat: ['https://www.youtube.com/watch?v=', '$video_id'] }] }
            }
          }
        ]
    const [result] = await this.database.songs
      .aggregate<{ songs: Array<Song & { categoryPosition: number }>; total: Array<{ count: number }> }>([
        { $match: { 'categories.categoryId': id, ...match } },
        {
          $set: {
            categoryPosition: {
              $let: {
                vars: {
                  assignment: {
                    $first: {
                      $filter: { input: '$categories', as: 'category', cond: { $eq: ['$$category.categoryId', id] } }
                    }
                  }
                },
                in: '$$assignment.position'
              }
            }
          }
        },
        { $sort: { categoryPosition: 1, _id: 1 } },
        ...publicProjection,
        {
          $facet: {
            songs: [{ $skip: (page - 1) * limit }, { $limit: limit }],
            total: [{ $count: 'count' }]
          }
        }
      ])
      .toArray()
    const total = result?.total[0]?.count ?? 0
    const totalPages = Math.ceil(total / limit)
    return {
      songs: result?.songs ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    }
  }

  async assignSongs(categoryId: string, videoIds: string[]) {
    const id = objectId(categoryId)
    if (!(await this.database.musicCategories.findOne({ _id: id }))) {
      await this.removeCategoryReferences(id)
      throw notFound()
    }
    const uniqueVideoIds = [...new Set(videoIds)]
    const songs = await this.database.songs
      .find({ video_id: { $in: uniqueVideoIds } }, { projection: { video_id: 1, categories: 1 } })
      .toArray()
    if (
      !exactSet(
        uniqueVideoIds,
        songs.map((item) => item.video_id)
      )
    ) {
      throw badRequest('Một hoặc nhiều bài hát không tồn tại trong thư viện')
    }
    const existing = await this.database.songs
      .find({ 'categories.categoryId': id }, { projection: { categories: 1 } })
      .toArray()
    const maxPosition = existing.reduce((max, item) => {
      const assignment = item.categories?.find((entry) => entry.categoryId.equals(id))
      return Math.max(max, assignment?.position ?? -1)
    }, -1)
    const additions = songs.filter((item) => !item.categories?.some((entry) => entry.categoryId.equals(id)))
    let assignedCount = 0
    if (additions.length) {
      const result = await this.database.songs.bulkWrite(
        additions.map((item, index) => ({
          updateOne: {
            filter: { _id: item._id, categories: { $not: { $elemMatch: { categoryId: id } } } },
            update: { $push: { categories: { categoryId: id, position: maxPosition + index + 1 } } }
          }
        }))
      )
      assignedCount = result.modifiedCount
    }
    if (!(await this.database.musicCategories.findOne({ _id: id }))) {
      await this.removeCategoryReferences(id)
      throw conflict('Danh mục đã bị xóa trong khi thêm bài hát, vui lòng tải lại')
    }
    return { assignedCount }
  }

  async removeSongs(categoryId: string, videoIds: string[]) {
    const id = objectId(categoryId)
    if (!(await this.database.musicCategories.findOne({ _id: id }))) throw notFound()
    const result = await this.database.songs.updateMany(
      { video_id: { $in: [...new Set(videoIds)] }, 'categories.categoryId': id },
      { $pull: { categories: { categoryId: id } } }
    )
    return { removedCount: result.modifiedCount }
  }

  async reorderSongs(categoryId: string, videoIds: string[]) {
    const id = objectId(categoryId)
    if (!(await this.database.musicCategories.findOne({ _id: id }))) throw notFound()
    const assigned = await this.database.songs
      .find({ 'categories.categoryId': id }, { projection: { video_id: 1 } })
      .toArray()
    if (
      !exactSet(
        videoIds,
        assigned.map((item) => item.video_id)
      )
    ) {
      throw conflict('Danh sách bài hát đã thay đổi, vui lòng tải lại')
    }
    if (videoIds.length) {
      await this.database.songs.bulkWrite(
        videoIds.map((videoId, position) => ({
          updateOne: {
            filter: { video_id: videoId, 'categories.categoryId': id },
            update: { $set: { 'categories.$[category].position': position } },
            arrayFilters: [{ 'category.categoryId': id }]
          }
        }))
      )
    }
    return { reorderedCount: videoIds.length }
  }

  private async removeCategoryReferences(categoryId: ObjectId) {
    await this.database.songs.updateMany(
      { 'categories.categoryId': categoryId },
      { $pull: { categories: { categoryId } } }
    )
  }

  private rethrowDuplicateSlug(error: unknown): never {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new ErrorWithStatus({ message: 'Tên danh mục đã tồn tại', status: HTTP_STATUS_CODE.CONFLICT })
    }
    throw error
  }
}

export const musicCategoryService = new MusicCategoryService()

let initializationPromise: Promise<void> | undefined

export const initializeMusicCategoryFeature = async () => {
  if (!initializationPromise) {
    initializationPromise = musicCategoryService.ensureIndexes().catch((error) => {
      initializationPromise = undefined
      throw error
    })
  }
  await initializationPromise
}
