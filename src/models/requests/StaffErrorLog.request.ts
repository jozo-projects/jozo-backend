import { StaffErrorLogStatus, StaffErrorLogType } from '~/constants/enum'

export interface ICreateStaffErrorPresetBody {
  code: string
  name: string
  description?: string
  defaultAmount: number
  isActive?: boolean
}

export interface IUpdateStaffErrorPresetBody {
  code?: string
  name?: string
  description?: string
  defaultAmount?: number
  isActive?: boolean
}

export interface ICreateStaffErrorLogBody {
  userId: string
  type: StaffErrorLogType
  presetId?: string
  title?: string
  note: string
  amount?: number
  occurredAt?: string
}

export interface ICancelStaffErrorLogBody {
  cancelReason?: string
}

export interface IGetStaffErrorLogsQuery {
  userId?: string
  type?: StaffErrorLogType
  status?: StaffErrorLogStatus
  startDate?: string
  endDate?: string
  presetId?: string
}
