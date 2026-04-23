import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  createGameController,
  createGameTypeController,
  deleteGameController,
  deleteGameTypeController,
  getGameByIdController,
  getGamesController,
  getGameTypeByIdController,
  getGameTypesController,
  updateGameController,
  updateGameTypeController
} from '~/controllers/game.controller'
import {
  createGameTypeValidator,
  createGameValidator,
  gameIdParamValidator,
  gameListQueryValidator,
  gameTypeIdParamValidator,
  updateGameTypeValidator,
  updateGameValidator
} from '~/middlewares/game.middleware'
import { protect } from '~/middlewares/auth.middleware'
import { upload } from '~/utils/common'
import { wrapRequestHandler } from '~/utils/handlers'

const gameRouter = Router()

gameRouter.get('/types', wrapRequestHandler(getGameTypesController))
gameRouter.get('/types/:typeId', gameTypeIdParamValidator, wrapRequestHandler(getGameTypeByIdController))
gameRouter.post(
  '/types',
  protect([UserRole.Admin]),
  upload.single('image'),
  createGameTypeValidator,
  wrapRequestHandler(createGameTypeController)
)
gameRouter.put(
  '/types/:typeId',
  protect([UserRole.Admin]),
  gameTypeIdParamValidator,
  upload.single('image'),
  updateGameTypeValidator,
  wrapRequestHandler(updateGameTypeController)
)
gameRouter.delete(
  '/types/:typeId',
  protect([UserRole.Admin]),
  gameTypeIdParamValidator,
  wrapRequestHandler(deleteGameTypeController)
)

gameRouter.get('/', gameListQueryValidator, wrapRequestHandler(getGamesController))
gameRouter.get('/:id', gameIdParamValidator, wrapRequestHandler(getGameByIdController))
gameRouter.post(
  '/',
  protect([UserRole.Admin]),
  upload.array('images', 10),
  createGameValidator,
  wrapRequestHandler(createGameController)
)
gameRouter.put(
  '/:id',
  protect([UserRole.Admin]),
  gameIdParamValidator,
  upload.array('images', 10),
  updateGameValidator,
  wrapRequestHandler(updateGameController)
)
gameRouter.delete('/:id', protect([UserRole.Admin]), gameIdParamValidator, wrapRequestHandler(deleteGameController))

export default gameRouter
