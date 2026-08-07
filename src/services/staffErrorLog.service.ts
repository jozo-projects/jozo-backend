import { Filter, ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import { StaffErrorLogStatus, StaffErrorLogType, UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { STAFF_ERROR_LOG_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import {
  ICancelStaffErrorLogBody,
  ICreateStaffErrorLogBody,
  ICreateStaffErrorPresetBody,
  IGetStaffErrorLogsQuery,
  IUpdateStaffErrorPresetBody
} from '~/models/requests/StaffErrorLog.request'
import { IStaffErrorLog, StaffErrorLog } from '~/models/schemas/StaffErrorLog.schema'
import { IStaffErrorPreset, StaffErrorPreset } from '~/models/schemas/StaffErrorPreset.schema'
import databaseService from '~/services/database.service'

export interface ISumActivePenaltiesParams {
  userId?: string
  startDate?: Date
  endDate?: Date
}

export interface ISumActivePenaltiesResult {
  totalDeductions: number
  deductionCount: number
}

class StaffErrorLogService {
  private normalizeCode(code: string) {
    return code.trim().toLowerCase()
  }

  async createPreset(body: ICreateStaffErrorPresetBody) {
    const code = this.normalizeCode(body.code)
    const existing = await databaseService.staffErrorPresets.findOne({ code })
    if (existing) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.PRESET_CODE_EXISTS,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const preset = new StaffErrorPreset({
      code,
      name: body.name.trim(),
      description: body.description?.trim(),
      defaultAmount: body.defaultAmount,
      isActive: body.isActive !== false,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const result = await databaseService.staffErrorPresets.insertOne(preset)
    return { ...preset, _id: result.insertedId }
  }

  async listPresets(options?: { includeInactive?: boolean }) {
    const query: Filter<IStaffErrorPreset> = {}
    if (!options?.includeInactive) {
      query.isActive = true
    }
    return databaseService.staffErrorPresets.find(query).sort({ name: 1 }).toArray()
  }

  async getPresetById(id: string) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.PRESET_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    const preset = await databaseService.staffErrorPresets.findOne({ _id: new ObjectId(id) })
    if (!preset) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.PRESET_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return preset
  }

  async updatePreset(id: string, body: IUpdateStaffErrorPresetBody) {
    await this.getPresetById(id)

    const update: Partial<IStaffErrorPreset> = { updatedAt: new Date() }
    if (body.code !== undefined) {
      const code = this.normalizeCode(body.code)
      const conflict = await databaseService.staffErrorPresets.findOne({
        code,
        _id: { $ne: new ObjectId(id) }
      })
      if (conflict) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.PRESET_CODE_EXISTS,
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
      update.code = code
    }
    if (body.name !== undefined) update.name = body.name.trim()
    if (body.description !== undefined) update.description = body.description.trim()
    if (body.defaultAmount !== undefined) update.defaultAmount = body.defaultAmount
    if (body.isActive !== undefined) update.isActive = body.isActive

    const result = await databaseService.staffErrorPresets.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: update },
      { returnDocument: 'after' }
    )
    return result
  }

  async deletePreset(id: string) {
    await this.getPresetById(id)
    await databaseService.staffErrorPresets.deleteOne({ _id: new ObjectId(id) })
  }

  private async resolveActor(actorId: string) {
    if (!ObjectId.isValid(actorId)) {
      throw new ErrorWithStatus({
        message: 'Unauthorized',
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }
    const actor = await databaseService.users.findOne({ _id: new ObjectId(actorId) })
    if (!actor) {
      throw new ErrorWithStatus({
        message: 'Unauthorized',
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }
    return {
      id: actor._id!,
      name: actor.full_name || actor.name || actor.username
    }
  }

  private async resolveStaffUser(userId: string) {
    if (!ObjectId.isValid(userId)) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.INVALID_USER_ID,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })
    if (!user || (user.role !== UserRole.Staff && user.role !== UserRole.Admin)) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.USER_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return {
      id: user._id!,
      name: user.full_name || user.name || user.username
    }
  }

  async createLog(actorId: string, body: ICreateStaffErrorLogBody) {
    const actor = await this.resolveActor(actorId)
    const staff = await this.resolveStaffUser(body.userId)

    let preset: IStaffErrorPreset | null = null
    if (body.presetId) {
      if (!ObjectId.isValid(body.presetId)) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.INVALID_PRESET_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      preset = await databaseService.staffErrorPresets.findOne({
        _id: new ObjectId(body.presetId),
        isActive: true
      })
      if (!preset) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.PRESET_NOT_FOUND,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }
    }

    const title = (body.title?.trim() || preset?.name || '').trim()
    if (!title) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.TITLE_REQUIRED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    let amount = 0
    if (body.type === StaffErrorLogType.Warning) {
      amount = 0
    } else {
      const resolved =
        body.amount !== undefined && body.amount !== null ? Number(body.amount) : (preset?.defaultAmount ?? NaN)
      if (!Number.isFinite(resolved) || resolved <= 0) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.PENALTY_AMOUNT_REQUIRED,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      amount = Math.round(resolved)
    }

    const occurredAt = body.occurredAt ? dayjs(body.occurredAt).toDate() : new Date()
    if (!dayjs(occurredAt).isValid()) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.INVALID_DATE,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()
    const log = new StaffErrorLog({
      userId: staff.id,
      userName: staff.name,
      type: body.type,
      presetId: preset?._id,
      presetCode: preset?.code,
      presetName: preset?.name,
      title,
      note: body.note.trim(),
      amount,
      occurredAt,
      status: StaffErrorLogStatus.Active,
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now
    })

    const result = await databaseService.staffErrorLogs.insertOne(log)
    return { ...log, _id: result.insertedId }
  }

  async listLogs(filter: IGetStaffErrorLogsQuery, options?: { forceUserId?: string }) {
    const query: Filter<IStaffErrorLog> = {}

    const userId = options?.forceUserId || filter.userId
    if (userId) {
      if (!ObjectId.isValid(userId)) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.INVALID_USER_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      query.userId = new ObjectId(userId)
    }

    if (filter.type) query.type = filter.type
    if (filter.status) query.status = filter.status
    if (filter.presetId) {
      if (!ObjectId.isValid(filter.presetId)) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.INVALID_PRESET_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      query.presetId = new ObjectId(filter.presetId)
    }

    if (filter.startDate || filter.endDate) {
      query.occurredAt = {}
      if (filter.startDate) {
        ;(query.occurredAt as any).$gte = dayjs(filter.startDate).startOf('day').toDate()
      }
      if (filter.endDate) {
        ;(query.occurredAt as any).$lte = dayjs(filter.endDate).endOf('day').toDate()
      }
    }

    return databaseService.staffErrorLogs.find(query).sort({ occurredAt: -1, createdAt: -1 }).toArray()
  }

  async getLogById(id: string, options?: { requesterId?: string; isAdmin?: boolean }) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.LOG_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    const log = await databaseService.staffErrorLogs.findOne({ _id: new ObjectId(id) })
    if (!log) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.LOG_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    if (options && !options.isAdmin && options.requesterId) {
      if (log.userId.toString() !== options.requesterId) {
        throw new ErrorWithStatus({
          message: STAFF_ERROR_LOG_MESSAGES.UNAUTHORIZED_ACCESS,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      }
    }
    return log
  }

  async cancelLog(id: string, actorId: string, body: ICancelStaffErrorLogBody = {}) {
    const actor = await this.resolveActor(actorId)
    const log = await this.getLogById(id)
    if (log.status === StaffErrorLogStatus.Cancelled) {
      throw new ErrorWithStatus({
        message: STAFF_ERROR_LOG_MESSAGES.LOG_ALREADY_CANCELLED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()
    const result = await databaseService.staffErrorLogs.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: StaffErrorLogStatus.Cancelled,
          cancelledBy: actor.id,
          cancelledByName: actor.name,
          cancelledAt: now,
          cancelReason: body.cancelReason?.trim(),
          updatedAt: now
        }
      },
      { returnDocument: 'after' }
    )
    return result
  }

  /**
   * Tổng penalty active trong kỳ — dùng gắn vào summary.totalSalary (không đụng lương theo ca).
   */
  async sumActivePenalties(params: ISumActivePenaltiesParams): Promise<ISumActivePenaltiesResult> {
    const match: Filter<IStaffErrorLog> = {
      type: StaffErrorLogType.Penalty,
      status: StaffErrorLogStatus.Active
    }

    if (params.userId) {
      if (!ObjectId.isValid(params.userId)) {
        return { totalDeductions: 0, deductionCount: 0 }
      }
      match.userId = new ObjectId(params.userId)
    }

    if (params.startDate || params.endDate) {
      match.occurredAt = {}
      if (params.startDate) (match.occurredAt as any).$gte = params.startDate
      if (params.endDate) (match.occurredAt as any).$lte = params.endDate
    }

    const rows = await databaseService.staffErrorLogs
      .aggregate<{ totalDeductions: number; deductionCount: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            totalDeductions: { $sum: '$amount' },
            deductionCount: { $sum: 1 }
          }
        }
      ])
      .toArray()

    const row = rows[0]
    return {
      totalDeductions: row?.totalDeductions ?? 0,
      deductionCount: row?.deductionCount ?? 0
    }
  }
}

const staffErrorLogService = new StaffErrorLogService()
export default staffErrorLogService
