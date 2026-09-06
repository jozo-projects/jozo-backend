import { Response } from 'express'
import { createMusicCategory, updateMusicCategory } from '~/controllers/musicCategory.controller'
import { musicCategoryService } from '~/services/musicCategory.service'
import { deleteImageFromCloudinary, uploadImageToCloudinary } from '~/services/cloudinary.service'

jest.mock('~/services/cloudinary.service', () => ({
  uploadImageToCloudinary: jest.fn(),
  deleteImageFromCloudinary: jest.fn()
}))

const response = () => {
  const res = {} as Response
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

const file = { buffer: Buffer.from('image'), mimetype: 'image/png' } as never

describe('music category controller image lifecycle', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('deletes a newly uploaded image when create persistence fails', async () => {
    jest.mocked(uploadImageToCloudinary).mockResolvedValue({ url: 'new.jpg', publicId: 'new-id' } as never)
    jest.mocked(deleteImageFromCloudinary).mockResolvedValue({ message: 'ok' })
    jest.spyOn(musicCategoryService, 'createCategory').mockRejectedValue(new Error('db failed'))
    const next = jest.fn()

    await createMusicCategory({ body: { name: 'Test' }, file } as never, response(), next)

    expect(deleteImageFromCloudinary).toHaveBeenCalledWith('new-id')
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'db failed' }))
  })

  it('parses multipart false and deletes the old image only after successful replacement', async () => {
    const order: string[] = []
    jest.spyOn(musicCategoryService, 'getCategoryById').mockResolvedValue({
      name: 'Old',
      slug: 'old',
      imageUrl: 'old.jpg',
      imagePublicId: 'old-id',
      isActive: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    } as never)
    jest.mocked(uploadImageToCloudinary).mockImplementation(async () => {
      order.push('upload')
      return { url: 'new.jpg', publicId: 'new-id' }
    })
    jest.spyOn(musicCategoryService, 'updateCategory').mockImplementation(async (_id, input) => {
      order.push(`update:${String(input.isActive)}`)
      return {} as never
    })
    jest.mocked(deleteImageFromCloudinary).mockImplementation(async () => {
      order.push('delete-old')
      return { message: 'ok' }
    })

    await updateMusicCategory(
      { params: { categoryId: '507f1f77bcf86cd799439011' }, body: { isActive: false }, file } as never,
      response(),
      jest.fn()
    )

    expect(order).toEqual(['upload', 'update:false', 'delete-old'])
    expect(deleteImageFromCloudinary).toHaveBeenCalledWith('old-id')
  })

  it('cleans only the new replacement when an update fails', async () => {
    jest.spyOn(musicCategoryService, 'getCategoryById').mockResolvedValue({
      name: 'Old',
      slug: 'old',
      imageUrl: 'old.jpg',
      imagePublicId: 'old-id',
      isActive: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    } as never)
    jest.mocked(uploadImageToCloudinary).mockResolvedValue({ url: 'new.jpg', publicId: 'new-id' } as never)
    jest.spyOn(musicCategoryService, 'updateCategory').mockRejectedValue(new Error('db failed'))
    const next = jest.fn()

    await updateMusicCategory(
      { params: { categoryId: '507f1f77bcf86cd799439011' }, body: {}, file } as never,
      response(),
      next
    )

    expect(deleteImageFromCloudinary).toHaveBeenCalledTimes(1)
    expect(deleteImageFromCloudinary).toHaveBeenCalledWith('new-id')
    expect(deleteImageFromCloudinary).not.toHaveBeenCalledWith('old-id')
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'db failed' }))
  })
})
