import { ObjectId } from 'mongodb'
import { FnBMenuCustomizationGroup } from './FnBMenuItem.schema'

export interface ICustomizationGroupTemplate {
  _id?: ObjectId
  templateKey: string
  label: string
  group: FnBMenuCustomizationGroup
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export class CustomizationGroupTemplate implements ICustomizationGroupTemplate {
  _id?: ObjectId
  templateKey: string
  label: string
  group: FnBMenuCustomizationGroup
  isActive: boolean
  createdAt: Date
  updatedAt: Date

  constructor(payload: ICustomizationGroupTemplate) {
    this._id = payload._id
    this.templateKey = payload.templateKey
    this.label = payload.label
    this.group = payload.group
    this.isActive = payload.isActive
    this.createdAt = payload.createdAt
    this.updatedAt = payload.updatedAt
  }
}
