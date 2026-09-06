import express from 'express'
import request from 'supertest'
import { UserRole } from '~/constants/enum'
import { ErrorWithStatus } from '~/models/Error'
import { defaultErrorHandler } from '~/middlewares/error.middleware'
import { createMusicCategoryRouter } from '~/routes/musicCategory.routes'
import { musicCategoryService } from '~/services/musicCategory.service'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'

jest.mock('~/utils/jwt', () => ({ verifyToken: jest.fn() }))
jest.mock('~/services/cloudinary.service', () => ({
  uploadImageToCloudinary: jest.fn().mockResolvedValue({ url: 'image.jpg', publicId: 'image-id' }),
  deleteImageFromCloudinary: jest.fn()
}))

const app = express()
app.use(express.json())
app.use(
  '/room-music/music-categories',
  createMusicCategoryRouter(async () => undefined)
)
app.use(defaultErrorHandler)

describe('music category routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('awaits feature index initialization before serving a category handler', async () => {
    const order: string[] = []
    const isolatedApp = express()
    jest.spyOn(musicCategoryService, 'listPublicCategories').mockImplementation(async () => {
      order.push('handler')
      return []
    })
    isolatedApp.use(
      '/categories',
      createMusicCategoryRouter(async () => {
        await Promise.resolve()
        order.push('indexes')
      })
    )

    expect((await request(isolatedApp).get('/categories')).status).toBe(200)
    expect(order).toEqual(['indexes', 'handler'])
  })

  it('protects admin endpoints', async () => {
    const response = await request(app).get('/room-music/music-categories/admin')
    expect(response.status).toBe(401)
  })

  it('requires an image when creating a category', async () => {
    jest.mocked(verifyToken).mockResolvedValue({ user_id: 'admin' } as never)
    jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role: UserRole.Admin } as never)

    const response = await request(app)
      .post('/room-music/music-categories')
      .set('Authorization', 'Bearer valid')
      .field('name', 'Nhạc trẻ')

    expect(response.status).toBe(422)
    expect(response.body.errors).toHaveProperty('image')
  })

  it('parses multipart boolean values before calling create', async () => {
    jest.mocked(verifyToken).mockResolvedValue({ user_id: 'admin' } as never)
    jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role: UserRole.Admin } as never)
    const create = jest.spyOn(musicCategoryService, 'createCategory').mockResolvedValue({} as never)

    const response = await request(app)
      .post('/room-music/music-categories')
      .set('Authorization', 'Bearer valid')
      .field('name', 'Nhạc trẻ')
      .field('isActive', 'false')
      .attach('image', png, { filename: 'image.png', contentType: 'image/png' })

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }))
  })

  it('returns 404 when public song listing targets an inactive category', async () => {
    jest
      .spyOn(musicCategoryService, 'listCategorySongs')
      .mockRejectedValue(new ErrorWithStatus({ message: 'Không tìm thấy danh mục nhạc', status: 404 }))

    const response = await request(app).get(
      '/room-music/music-categories/507f1f77bcf86cd799439011/songs?page=1&limit=50'
    )

    expect(response.status).toBe(404)
  })

  it('accepts JPEG, PNG, and WebP content with matching magic bytes', async () => {
    jest.mocked(verifyToken).mockResolvedValue({ user_id: 'admin' } as never)
    jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role: UserRole.Admin } as never)
    jest.spyOn(musicCategoryService, 'createCategory').mockResolvedValue({} as never)
    const fixtures = [
      { bytes: Buffer.from([0xff, 0xd8, 0xff]), filename: 'test.jpg', contentType: 'image/jpeg' },
      { bytes: png, filename: 'test.png', contentType: 'image/png' },
      {
        bytes: Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        filename: 'test.webp',
        contentType: 'image/webp'
      }
    ]

    for (const fixture of fixtures) {
      const response = await request(app)
        .post('/room-music/music-categories')
        .set('Authorization', 'Bearer valid')
        .field('name', 'Test')
        .attach('image', fixture.bytes, { filename: fixture.filename, contentType: fixture.contentType })
      expect(response.status).toBe(201)
    }
  })

  it('rejects non-image files, spoofed image MIME, and oversized images', async () => {
    jest.mocked(verifyToken).mockResolvedValue({ user_id: 'admin' } as never)
    jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role: UserRole.Admin } as never)

    const invalidType = await request(app)
      .post('/room-music/music-categories')
      .set('Authorization', 'Bearer valid')
      .field('name', 'Test')
      .attach('image', Buffer.from('not-image'), { filename: 'test.txt', contentType: 'text/plain' })
    expect(invalidType.status).toBe(400)

    const spoofedType = await request(app)
      .post('/room-music/music-categories')
      .set('Authorization', 'Bearer valid')
      .field('name', 'Test')
      .attach('image', Buffer.from('not-really-a-png'), { filename: 'test.png', contentType: 'image/png' })
    expect(spoofedType.status).toBe(400)

    const tooLarge = await request(app)
      .post('/room-music/music-categories')
      .set('Authorization', 'Bearer valid')
      .field('name', 'Test')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'test.png', contentType: 'image/png' })
    expect(tooLarge.status).toBe(400)
  })

  it('allows empty reorder arrays but rejects empty assignment/removal arrays', async () => {
    jest.mocked(verifyToken).mockResolvedValue({ user_id: 'admin' } as never)
    jest.spyOn(usersServices, 'getUserById').mockResolvedValue({ role: UserRole.Admin } as never)
    jest.spyOn(musicCategoryService, 'reorderCategories').mockResolvedValue([])
    jest.spyOn(musicCategoryService, 'reorderSongs').mockResolvedValue({ reorderedCount: 0 })
    const id = '507f1f77bcf86cd799439011'

    expect(
      (
        await request(app)
          .put('/room-music/music-categories/reorder')
          .set('Authorization', 'Bearer valid')
          .send({ categoryIds: [] })
      ).status
    ).toBe(200)
    expect(
      (
        await request(app)
          .put(`/room-music/music-categories/${id}/songs/reorder`)
          .set('Authorization', 'Bearer valid')
          .send({ videoIds: [] })
      ).status
    ).toBe(200)
    expect(
      (
        await request(app)
          .post(`/room-music/music-categories/${id}/songs`)
          .set('Authorization', 'Bearer valid')
          .send({ videoIds: [] })
      ).status
    ).toBe(422)
    expect(
      (
        await request(app)
          .delete(`/room-music/music-categories/${id}/songs`)
          .set('Authorization', 'Bearer valid')
          .send({ videoIds: [] })
      ).status
    ).toBe(422)
  })
})
