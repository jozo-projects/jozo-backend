import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  assignMusicCategorySongs,
  createMusicCategory,
  deleteMusicCategory,
  listAdminCategorySongs,
  listAdminMusicCategories,
  listPublicCategorySongs,
  listPublicMusicCategories,
  removeMusicCategorySongs,
  reorderMusicCategories,
  reorderMusicCategorySongs,
  updateMusicCategory
} from '~/controllers/musicCategory.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  categoryIdValidator,
  categoryIdsValidator,
  categorySongsQueryValidator,
  createMusicCategoryValidator,
  parseMusicCategoryMultipart,
  reorderVideoIdsValidator,
  updateMusicCategoryValidator,
  uploadMusicCategoryImage,
  videoIdsValidator
} from '~/middlewares/musicCategory.middleware'
import { initializeMusicCategoryFeature } from '~/services/musicCategory.service'
import { wrapRequestHandler } from '~/utils/handlers'

export const createMusicCategoryRouter = (initialize: () => Promise<void> = initializeMusicCategoryFeature) => {
  const musicCategoryRouter = Router()
  const admin = protect([UserRole.Admin])

  musicCategoryRouter.use(async (_req, _res, next) => {
    try {
      await initialize()
      next()
    } catch (error) {
      next(error)
    }
  })
  musicCategoryRouter.get('/', wrapRequestHandler(listPublicMusicCategories))
  musicCategoryRouter.get('/admin', admin, wrapRequestHandler(listAdminMusicCategories))
  musicCategoryRouter.put('/reorder', admin, categoryIdsValidator, wrapRequestHandler(reorderMusicCategories))
  musicCategoryRouter.post(
    '/',
    admin,
    uploadMusicCategoryImage,
    parseMusicCategoryMultipart,
    createMusicCategoryValidator,
    wrapRequestHandler(createMusicCategory)
  )
  musicCategoryRouter.patch(
    '/:categoryId',
    admin,
    uploadMusicCategoryImage,
    parseMusicCategoryMultipart,
    updateMusicCategoryValidator,
    wrapRequestHandler(updateMusicCategory)
  )
  musicCategoryRouter.delete('/:categoryId', admin, categoryIdValidator, wrapRequestHandler(deleteMusicCategory))
  musicCategoryRouter.get(
    '/:categoryId/admin/songs',
    admin,
    categorySongsQueryValidator,
    wrapRequestHandler(listAdminCategorySongs)
  )
  musicCategoryRouter.put(
    '/:categoryId/songs/reorder',
    admin,
    reorderVideoIdsValidator,
    wrapRequestHandler(reorderMusicCategorySongs)
  )
  musicCategoryRouter.post('/:categoryId/songs', admin, videoIdsValidator, wrapRequestHandler(assignMusicCategorySongs))
  musicCategoryRouter.delete(
    '/:categoryId/songs',
    admin,
    videoIdsValidator,
    wrapRequestHandler(removeMusicCategorySongs)
  )
  musicCategoryRouter.get(
    '/:categoryId/songs',
    categorySongsQueryValidator,
    wrapRequestHandler(listPublicCategorySongs)
  )

  return musicCategoryRouter
}

export default createMusicCategoryRouter()
