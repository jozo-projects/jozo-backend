import { Router } from 'express'
import {
  changePasswordController,
  deleteUserController,
  forgotPasswordController,
  getAllUsersController,
  getUserByIdController,
  getUserController,
  getUsersController,
  loginController,
  logoutController,
  registerController,
  resetPasswordController,
  updateUserController
} from '~/controllers/users.controller'
import {
  accessTokenValidator,
  changePasswordValidator,
  checkLoginUserExists,
  checkRegisterUserExists,
  checkUserId,
  forgotPasswordValidator,
  loginValidator,
  registerValidator,
  resetPasswordValidator,
  updateUserValidator
} from '~/middlewares/users.middleware'
import { strictAuthLimiter } from '~/middlewares/rateLimiter.middleware'
import { wrapRequestHandler } from '~/utils/handlers'
import { upload } from '~/utils/common'

const usersRouter = Router()

/**
 * @description Register a new user
 * @path /users/register
 * @method POST
 * @body {name: string, username: string, email?: string, password: string, confirm_password: string, date_of_birth: ISOString, role: UserRole, phone_number: string}
 * @rate_limit 3 requests per hour
 * @author QuangDoo
 */
usersRouter.post(
  '/register',
  strictAuthLimiter({ windowMs: 60 * 60 * 1000, max: 3 }), // 3 requests/hour
  checkRegisterUserExists,
  registerValidator,
  wrapRequestHandler(registerController)
)

/**
 * @description Login user
 * @path /users/login
 * @method POST
 * @body {username: string, password: string}
 * @rate_limit 5 failed attempts per 15 minutes
 * @author QuangDoo
 */
usersRouter.post(
  '/login',
  strictAuthLimiter(), // 5 failed attempts/15 minutes (chỉ đếm failed)
  checkLoginUserExists,
  loginValidator,
  loginController
)

/**
 * @description Logout user
 * @path /users/logout
 * @method Post
 * @header {Authorization: Bearer <access_token>}
 * @body {refresh_token: string}
 * @author QuangDoo
 */
usersRouter.post('/logout', accessTokenValidator, wrapRequestHandler(logoutController))

/**
 * @description Forgot password
 * @path /users/forgot-password
 * @method POST
 * @body {email: string}
 * @rate_limit 3 requests per hour
 * @author QuangDoo
 */
usersRouter.post(
  '/forgot-password',
  strictAuthLimiter({ windowMs: 60 * 60 * 1000, max: 3, skipSuccessfulRequests: false }), // 3 requests/hour
  forgotPasswordValidator,
  wrapRequestHandler(forgotPasswordController)
)

/**
 * @description Reset password
 * @path /users/reset-password
 * @method POST
 * @body {forgot_password_token: string, password: string, confirm_password: string}
 * @author QuangDoo
 */
usersRouter.post('/reset-password', resetPasswordValidator, wrapRequestHandler(resetPasswordController))

/**
 * @description Change password
 * @path /users/change-password
 * @method POST
 * @header {Authorization: Bearer <access_token>}
 * @body {old_password: string, password: string, confirm_password: string}
 * @author QuangDoo
 */
usersRouter.post(
  '/change-password',
  accessTokenValidator,
  changePasswordValidator,
  wrapRequestHandler(changePasswordController)
)

/**
 * @description Get all users (legacy)
 */
usersRouter.get('/get-all-users', wrapRequestHandler(getAllUsersController))

/**
 * @description Get user by id (current user)
 */
usersRouter.get('/get-user', accessTokenValidator, checkUserId, wrapRequestHandler(getUserController))

/**
 * @description Get users with pagination, search and filter
 * @path /users
 * @method GET
 * @query {page?: number, limit?: number, search?: string, role?: UserRole, sort_by?: string, sort_order?: 'asc' | 'desc'}
 * @author QuangDoo
 */
usersRouter.get('/', wrapRequestHandler(getUsersController))

/**
 * @description Get user by ID
 * @path /users/:id
 * @method GET
 * @param {id: string}
 * @author QuangDoo
 */
usersRouter.get('/:id', wrapRequestHandler(getUserByIdController))

/**
 * @description Update user
 * @path /users/:id
 * @method PUT
 * @param {id: string}
 * @body {name?: string, email?: string, phone_number?: string, date_of_birth?: Date, bio?: string, location?: string, avatar?: string, role?: UserRole}
 * @file avatar?: File (multipart/form-data)
 * @author QuangDoo
 */
usersRouter.put('/:id', upload.single('avatar'), updateUserValidator, wrapRequestHandler(updateUserController))

/**
 * @description Delete user
 * @path /users/:id
 * @method DELETE
 * @param {id: string}
 * @author QuangDoo
 */
usersRouter.delete('/:id', wrapRequestHandler(deleteUserController))

export default usersRouter
