import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import multer from 'multer'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { validate } from '~/utils/validation'

const objectIdRule = {
  isMongoId: { errorMessage: 'ID danh mục không hợp lệ' }
}

const idArrayRule = (field: string, allowEmpty = false) => ({
  in: 'body' as const,
  isArray: {
    options: { min: allowEmpty ? 0 : 1 },
    errorMessage: allowEmpty ? `${field} phải là một mảng` : `${field} phải là một mảng không rỗng`
  },
  custom: {
    options: (value: unknown) =>
      Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0),
    errorMessage: `${field} chứa ID không hợp lệ`
  }
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP'))
    }
    callback(null, true)
  }
})

const hasValidImageSignature = (buffer: Buffer) => {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isPng =
    buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return isJpeg || isPng || isWebp
}

export const uploadMusicCategoryImage = (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      return next(
        new ErrorWithStatus({
          message:
            error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
              ? 'Ảnh không được vượt quá 5 MB'
              : error.message,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }
    if (req.file && !hasValidImageSignature(req.file.buffer)) {
      return next(
        new ErrorWithStatus({
          message: 'Nội dung tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }
    next()
  })
}

export const parseMusicCategoryMultipart = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body.isActive === 'true') req.body.isActive = true
  if (req.body.isActive === 'false') req.body.isActive = false
  next()
}

export const createMusicCategoryValidator = validate(
  checkSchema({
    name: {
      in: ['body'],
      trim: true,
      isLength: { options: { min: 1, max: 100 }, errorMessage: 'Tên danh mục phải từ 1 đến 100 ký tự' }
    },
    isActive: {
      in: ['body'],
      optional: true,
      isBoolean: { errorMessage: 'Trạng thái không hợp lệ' }
    },
    image: {
      custom: {
        options: (_value, { req }) => Boolean(req.file),
        errorMessage: 'Ảnh danh mục là bắt buộc'
      }
    }
  })
)

export const updateMusicCategoryValidator = validate(
  checkSchema({
    categoryId: { in: ['params'], ...objectIdRule },
    name: {
      in: ['body'],
      optional: true,
      trim: true,
      isLength: { options: { min: 1, max: 100 }, errorMessage: 'Tên danh mục phải từ 1 đến 100 ký tự' }
    },
    isActive: { in: ['body'], optional: true, isBoolean: { errorMessage: 'Trạng thái không hợp lệ' } }
  })
)

export const categoryIdValidator = validate(checkSchema({ categoryId: { in: ['params'], ...objectIdRule } }))

export const categorySongsQueryValidator = validate(
  checkSchema({
    categoryId: { in: ['params'], ...objectIdRule },
    page: { in: ['query'], optional: true, isInt: { options: { min: 1 }, errorMessage: 'page không hợp lệ' } },
    limit: {
      in: ['query'],
      optional: true,
      isInt: { options: { min: 1, max: 500 }, errorMessage: 'limit không hợp lệ' }
    },
    keyword: { in: ['query'], optional: true, isLength: { options: { max: 200 }, errorMessage: 'keyword quá dài' } }
  })
)

export const categoryIdsValidator = validate(checkSchema({ categoryIds: idArrayRule('categoryIds', true) }))
export const videoIdsValidator = validate(
  checkSchema({ categoryId: { in: ['params'], ...objectIdRule }, videoIds: idArrayRule('videoIds') })
)
export const reorderVideoIdsValidator = validate(
  checkSchema({ categoryId: { in: ['params'], ...objectIdRule }, videoIds: idArrayRule('videoIds', true) })
)
