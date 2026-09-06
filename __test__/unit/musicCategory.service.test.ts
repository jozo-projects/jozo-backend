import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MusicCategoryService } from '~/services/musicCategory.service'

let mongod: MongoMemoryServer
let client: MongoClient
let service: MusicCategoryService
let db: ReturnType<MongoClient['db']>

const song = (video_id: string) => ({
  video_id,
  title: video_id,
  author: 'author',
  thumbnail: undefined,
  duration: undefined,
  url: undefined,
  title_normalized: `${video_id}-normalized`,
  imagePublicId: 'must-not-leak',
  created_at: new Date(),
  updated_at: new Date()
})

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('music-category-tests')
  service = new MusicCategoryService({
    musicCategories: db.collection('musicCategories'),
    songs: db.collection('songs')
  })
  await service.ensureIndexes()
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([db.collection('musicCategories').deleteMany({}), db.collection('songs').deleteMany({})])
})

describe('MusicCategoryService', () => {
  it('lists only active categories in stable position order and admin counts', async () => {
    const first = await service.createCategory({ name: 'Nhạc Trẻ', imageUrl: 'one.jpg', isActive: true })
    const hidden = await service.createCategory({ name: 'Ẩn', imageUrl: 'hidden.jpg', isActive: false })
    const last = await service.createCategory({ name: 'Acoustic', imageUrl: 'two.jpg', isActive: true })
    await db.collection('songs').insertMany([song('one'), song('two')])
    await service.assignSongs(first._id!.toString(), ['one', 'two'])

    const publicCategories = await service.listPublicCategories()
    const adminCategories = await service.listAdminCategories()

    expect(publicCategories.map((item) => item.name)).toEqual(['Nhạc Trẻ', 'Acoustic'])
    expect(publicCategories.map((item) => item.position)).toEqual([0, 2])
    expect(Object.keys(publicCategories[0]).sort()).toEqual(['_id', 'imageUrl', 'name', 'position', 'slug'])
    expect(adminCategories.find((item) => item._id!.equals(first._id!))?.songCount).toBe(2)
    expect(last.slug).toBe('acoustic')
    await expect(service.listCategorySongs(hidden._id!.toString())).rejects.toMatchObject({ status: 404 })
  })

  it('assigns one song to multiple categories and prevents duplicates within one category', async () => {
    const categoryA = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    const categoryB = await service.createCategory({ name: 'B', imageUrl: 'b.jpg' })
    await db.collection('songs').insertOne(song('video-1'))

    await service.assignSongs(categoryA._id!.toString(), ['video-1', 'video-1'])
    await service.assignSongs(categoryA._id!.toString(), ['video-1'])
    await service.assignSongs(categoryB._id!.toString(), ['video-1'])

    const stored = await db.collection('songs').findOne({ video_id: 'video-1' })
    expect(stored?.categories).toHaveLength(2)
    expect(
      stored?.categories.filter((item: { categoryId: ObjectId }) => item.categoryId.equals(categoryA._id))
    ).toHaveLength(1)
  })

  it('removes assignment from only the requested category', async () => {
    const categoryA = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    const categoryB = await service.createCategory({ name: 'B', imageUrl: 'b.jpg' })
    await db.collection('songs').insertOne(song('video-1'))
    await service.assignSongs(categoryA._id!.toString(), ['video-1'])
    await service.assignSongs(categoryB._id!.toString(), ['video-1'])

    await service.removeSongs(categoryA._id!.toString(), ['video-1'])

    const stored = await db.collection('songs').findOne({ video_id: 'video-1' })
    expect(stored?.categories).toHaveLength(1)
    expect(stored?.categories[0].categoryId.equals(categoryB._id)).toBe(true)
  })

  it('requires the exact category set when reordering', async () => {
    const categoryA = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    const categoryB = await service.createCategory({ name: 'B', imageUrl: 'b.jpg' })

    await expect(service.reorderCategories([categoryA._id!.toString()])).rejects.toMatchObject({ status: 409 })
    await service.reorderCategories([categoryB._id!.toString(), categoryA._id!.toString()])

    expect((await service.listAdminCategories()).map((item) => item.name)).toEqual(['B', 'A'])
  })

  it('requires the exact assigned song set when reordering and returns ordered paginated songs', async () => {
    const category = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    await db.collection('songs').insertMany([song('one'), song('two')])
    await service.assignSongs(category._id!.toString(), ['one', 'two'])

    await expect(service.reorderSongs(category._id!.toString(), ['one'])).rejects.toMatchObject({ status: 409 })
    await service.reorderSongs(category._id!.toString(), ['two', 'one'])

    const result = await service.listCategorySongs(category._id!.toString(), { page: 1, limit: 10, admin: true })
    expect(result.songs.map((item) => item.video_id)).toEqual(['two', 'one'])
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    })
  })

  it('returns only queue-compatible public songs with defaults while admin reads stay rich', async () => {
    const category = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    await db.collection('songs').insertOne(song('one'))
    await service.assignSongs(category._id!.toString(), ['one'])

    const publicResult = await service.listCategorySongs(category._id!.toString())
    const adminResult = await service.listCategorySongs(category._id!.toString(), { admin: true })

    expect(publicResult.songs).toEqual([
      {
        video_id: 'one',
        title: 'one',
        author: 'author',
        thumbnail: '',
        duration: 0,
        url: 'https://www.youtube.com/watch?v=one'
      }
    ])
    expect(adminResult.songs[0]).toMatchObject({ title_normalized: 'one-normalized', categories: expect.any(Array) })
  })

  it('accepts empty reorder lists when the corresponding collection is empty', async () => {
    await expect(service.reorderCategories([])).resolves.toEqual([])
    const category = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    await expect(service.reorderSongs(category._id!.toString(), [])).resolves.toEqual({ reorderedCount: 0 })
  })

  it('rejects assignment when any video ID does not exist', async () => {
    const category = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    await db.collection('songs').insertOne(song('one'))

    await expect(service.assignSongs(category._id!.toString(), ['one', 'missing'])).rejects.toMatchObject({
      status: 400
    })
  })

  it('deletes a category and cleans song references without deleting songs', async () => {
    const category = await service.createCategory({ name: 'A', imageUrl: 'a.jpg' })
    await db.collection('songs').insertOne(song('one'))
    await service.assignSongs(category._id!.toString(), ['one'])

    await service.deleteCategory(category._id!.toString())

    expect(await db.collection('musicCategories').countDocuments()).toBe(0)
    expect(await db.collection('songs').countDocuments()).toBe(1)
    expect((await db.collection('songs').findOne({ video_id: 'one' }))?.categories ?? []).toHaveLength(0)
  })

  it('deletes the category document before cleaning song references', async () => {
    const order: string[] = []
    const id = new ObjectId()
    const category = { _id: id, name: 'A' }
    const raceService = new MusicCategoryService({
      musicCategories: {
        findOneAndDelete: jest.fn(async () => {
          order.push('delete-category')
          return category
        })
      },
      songs: {
        updateMany: jest.fn(async () => {
          order.push('pull-references')
          return { modifiedCount: 1 }
        })
      }
    } as never)

    await expect(raceService.deleteCategory(id.toString())).resolves.toBe(category)
    expect(order).toEqual(['delete-category', 'pull-references'])
  })

  it('cleans dangling references when delete is retried after the category is gone', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 })
    const raceService = new MusicCategoryService({
      musicCategories: { findOneAndDelete: jest.fn().mockResolvedValue(null) },
      songs: { updateMany }
    } as never)

    await expect(raceService.deleteCategory(new ObjectId().toString())).rejects.toMatchObject({ status: 404 })
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('cleans assignments and reports conflict when category deletion races assignment', async () => {
    const id = new ObjectId()
    const songId = new ObjectId()
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 })
    const bulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 1 })
    const findOne = jest.fn().mockResolvedValueOnce({ _id: id }).mockResolvedValueOnce(null)
    const raceService = new MusicCategoryService({
      musicCategories: { findOne },
      songs: {
        find: jest
          .fn()
          .mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue([{ _id: songId, video_id: 'one', categories: [] }])
          })
          .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) }),
        bulkWrite,
        updateMany
      }
    } as never)

    await expect(raceService.assignSongs(id.toString(), ['one'])).rejects.toMatchObject({ status: 409 })
    expect(bulkWrite).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith(
      { 'categories.categoryId': id },
      { $pull: { categories: { categoryId: id } } }
    )
  })

  it('cleans dangling references when assignment is retried after the category is gone', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 })
    const raceService = new MusicCategoryService({
      musicCategories: { findOne: jest.fn().mockResolvedValue(null) },
      songs: { updateMany }
    } as never)

    await expect(raceService.assignSongs(new ObjectId().toString(), ['one'])).rejects.toMatchObject({ status: 404 })
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('uses bulkWrite modifiedCount for assignedCount', async () => {
    const id = new ObjectId()
    const songId = new ObjectId()
    const raceService = new MusicCategoryService({
      musicCategories: { findOne: jest.fn().mockResolvedValue({ _id: id }) },
      songs: {
        find: jest
          .fn()
          .mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue([{ _id: songId, video_id: 'one', categories: [] }])
          })
          .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) }),
        bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 0 })
      }
    } as never)

    await expect(raceService.assignSongs(id.toString(), ['one'])).resolves.toEqual({ assignedCount: 0 })
  })

  it('generates Vietnamese-safe unique slugs and maps duplicates to conflict', async () => {
    expect((await service.createCategory({ name: 'Nhạc Trữ Tình Đêm', imageUrl: 'a.jpg' })).slug).toBe(
      'nhac-tru-tinh-dem'
    )
    await expect(service.createCategory({ name: 'Nhạc Trữ Tình Đêm', imageUrl: 'b.jpg' })).rejects.toMatchObject({
      status: 409
    })
  })
})
