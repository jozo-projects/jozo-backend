import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  CategoryIdsRequestBody,
  CreateMusicCategoryRequestBody,
  MusicCategorySongsQuery,
  UpdateMusicCategoryRequestBody,
  VideoIdsRequestBody
} from '~/models/requests/MusicCategory.request'
import { deleteImageFromCloudinary, uploadImageToCloudinary } from '~/services/cloudinary.service'
import { musicCategoryService } from '~/services/musicCategory.service'

const messages = {
  listed: 'Lấy danh mục nhạc thành công',
  created: 'Tạo danh mục nhạc thành công',
  updated: 'Cập nhật danh mục nhạc thành công',
  deleted: 'Xóa danh mục nhạc thành công',
  reordered: 'Sắp xếp danh mục nhạc thành công',
  songsListed: 'Lấy bài hát trong danh mục thành công',
  assigned: 'Thêm bài hát vào danh mục thành công',
  removed: 'Bỏ bài hát khỏi danh mục thành công',
  songsReordered: 'Sắp xếp bài hát thành công'
}

type UploadedImage = { url: string; publicId: string }

const safelyDeleteImage = async (publicId?: string) => {
  if (!publicId) return
  try {
    await deleteImageFromCloudinary(publicId)
  } catch (error) {
    console.error('[music-category] image cleanup failed', error)
  }
}

export const listPublicMusicCategories = async (_req: Request, res: Response) => {
  const result = await musicCategoryService.listPublicCategories()
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.listed, result })
}

export const listAdminMusicCategories = async (_req: Request, res: Response) => {
  const result = await musicCategoryService.listAdminCategories()
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.listed, result })
}

export const createMusicCategory = async (
  req: Request<Record<string, never>, unknown, CreateMusicCategoryRequestBody>,
  res: Response,
  next: NextFunction
) => {
  let uploaded: UploadedImage | undefined
  try {
    if (!req.file) {
      throw new ErrorWithStatus({ message: 'Ảnh danh mục là bắt buộc', status: HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY })
    }
    uploaded = (await uploadImageToCloudinary(req.file.buffer, 'music-categories')) as UploadedImage
    const result = await musicCategoryService.createCategory({
      name: req.body.name,
      isActive: req.body.isActive,
      imageUrl: uploaded.url,
      imagePublicId: uploaded.publicId
    })
    return res.status(HTTP_STATUS_CODE.CREATED).json({ message: messages.created, result })
  } catch (error) {
    if (uploaded?.publicId) await safelyDeleteImage(uploaded.publicId)
    next(error)
  }
}

export const updateMusicCategory = async (
  req: Request<{ categoryId: string }, unknown, UpdateMusicCategoryRequestBody>,
  res: Response,
  next: NextFunction
) => {
  let uploaded: UploadedImage | undefined
  try {
    const current = await musicCategoryService.getCategoryById(req.params.categoryId)
    if (!current) {
      throw new ErrorWithStatus({ message: 'Không tìm thấy danh mục nhạc', status: HTTP_STATUS_CODE.NOT_FOUND })
    }
    if (req.file) uploaded = (await uploadImageToCloudinary(req.file.buffer, 'music-categories')) as UploadedImage
    const result = await musicCategoryService.updateCategory(req.params.categoryId, {
      name: req.body.name,
      isActive: req.body.isActive,
      ...(uploaded ? { imageUrl: uploaded.url, imagePublicId: uploaded.publicId } : {})
    })
    if (uploaded && current.imagePublicId) await safelyDeleteImage(current.imagePublicId)
    return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.updated, result })
  } catch (error) {
    if (uploaded?.publicId) await safelyDeleteImage(uploaded.publicId)
    next(error)
  }
}

export const deleteMusicCategory = async (req: Request<{ categoryId: string }>, res: Response) => {
  const deleted = await musicCategoryService.deleteCategory(req.params.categoryId)
  await safelyDeleteImage(deleted.imagePublicId)
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.deleted, result: deleted })
}

export const reorderMusicCategories = async (
  req: Request<Record<string, never>, unknown, CategoryIdsRequestBody>,
  res: Response
) => {
  const result = await musicCategoryService.reorderCategories(req.body.categoryIds)
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.reordered, result })
}

const songListOptions = (
  req: Request<{ categoryId: string }, unknown, unknown, MusicCategorySongsQuery>,
  admin: boolean
) => ({
  page: req.query.page ? Number(req.query.page) : undefined,
  limit: req.query.limit ? Number(req.query.limit) : undefined,
  keyword: req.query.keyword,
  admin
})

export const listPublicCategorySongs = async (
  req: Request<{ categoryId: string }, unknown, unknown, MusicCategorySongsQuery>,
  res: Response
) => {
  const result = await musicCategoryService.listCategorySongs(req.params.categoryId, songListOptions(req, false))
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.songsListed, result })
}

export const listAdminCategorySongs = async (
  req: Request<{ categoryId: string }, unknown, unknown, MusicCategorySongsQuery>,
  res: Response
) => {
  const result = await musicCategoryService.listCategorySongs(req.params.categoryId, songListOptions(req, true))
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.songsListed, result })
}

export const assignMusicCategorySongs = async (
  req: Request<{ categoryId: string }, unknown, VideoIdsRequestBody>,
  res: Response
) => {
  const result = await musicCategoryService.assignSongs(req.params.categoryId, req.body.videoIds)
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.assigned, result })
}

export const removeMusicCategorySongs = async (
  req: Request<{ categoryId: string }, unknown, VideoIdsRequestBody>,
  res: Response
) => {
  const result = await musicCategoryService.removeSongs(req.params.categoryId, req.body.videoIds)
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.removed, result })
}

export const reorderMusicCategorySongs = async (
  req: Request<{ categoryId: string }, unknown, VideoIdsRequestBody>,
  res: Response
) => {
  const result = await musicCategoryService.reorderSongs(req.params.categoryId, req.body.videoIds)
  return res.status(HTTP_STATUS_CODE.OK).json({ message: messages.songsReordered, result })
}
