import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { FnBMenuCustomizationGroup } from '~/models/schemas/FnBMenuItem.schema'
import { parseCustomizationGroups, parseCustomizationTemplateRefs } from '~/services/fnbMenuCustomization.service'
import customizationGroupTemplateService from '~/services/customizationGroupTemplate.service'

function parseBooleanLike(raw: unknown, fieldName: string): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
  }
  throw new ErrorWithStatus({
    message: `${fieldName} phải là boolean`,
    status: HTTP_STATUS_CODE.BAD_REQUEST
  })
}

function parseSingleGroup(raw: unknown): FnBMenuCustomizationGroup {
  const parsed = parseCustomizationGroups(Array.isArray(raw) ? raw : [raw])
  if (!parsed?.length) {
    throw new ErrorWithStatus({
      message: 'group không hợp lệ',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
  return parsed[0]
}

export const listCustomizationTemplatesController = async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === 'true'
  const result = await customizationGroupTemplateService.listTemplates(includeInactive)
  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Lấy danh sách customization templates thành công',
    result
  })
}

export const createCustomizationTemplateController = async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const templateKey = typeof body.templateKey === 'string' ? body.templateKey.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!templateKey || !label) {
    throw new ErrorWithStatus({
      message: 'templateKey và label là bắt buộc',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  const group = parseSingleGroup(body.group)
  const result = await customizationGroupTemplateService.createTemplate({
    templateKey,
    label,
    group,
    isActive: body.isActive === undefined ? true : parseBooleanLike(body.isActive, 'isActive')
  })
  return res.status(HTTP_STATUS_CODE.CREATED).json({
    message: 'Tạo customization template thành công',
    result
  })
}

export const updateCustomizationTemplateController = async (req: Request, res: Response) => {
  const { templateKey } = req.params
  const body = req.body as Record<string, unknown>
  const update: Record<string, unknown> = {}

  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      throw new ErrorWithStatus({
        message: 'label không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    update.label = body.label.trim()
  }
  if (body.group !== undefined) {
    update.group = parseSingleGroup(body.group)
  }
  if (body.isActive !== undefined) {
    update.isActive = parseBooleanLike(body.isActive, 'isActive')
  }

  const result = await customizationGroupTemplateService.updateTemplate(templateKey, update)
  if (!result) {
    throw new ErrorWithStatus({
      message: `Không tìm thấy template: ${templateKey}`,
      status: HTTP_STATUS_CODE.NOT_FOUND
    })
  }
  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Cập nhật customization template thành công',
    result
  })
}

export const deleteCustomizationTemplateController = async (req: Request, res: Response) => {
  const { templateKey } = req.params
  const result = await customizationGroupTemplateService.deactivateTemplate(templateKey)
  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Tắt customization template thành công',
    result
  })
}

export const validateCustomizationTemplateRefsController = async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const refs = parseCustomizationTemplateRefs(body.customizationTemplateRefs) ?? []
  const missing: string[] = []
  for (const ref of refs) {
    const template = await customizationGroupTemplateService.getTemplateByKey(ref.templateKey)
    if (!template || !template.isActive) {
      missing.push(ref.templateKey)
    }
  }
  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Validate template refs hoàn tất',
    result: {
      valid: missing.length === 0,
      missingTemplateKeys: missing
    }
  })
}
