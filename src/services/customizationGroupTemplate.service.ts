import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  CustomizationGroupTemplate,
  ICustomizationGroupTemplate
} from '~/models/schemas/CustomizationGroupTemplate.schema'
import databaseService from './database.service'

const collection = databaseService.customizationGroupTemplates

class CustomizationGroupTemplateService {
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return
    await collection.createIndex({ templateKey: 1 }, { unique: true, name: 'unique_customization_template_key' })
    this.initialized = true
  }

  async listTemplates(includeInactive = false): Promise<ICustomizationGroupTemplate[]> {
    await this.initialize()
    const filter = includeInactive ? {} : { isActive: true }
    return collection.find(filter).sort({ createdAt: -1 }).toArray()
  }

  async getTemplateByKey(templateKey: string): Promise<ICustomizationGroupTemplate | null> {
    await this.initialize()
    return collection.findOne({ templateKey })
  }

  async createTemplate(payload: Omit<ICustomizationGroupTemplate, '_id' | 'createdAt' | 'updatedAt'>) {
    await this.initialize()
    const now = new Date()
    const doc = new CustomizationGroupTemplate({
      ...payload,
      createdAt: now,
      updatedAt: now
    })
    try {
      const result = await collection.insertOne(doc)
      doc._id = result.insertedId
      return doc
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ErrorWithStatus({
          message: `templateKey "${payload.templateKey}" đã tồn tại`,
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
      throw error
    }
  }

  async updateTemplate(templateKey: string, update: Partial<ICustomizationGroupTemplate>) {
    await this.initialize()
    const next = {
      ...update,
      updatedAt: new Date()
    }
    await collection.updateOne({ templateKey }, { $set: next })
    return this.getTemplateByKey(templateKey)
  }

  async deactivateTemplate(templateKey: string) {
    const result = await this.updateTemplate(templateKey, { isActive: false })
    if (!result) {
      throw new ErrorWithStatus({
        message: `Không tìm thấy template: ${templateKey}`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return result
  }
}

const customizationGroupTemplateService = new CustomizationGroupTemplateService()
export default customizationGroupTemplateService
