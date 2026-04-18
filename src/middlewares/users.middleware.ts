import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { AUTH_MESSAGES, USER_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from '~/services/database.service'
import { hashPassword } from '~/utils/crypto'
import { verifyToken } from '~/utils/jwt'
import { validate } from '~/utils/validation'

/** So khớp chính xác chuỗi, không phân biệt hoa thường (dùng cho login username/email). */
const caseInsensitiveExact = (value: string) => ({
  $regex: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
})

export const checkRegisterUserExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email } = req.body

    // Kiểm tra username đã tồn tại chưa
    const existingUserByUsername = await databaseService.users.findOne({ username })
    if (existingUserByUsername) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.USERNAME_EXISTS,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    // Kiểm tra email đã tồn tại chưa (nếu có email)
    if (email) {
      const existingUserByEmail = await databaseService.users.findOne({ email })
      if (existingUserByEmail) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.EMAIL_EXISTS,
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const checkLoginUserExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body
    const rawLogin = typeof username === 'string' ? username.trim() : ''

    // Chuẩn hóa: staff/admin (và mọi role) login không phân biệt hoa thường; coi identifier là lowercase
    if (typeof req.body?.username === 'string') {
      req.body.username = rawLogin.toLowerCase()
    }

    // Tìm người dùng dựa vào username (có thể là email hoặc phone_number)
    let user = await databaseService.users.findOne({ username: caseInsensitiveExact(rawLogin) })

    // Nếu không tìm thấy bằng username, thử tìm bằng email
    if (!user) {
      user = await databaseService.users.findOne({ email: caseInsensitiveExact(rawLogin) })
    }

    // Nếu vẫn không tìm thấy, thử tìm bằng phone_number
    if (!user) {
      user = await databaseService.users.findOne({ phone_number: rawLogin })
    }

    if (!user) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.INVALID_LOGIN,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }

    // Bước 2: Băm mật khẩu người dùng nhập vào và so sánh với mật khẩu đã lưu
    const hashedPassword = hashPassword(password)

    if (user.password !== hashedPassword) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.INVALID_LOGIN,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }

    // Nếu mật khẩu hợp lệ, gán thông tin user vào req.user
    req.user = user

    // Tiếp tục đến controller
    next()
  } catch (error) {
    next(error)
  }
}

export const checkUserId = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = req?.decoded_authorization?.user_id

    const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })

    // Verify user exists in database
    if (!user) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.USER_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (user && req.decoded_authorization) {
      req.decoded_authorization.user_id = user._id.toString()
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const loginValidator = validate(
  checkSchema(
    {
      username: {
        notEmpty: {
          errorMessage: USER_MESSAGES.USERNAME_NOT_EMPTY
        },
        isString: true,
        trim: true
      },
      password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        }
      }
    },
    // thêm location body để không cần check header hay params khác
    ['body']
  )
)

export const registerValidator = validate(
  checkSchema(
    {
      name: {
        notEmpty: {
          errorMessage: USER_MESSAGES.USERNAME_NOT_EMPTY
        },
        isLength: {
          options: { min: 1, max: 100 },
          errorMessage: USER_MESSAGES.INVALID_USER_NAME
        },
        trim: true
      },
      username: {
        notEmpty: {
          errorMessage: USER_MESSAGES.USERNAME_NOT_EMPTY
        },
        isLength: {
          options: { min: 3, max: 50 },
          errorMessage: 'Username must be between 3 and 50 characters'
        },
        trim: true
      },
      email: {
        optional: true,
        isEmail: {
          errorMessage: USER_MESSAGES.INVALID_EMAIL
        },
        trim: true
      },
      phone_number: {
        notEmpty: {
          errorMessage: USER_MESSAGES.PHONE_NUMBER_NOT_EMPTY
        },
        isMobilePhone: {
          errorMessage: USER_MESSAGES.INVALID_PHONE_NUMBER
        },
        trim: true
      },
      password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        }
      },
      confirm_password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        },
        custom: {
          options: (value: string, { req }) => {
            if (value !== req.body.password) {
              throw new Error(USER_MESSAGES.PASSWORD_NOT_MATCH)
            }
            return true
          }
        }
      },
      date_of_birth: {
        isISO8601: {
          options: { strict: true, strictSeparator: true },
          errorMessage: USER_MESSAGES.INVALID_DATE_OF_BIRTH
        }
      },
      role: {
        notEmpty: {
          errorMessage: USER_MESSAGES.ROLE_NOT_EMPTY
        },
        isIn: {
          options: [Object.values(UserRole)],
          errorMessage: USER_MESSAGES.INVALID_ROLE
        }
      }
    },
    // thêm location body để không cần check header hay params khác
    ['body']
  )
)

export const accessTokenValidator = validate(
  checkSchema(
    {
      authorization: {
        custom: {
          options: async (value: string, { req }) => {
            const access_token = value?.split(' ')[1]

            if (!access_token) {
              throw new ErrorWithStatus({
                message: AUTH_MESSAGES.ACCESS_TOKEN_NOT_EMPTY,
                status: HTTP_STATUS_CODE.UNAUTHORIZED
              })
            }

            const decoded_authorization = await verifyToken(access_token)

            req.decoded_authorization = decoded_authorization

            return true
          }
        }
      }
    },
    ['headers', 'body']
  )
)

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.decoded_authorization?.user_id
    if (!userId) {
      return next(
        new ErrorWithStatus({
          message: AUTH_MESSAGES.ACCESS_TOKEN_NOT_EMPTY,
          status: HTTP_STATUS_CODE.UNAUTHORIZED
        })
      )
    }
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })
    if (!user || user.role !== UserRole.Admin) {
      return next(
        new ErrorWithStatus({
          message: 'Forbidden',
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }
    next()
  } catch (error) {
    next(error)
  }
}

export const updateUserValidator = validate(
  checkSchema(
    {
      name: {
        optional: true,
        isLength: {
          options: { min: 1, max: 100 },
          errorMessage: USER_MESSAGES.INVALID_USER_NAME
        },
        trim: true
      },
      email: {
        optional: true,
        isEmail: {
          errorMessage: USER_MESSAGES.INVALID_EMAIL
        },
        trim: true
      },
      phone_number: {
        optional: true,
        isMobilePhone: {
          errorMessage: USER_MESSAGES.INVALID_PHONE_NUMBER
        },
        trim: true
      },
      date_of_birth: {
        optional: true,
        isISO8601: {
          options: { strict: true, strictSeparator: true },
          errorMessage: USER_MESSAGES.INVALID_DATE_OF_BIRTH
        }
      },
      bio: {
        optional: true,
        isLength: {
          options: { max: 200 },
          errorMessage: 'Bio must be less than 200 characters'
        },
        trim: true
      },
      location: {
        optional: true,
        isLength: {
          options: { max: 100 },
          errorMessage: 'Location must be less than 100 characters'
        },
        trim: true
      },
      avatar: {
        optional: true,
        isURL: {
          errorMessage: 'Avatar must be a valid URL'
        },
        trim: true
      },
      role: {
        optional: true,
        isIn: {
          options: [Object.values(UserRole)],
          errorMessage: USER_MESSAGES.INVALID_ROLE
        }
      }
    },
    ['body']
  )
)

export const forgotPasswordValidator = validate(
  checkSchema(
    {
      email: {
        notEmpty: {
          errorMessage: USER_MESSAGES.EMAIL_NOT_EMPTY
        },
        isEmail: {
          errorMessage: USER_MESSAGES.INVALID_EMAIL
        },
        trim: true
      }
    },
    ['body']
  )
)

export const resetPasswordValidator = validate(
  checkSchema(
    {
      forgot_password_token: {
        notEmpty: {
          errorMessage: 'Forgot password token is required'
        },
        isString: true,
        trim: true
      },
      password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        }
      },
      confirm_password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        },
        custom: {
          options: (value: string, { req }) => {
            if (value !== req.body.password) {
              throw new Error(USER_MESSAGES.PASSWORD_NOT_MATCH)
            }
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const changePasswordValidator = validate(
  checkSchema(
    {
      old_password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.OLD_PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        }
      },
      password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        }
      },
      confirm_password: {
        notEmpty: {
          errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_NOT_EMPTY
        },
        isString: true,
        trim: true,
        isLength: {
          options: { min: 6, max: 8 },
          errorMessage: 'Password must be between 6 and 8 characters'
        },
        custom: {
          options: (value: string, { req }) => {
            if (value !== req.body.password) {
              throw new Error(USER_MESSAGES.PASSWORD_NOT_MATCH)
            }
            return true
          }
        }
      }
    },
    ['body']
  )
)
