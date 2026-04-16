import { EmployeeScheduleStatus, ShiftType } from '~/constants/enum'

// Request body khi nhân viên tự đăng ký
export interface ICreateEmployeeScheduleBody {
  date: string // ISO date string
  shifts: ShiftType[] // ["shift1"] hoặc ["shift2"] hoặc ["shift3"]
  customStartTime?: string // HH:mm - Override default start time
  customEndTime?: string // HH:mm - Override default end time
  note?: string
}

// Request body khi admin đăng ký cho nhân viên
export interface IAdminCreateScheduleBody {
  userId: string
  date: string // ISO date string
  shifts: ShiftType[] // ["shift1"] hoặc ["shift2"] hoặc ["shift3"]
  customStartTime?: string // HH:mm - Override default start time
  customEndTime?: string // HH:mm - Override default end time
  note?: string
}

// Request body khi cập nhật lịch
// - note: Staff và Admin đều có thể update
// - customStartTime/customEndTime: Chỉ Admin mới có thể update
export interface IUpdateScheduleBody {
  note?: string
  customStartTime?: string // HH:mm - Override default start time (Admin only)
  customEndTime?: string // HH:mm - Override default end time (Admin only)
}

// Request body khi approve/reject lịch
export interface IApproveScheduleBody {
  status: 'approved' | 'rejected'
  rejectedReason?: string
}

// Request body khi cập nhật status
export interface IUpdateStatusBody {
  status: EmployeeScheduleStatus
  rejectedReason?: string // Bắt buộc khi status = rejected
}

// Query params khi lấy danh sách lịch
export interface IGetSchedulesQuery {
  userId?: string
  date?: string // ISO date string - for day filter
  startDate?: string // ISO date string - for week filter
  endDate?: string // ISO date string - for week filter
  status?: EmployeeScheduleStatus
  shiftType?: ShiftType
  filterType?: 'day' | 'week'
}
