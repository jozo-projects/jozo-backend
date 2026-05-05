import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { EventEmitter } from 'events'
import { ObjectId } from 'mongodb'
import { EmployeeScheduleStatus, NotificationType, ShiftType, UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { EMPLOYEE_SCHEDULE_MESSAGES, NOTIFICATION_MESSAGES } from '~/constants/messages'
import { getShiftInfo } from '~/constants/shiftDefaults'
import { ErrorWithStatus } from '~/models/Error'
import {
  IAdminCreateScheduleBody,
  ICreateEmployeeScheduleBody,
  IGetSchedulesQuery,
  IGetSpecialSalaryDaysQuery,
  IUpdateSalarySnapshotBody,
  IUpdateScheduleBody,
  IUpdateStatusBody,
  IUpsertSpecialSalaryDayBody
} from '~/models/requests/EmployeeSchedule.request'
import { HourlyRateMap, HourlyShiftMap } from '~/models/schemas/EmployeeSalarySnapshot.schema'
import { EmployeeSchedule, IEmployeeSalarySnapshotInSchedule } from '~/models/schemas/EmployeeSchedule.schema'
import databaseService from './database.service'
import notificationService from './notification.service'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)
dayjs.tz.setDefault('Asia/Ho_Chi_Minh')

// EventEmitter cho employee schedule events
export const employeeScheduleEventEmitter = new EventEmitter()
const DEFAULT_HOURLY_RATE = 25000
const NIGHT_SHIFT_CUTOFF_HOUR = 6

type UserProbationFields = {
  probationStartDate?: Date
  probationEndDate?: Date
  probationHourlyRate?: number
  probationHolidayMultiplier?: number
}

class EmployeeScheduleService {
  /**
   * Nhân viên tự đăng ký lịch (status = Pending)
   */
  async createSchedule(userId: string, data: ICreateEmployeeScheduleBody) {
    const { date, shifts, customStartTime, customEndTime, note } = data

    // Validate shifts array
    this.validateShifts(shifts)

    // Lấy thông tin user
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })
    if (!user) {
      throw new ErrorWithStatus({
        message: 'User không tồn tại',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const dateObj = dayjs(date).startOf('day').toDate()
    const createdSchedules: EmployeeSchedule[] = []
    const salarySnapshot = await this.buildGlobalSalarySnapshotInSchedule()

    // Tạo schedule cho mỗi ca
    for (const shiftType of shifts) {
      // Kiểm tra conflict
      await this.checkConflict(userId, dateObj, shiftType)

      const schedule = new EmployeeSchedule({
        userId: new ObjectId(userId),
        userName: user.name,
        userPhone: user.phone_number,
        date: dateObj,
        shiftType,
        customStartTime,
        customEndTime,
        status: EmployeeScheduleStatus.Pending,
        note,
        salarySnapshot,
        createdBy: new ObjectId(userId),
        createdByName: user.name,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const result = await databaseService.employeeSchedules.insertOne(schedule)
      createdSchedules.push({ ...schedule, _id: result.insertedId })
    }

    // Emit event để notify admin về đăng ký ca mới
    employeeScheduleEventEmitter.emit('schedule_created', {
      userId,
      schedules: createdSchedules,
      type: 'employee_register'
    })

    // Tạo notification cho tất cả admins
    const admins = await databaseService.users.find({ role: UserRole.Admin }).toArray()
    const adminIds = admins.map((admin) => admin._id.toString())

    if (adminIds.length > 0) {
      const dateStr = dayjs(dateObj).format('DD/MM/YYYY')
      const shiftStr = shifts.map((shift) => getShiftInfo(shift).name).join(', ')
      const title = notificationService.formatMessage(NOTIFICATION_MESSAGES.SCHEDULE_CREATED_BY_EMPLOYEE_TITLE, {})
      const body = notificationService.formatMessage(NOTIFICATION_MESSAGES.SCHEDULE_CREATED_BY_EMPLOYEE_BODY, {
        employeeName: user.name,
        shiftType: shiftStr,
        date: dateStr
      })

      await notificationService.createNotificationForMultipleUsers(
        adminIds,
        title,
        body,
        NotificationType.SCHEDULE_CREATED_BY_EMPLOYEE,
        {
          scheduleId: createdSchedules[0]._id?.toString(),
          scheduleDate: dateStr,
          shiftType: shiftStr,
          userId
        }
      )
    }

    return createdSchedules
  }

  /**
   * Admin tạo lịch cho nhân viên (status = Approved)
   */
  async adminCreateSchedule(adminId: string, data: IAdminCreateScheduleBody) {
    const { userId, date, shifts, customStartTime, customEndTime, note } = data

    // Validate shifts array
    this.validateShifts(shifts)

    // Lấy thông tin user và admin
    const [user, admin] = await Promise.all([
      databaseService.users.findOne({ _id: new ObjectId(userId) }),
      databaseService.users.findOne({ _id: new ObjectId(adminId) })
    ])

    if (!user) {
      throw new ErrorWithStatus({
        message: 'User không tồn tại',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const dateObj = dayjs(date).startOf('day').toDate()
    const createdSchedules: EmployeeSchedule[] = []
    const salarySnapshot = await this.buildGlobalSalarySnapshotInSchedule()

    // Tạo schedule cho mỗi ca
    for (const shiftType of shifts) {
      // Kiểm tra conflict
      await this.checkConflict(userId, dateObj, shiftType)

      const schedule = new EmployeeSchedule({
        userId: new ObjectId(userId),
        userName: user.name,
        userPhone: user.phone_number,
        date: dateObj,
        shiftType,
        customStartTime,
        customEndTime,
        status: EmployeeScheduleStatus.Approved, // Admin tạo thì approved luôn
        note,
        salarySnapshot,
        createdBy: new ObjectId(adminId),
        createdByName: admin?.name,
        approvedBy: new ObjectId(adminId),
        approvedByName: admin?.name,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const result = await databaseService.employeeSchedules.insertOne(schedule)
      createdSchedules.push({ ...schedule, _id: result.insertedId })
    }

    // Emit event để notify nhân viên về ca được admin tạo
    employeeScheduleEventEmitter.emit('schedule_created', {
      userId,
      schedules: createdSchedules,
      type: 'admin_create'
    })

    // Tạo notification cho nhân viên
    const dateStr = dayjs(dateObj).format('DD/MM/YYYY')
    const shiftStr = shifts.map((shift) => getShiftInfo(shift).name).join(', ')
    const title = notificationService.formatMessage(NOTIFICATION_MESSAGES.SCHEDULE_CREATED_BY_ADMIN_TITLE, {})
    const body = notificationService.formatMessage(NOTIFICATION_MESSAGES.SCHEDULE_CREATED_BY_ADMIN_BODY, {
      shiftType: shiftStr,
      date: dateStr
    })

    await notificationService.createNotification(userId, title, body, NotificationType.SCHEDULE_CREATED_BY_ADMIN, {
      scheduleId: createdSchedules[0]._id?.toString(),
      scheduleDate: dateStr,
      shiftType: shiftStr
    })

    return createdSchedules
  }

  /**
   * Lấy danh sách lịch với filter và group by date
   */
  async getSchedules(filter: IGetSchedulesQuery, requestUserId?: string, isAdmin: boolean = false) {
    const query: any = {}

    // Nếu không phải admin thì chỉ xem được lịch của mình
    if (!isAdmin && requestUserId) {
      query.userId = new ObjectId(requestUserId)
    }

    // Filter theo userId (admin có thể filter theo user cụ thể)
    if (filter.userId && isAdmin) {
      query.userId = new ObjectId(filter.userId)
    }

    // Filter theo date/week
    if (filter.filterType === 'day' && filter.date) {
      const dayStart = dayjs(filter.date).startOf('day').toDate()
      const dayEnd = dayjs(filter.date).endOf('day').toDate()
      query.date = { $gte: dayStart, $lte: dayEnd }
    } else if (filter.filterType === 'week' && filter.startDate) {
      const weekStart = dayjs(filter.startDate).startOf('isoWeek').toDate()
      const weekEnd = dayjs(filter.startDate).endOf('isoWeek').toDate()
      query.date = { $gte: weekStart, $lte: weekEnd }
    } else if (filter.startDate && filter.endDate) {
      query.date = {
        $gte: dayjs(filter.startDate).startOf('day').toDate(),
        $lte: dayjs(filter.endDate).endOf('day').toDate()
      }
    }

    // Filter theo status
    if (filter.status) {
      query.status = filter.status
    }

    // Filter theo shiftType
    if (filter.shiftType) {
      query.shiftType = filter.shiftType
    }

    // Lấy schedules và sort theo date, shiftType
    const schedules = await databaseService.employeeSchedules.find(query).sort({ date: 1, shiftType: 1 }).toArray()
    const globalSnapshot = this.wrapGlobalSalarySnapshotDoc(await this.ensureGlobalSalarySnapshot())
    const salaryView: 'compact' | 'full' = filter.salaryView === 'compact' ? 'compact' : 'full'

    const userIdStrings = [...new Set(schedules.map((s) => s.userId.toString()))]
    const probationUsers = await databaseService.users
      .find(
        { _id: { $in: userIdStrings.map((id) => new ObjectId(id)) } },
        {
          projection: {
            probationStartDate: 1,
            probationEndDate: 1,
            probationHourlyRate: 1,
            probationHolidayMultiplier: 1
          }
        }
      )
      .toArray()
    const userProbationById = new Map<string, UserProbationFields>(
      probationUsers.map((u) => [u._id!.toString(), u as unknown as UserProbationFields])
    )

    const allBusinessDateKeys = new Set<string>()
    for (const schedule of schedules) {
      const userProbation = userProbationById.get(schedule.userId.toString())
      const resolvedSalary = this.resolveEffectiveSalarySnapshot({
        scheduleSnapshot: schedule.salarySnapshot,
        globalScheduleSnapshot: globalSnapshot,
        scheduleDate: schedule.date,
        user: userProbation
      })
      const salarySnapshot = resolvedSalary.salarySnapshot
      const shiftInfo = this.getShiftInfoFromSnapshot(schedule.shiftType, salarySnapshot, {
        customStartTime: schedule.customStartTime,
        customEndTime: schedule.customEndTime
      })
      for (const key of this.collectBusinessDateKeysForShift(schedule.date, shiftInfo.startTime, shiftInfo.endTime)) {
        allBusinessDateKeys.add(key)
      }
    }

    const specialByDate = await this.loadSpecialDaysForKeys([...allBusinessDateKeys])
    const holidayPayConfig = await this.loadHolidayPayConfigByBusinessDate([...allBusinessDateKeys])

    // Group by date và populate shift info
    const schedulesByDate: Record<string, any[]> = {}
    let totalShifts = 0
    let totalSalary = 0
    const statusCount = {
      pending: 0,
      approved: 0,
      'in-progress': 0,
      completed: 0,
      absent: 0,
      rejected: 0,
      cancelled: 0
    }

    for (const schedule of schedules) {
      const dateKey = dayjs(schedule.date).format('YYYY-MM-DD')
      const userProbation = userProbationById.get(schedule.userId.toString())
      const resolvedSalary = this.resolveEffectiveSalarySnapshot({
        scheduleSnapshot: schedule.salarySnapshot,
        globalScheduleSnapshot: globalSnapshot,
        scheduleDate: schedule.date,
        user: userProbation
      })
      const salarySnapshot = resolvedSalary.salarySnapshot
      const shiftInfo = this.getShiftInfoFromSnapshot(schedule.shiftType, salarySnapshot, {
        customStartTime: schedule.customStartTime,
        customEndTime: schedule.customEndTime
      })
      const salary = this.calculateScheduleSalary(
        shiftInfo.startTime,
        shiftInfo.endTime,
        schedule.shiftType,
        schedule.date,
        salarySnapshot,
        schedule.status,
        resolvedSalary.salarySource,
        specialByDate,
        holidayPayConfig,
        resolvedSalary.probationHolidayMultiplier
      )

      const scheduleWithInfo = this.applySalaryViewToSchedulePayload(
        {
          _id: schedule._id,
          userId: schedule.userId,
          userName: schedule.userName,
          userPhone: schedule.userPhone,
          date: schedule.date,
          shiftType: schedule.shiftType,
          customStartTime: schedule.customStartTime,
          customEndTime: schedule.customEndTime,
          shiftInfo,
          salarySnapshot,
          salarySource: resolvedSalary.salarySource,
          salaryResolution: salary.salaryResolution,
          salary: {
            hourlyRate: salary.hourlyRate,
            hours: salary.hours,
            totalAmount: salary.totalAmount,
            isPayable: salary.isPayable,
            hourlyBreakdown: salary.hourlyBreakdown
          },
          status: schedule.status,
          note: schedule.note,
          createdBy: schedule.createdBy,
          createdByName: schedule.createdByName,
          approvedBy: schedule.approvedBy,
          approvedByName: schedule.approvedByName,
          approvedAt: schedule.approvedAt,
          rejectedBy: schedule.rejectedBy,
          rejectedByName: schedule.rejectedByName,
          rejectedAt: schedule.rejectedAt,
          rejectedReason: schedule.rejectedReason,
          startedAt: schedule.startedAt,
          completedAt: schedule.completedAt,
          markedAbsentBy: schedule.markedAbsentBy,
          markedAbsentAt: schedule.markedAbsentAt,
          createdAt: schedule.createdAt,
          updatedAt: schedule.updatedAt
        },
        salaryView
      )

      if (!schedulesByDate[dateKey]) {
        schedulesByDate[dateKey] = []
      }
      schedulesByDate[dateKey].push(scheduleWithInfo)

      totalShifts++
      statusCount[schedule.status as keyof typeof statusCount]++
      if (salary.isPayable) {
        totalSalary += salary.totalAmount
      }
    }

    // Calculate additional stats
    const completed = statusCount.completed
    const inProgress = statusCount['in-progress']
    const upcoming = statusCount.approved

    return {
      schedulesByDate,
      summary: {
        totalDays: Object.keys(schedulesByDate).length,
        totalShifts,
        completed,
        inProgress,
        upcoming,
        totalSalary,
        byStatus: statusCount
      }
    }
  }

  /**
   * Lấy chi tiết một schedule
   */
  async getScheduleById(id: string, options?: { salaryView?: 'compact' | 'full' }) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const globalSnapshot = this.wrapGlobalSalarySnapshotDoc(await this.ensureGlobalSalarySnapshot())
    const probationUser = await databaseService.users.findOne(
      { _id: schedule.userId },
      {
        projection: {
          probationStartDate: 1,
          probationEndDate: 1,
          probationHourlyRate: 1,
          probationHolidayMultiplier: 1
        }
      }
    )
    const resolvedSalary = this.resolveEffectiveSalarySnapshot({
      scheduleSnapshot: schedule.salarySnapshot,
      globalScheduleSnapshot: globalSnapshot,
      scheduleDate: schedule.date,
      user: (probationUser as unknown as UserProbationFields) ?? undefined
    })
    const salarySnapshot = resolvedSalary.salarySnapshot
    const shiftInfo = this.getShiftInfoFromSnapshot(schedule.shiftType, salarySnapshot, {
      customStartTime: schedule.customStartTime,
      customEndTime: schedule.customEndTime
    })

    const businessKeys = this.collectBusinessDateKeysForShift(schedule.date, shiftInfo.startTime, shiftInfo.endTime)
    const specialByDate = await this.loadSpecialDaysForKeys(businessKeys)
    const holidayPayConfig = await this.loadHolidayPayConfigByBusinessDate(businessKeys)

    const salary = this.calculateScheduleSalary(
      shiftInfo.startTime,
      shiftInfo.endTime,
      schedule.shiftType,
      schedule.date,
      salarySnapshot,
      schedule.status,
      resolvedSalary.salarySource,
      specialByDate,
      holidayPayConfig,
      resolvedSalary.probationHolidayMultiplier
    )

    const salaryView: 'compact' | 'full' = options?.salaryView === 'compact' ? 'compact' : 'full'

    const payload = this.applySalaryViewToSchedulePayload(
      {
        ...schedule,
        salarySnapshot,
        salarySource: resolvedSalary.salarySource,
        salaryResolution: salary.salaryResolution,
        shiftInfo,
        salary: {
          hourlyRate: salary.hourlyRate,
          hours: salary.hours,
          totalAmount: salary.totalAmount,
          isPayable: salary.isPayable,
          hourlyBreakdown: salary.hourlyBreakdown
        }
      },
      salaryView
    )

    return payload
  }

  /**
   * Cập nhật schedule (chỉ cho phép cập nhật note)
   * Note: Validation status đã được handle ở middleware (Admin bypass, Staff restricted)
   */
  async updateSchedule(id: string, data: IUpdateScheduleBody) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Status validation đã được handle ở middleware
    // Admin có thể update bất kỳ, Staff chỉ update được pending/rejected
    // Cho phép cập nhật note (Staff + Admin), customStartTime/customEndTime (chỉ Admin)

    const updateData: any = {
      updatedAt: new Date()
    }

    if (data.note !== undefined) {
      updateData.note = data.note
    }

    if (data.customStartTime !== undefined) {
      updateData.customStartTime = data.customStartTime
    }

    if (data.customEndTime !== undefined) {
      updateData.customEndTime = data.customEndTime
    }

    const result = await databaseService.employeeSchedules.updateOne({ _id: new ObjectId(id) }, { $set: updateData })

    // Emit event để notify về việc cập nhật thời gian
    if (data.customStartTime !== undefined || data.customEndTime !== undefined) {
      const updatedSchedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
      if (updatedSchedule) {
        employeeScheduleEventEmitter.emit('schedule_updated', {
          userId: updatedSchedule.userId.toString(),
          schedule: updatedSchedule,
          type: 'time_update'
        })
      }
    }

    return result.modifiedCount
  }

  /**
   * Admin approve/reject schedule
   */
  async approveSchedule(id: string, status: 'approved' | 'rejected', adminId: string, rejectedReason?: string) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Chỉ approve được Pending
    if (schedule.status !== EmployeeScheduleStatus.Pending) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.ONLY_PENDING_CAN_APPROVE,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const admin = await databaseService.users.findOne({ _id: new ObjectId(adminId) })

    const updateData: any = {
      status: status === 'approved' ? EmployeeScheduleStatus.Approved : EmployeeScheduleStatus.Rejected,
      updatedAt: new Date()
    }

    if (status === 'approved') {
      updateData.approvedBy = new ObjectId(adminId)
      updateData.approvedByName = admin?.name
      updateData.approvedAt = new Date()
    } else {
      updateData.rejectedBy = new ObjectId(adminId)
      updateData.rejectedByName = admin?.name
      updateData.rejectedAt = new Date()
      updateData.rejectedReason = rejectedReason
    }

    const result = await databaseService.employeeSchedules.updateOne({ _id: new ObjectId(id) }, { $set: updateData })

    if (result.modifiedCount > 0) {
      // Emit event để notify nhân viên về status change
      const updatedSchedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
      if (updatedSchedule) {
        employeeScheduleEventEmitter.emit('schedule_status_changed', {
          scheduleId: id,
          userId: updatedSchedule.userId.toString(),
          status: status === 'approved' ? EmployeeScheduleStatus.Approved : EmployeeScheduleStatus.Rejected,
          schedule: updatedSchedule,
          type: 'approve_reject'
        })

        // Tạo notification cho nhân viên
        const dateStr = dayjs(updatedSchedule.date).format('DD/MM/YYYY')
        const shiftType = updatedSchedule.shiftType
        const title =
          status === 'approved'
            ? NOTIFICATION_MESSAGES.SCHEDULE_APPROVED_TITLE
            : NOTIFICATION_MESSAGES.SCHEDULE_REJECTED_TITLE
        const body = notificationService.formatMessage(
          status === 'approved'
            ? NOTIFICATION_MESSAGES.SCHEDULE_APPROVED_BODY
            : NOTIFICATION_MESSAGES.SCHEDULE_REJECTED_BODY,
          {
            shiftType,
            date: dateStr
          }
        )

        await notificationService.createNotification(
          updatedSchedule.userId.toString(),
          title,
          body,
          status === 'approved' ? NotificationType.SCHEDULE_APPROVED : NotificationType.SCHEDULE_REJECTED,
          {
            scheduleId: id,
            scheduleDate: dateStr,
            shiftType,
            status: status === 'approved' ? EmployeeScheduleStatus.Approved : EmployeeScheduleStatus.Rejected,
            rejectedReason: status === 'rejected' ? rejectedReason : undefined
          }
        )
      }
    }

    return result.modifiedCount
  }

  /**
   * Cập nhật status của schedule (unified endpoint)
   * Admin có thể update bất kỳ status nào
   */
  async updateScheduleStatus(id: string, adminId: string, data: IUpdateStatusBody) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const admin = await databaseService.users.findOne({ _id: new ObjectId(adminId) })
    const { status, rejectedReason } = data
    const now = new Date()

    const updateData: any = {
      status,
      updatedAt: now
    }

    // Xử lý theo từng loại status
    switch (status) {
      case EmployeeScheduleStatus.Approved:
        updateData.approvedBy = new ObjectId(adminId)
        updateData.approvedByName = admin?.name
        updateData.approvedAt = now
        break

      case EmployeeScheduleStatus.Rejected:
        updateData.rejectedBy = new ObjectId(adminId)
        updateData.rejectedByName = admin?.name
        updateData.rejectedAt = now
        updateData.rejectedReason = rejectedReason
        break

      case EmployeeScheduleStatus.InProgress:
        if (!schedule.startedAt) {
          updateData.startedAt = now
        }
        break

      case EmployeeScheduleStatus.Completed:
        if (!schedule.completedAt) {
          updateData.completedAt = now
        }
        break

      case EmployeeScheduleStatus.Absent:
        updateData.markedAbsentBy = new ObjectId(adminId)
        updateData.markedAbsentAt = now
        break

      case EmployeeScheduleStatus.Cancelled:
        // Cancelled không cần thêm field đặc biệt
        break

      default:
        break
    }

    const result = await databaseService.employeeSchedules.updateOne({ _id: new ObjectId(id) }, { $set: updateData })

    if (result.modifiedCount > 0) {
      // Emit event để notify nhân viên về status change
      const updatedSchedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
      if (updatedSchedule) {
        employeeScheduleEventEmitter.emit('schedule_status_changed', {
          scheduleId: id,
          userId: updatedSchedule.userId.toString(),
          status,
          schedule: updatedSchedule,
          type: 'status_update'
        })

        // Tạo notification cho nhân viên
        const dateStr = dayjs(updatedSchedule.date).format('DD/MM/YYYY')
        const shiftType = updatedSchedule.shiftType
        const statusText = this.getStatusText(status)
        const title = NOTIFICATION_MESSAGES.SCHEDULE_STATUS_UPDATED_TITLE
        const body = notificationService.formatMessage(NOTIFICATION_MESSAGES.SCHEDULE_STATUS_UPDATED_BODY, {
          shiftType,
          date: dateStr,
          status: statusText
        })

        await notificationService.createNotification(
          updatedSchedule.userId.toString(),
          title,
          body,
          NotificationType.SCHEDULE_STATUS_UPDATED,
          {
            scheduleId: id,
            scheduleDate: dateStr,
            shiftType,
            status
          }
        )
      }
    }

    return result.modifiedCount
  }

  /**
   * Admin mark absent
   */
  async markAbsent(id: string, adminId: string) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (schedule.status === EmployeeScheduleStatus.Absent) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.ALREADY_ABSENT,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await databaseService.employeeSchedules.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: EmployeeScheduleStatus.Absent,
          markedAbsentBy: new ObjectId(adminId),
          markedAbsentAt: new Date(),
          updatedAt: new Date()
        }
      }
    )

    return result.modifiedCount
  }

  /**
   * Admin mark completed (manual)
   */
  async markCompleted(id: string, _adminId: string) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (schedule.status === EmployeeScheduleStatus.Completed) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.ALREADY_COMPLETED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await databaseService.employeeSchedules.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: EmployeeScheduleStatus.Completed,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      }
    )

    return result.modifiedCount
  }

  /**
   * Xóa schedule
   * Note: Validation status đã được handle ở middleware (Admin bypass, Staff restricted)
   */
  async deleteSchedule(id: string) {
    if (!ObjectId.isValid(id)) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Status validation đã được handle ở middleware
    // Admin có thể delete bất kỳ, Staff chỉ delete được pending/rejected

    const result = await databaseService.employeeSchedules.deleteOne({ _id: new ObjectId(id) })
    return result.deletedCount
  }

  /**
   * Lấy global salary snapshot
   */
  async getGlobalSalarySnapshot() {
    const snapshot = await this.ensureGlobalSalarySnapshot()
    return snapshot
  }

  /**
   * Admin cập nhật global salary snapshot
   */
  async updateGlobalSalarySnapshot(adminId: string, data: IUpdateSalarySnapshotBody) {
    const admin = await databaseService.users.findOne({ _id: new ObjectId(adminId) })
    const now = new Date()
    const normalizedRateMap = this.resolveHourlyRateMapPayload(data)
    const normalizedShiftMap = this.normalizeHourlyShiftMap(data.hourlyShiftMap)

    await databaseService.employeeSalarySnapshots.updateOne(
      { key: 'default' },
      {
        $set: {
          key: 'default',
          hourlyRateMap: normalizedRateMap,
          hourlyShiftMap: normalizedShiftMap,
          updatedBy: new ObjectId(adminId),
          updatedByName: admin?.name,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    )

    return databaseService.employeeSalarySnapshots.findOne({ key: 'default' })
  }

  /**
   * Đồng bộ lương tất cả staff từ global snapshot
   */
  async syncSalaryConfigsFromSnapshot(adminId: string) {
    const [snapshot, admin, staffs] = await Promise.all([
      this.ensureGlobalSalarySnapshot(),
      databaseService.users.findOne({ _id: new ObjectId(adminId) }),
      databaseService.users.find({ role: UserRole.Staff }).toArray()
    ])
    const now = new Date()

    if (staffs.length === 0) {
      return {
        totalStaffs: 0,
        syncedCount: 0,
        snapshotHourlyRateMap: snapshot.hourlyRateMap
      }
    }

    const operations = staffs.map((staff) => {
      return {
        updateOne: {
          filter: { userId: staff._id },
          update: {
            $set: {
              userName: staff.name,
              userPhone: staff.phone_number,
              snapshotHourlyRateMap: this.normalizeHourlyRateMap(snapshot.hourlyRateMap),
              snapshotHourlyShiftMap: this.normalizeHourlyShiftMap(snapshot.hourlyShiftMap),
              hourlyRateMap: this.normalizeHourlyRateMap(snapshot.hourlyRateMap),
              hourlyShiftMap: this.normalizeHourlyShiftMap(snapshot.hourlyShiftMap),
              isOverride: false,
              syncedAt: now,
              updatedBy: new ObjectId(adminId),
              updatedByName: admin?.name,
              updatedAt: now
            },
            $setOnInsert: {
              userId: staff._id,
              createdAt: now
            }
          },
          upsert: true
        }
      }
    })

    if (operations.length > 0) {
      await databaseService.employeeSalaryConfigs.bulkWrite(operations)
    }

    return {
      totalStaffs: staffs.length,
      syncedCount: staffs.length,
      snapshotHourlyRateMap: snapshot.hourlyRateMap
    }
  }

  /**
   * Danh sách lương tất cả staff
   */
  async getEmployeeSalaryConfigs() {
    const [snapshot, staffs, configs] = await Promise.all([
      this.ensureGlobalSalarySnapshot(),
      databaseService.users.find({ role: UserRole.Staff }).toArray(),
      databaseService.employeeSalaryConfigs.find({}).toArray()
    ])
    const configMap = new Map(configs.map((config) => [config.userId.toString(), config]))

    return staffs.map((staff) => {
      const config = configMap.get(staff._id.toString())
      return {
        userId: staff._id,
        userName: staff.name,
        userPhone: staff.phone_number,
        hourlyRateMap: this.normalizeHourlyRateMap(config?.hourlyRateMap ?? snapshot.hourlyRateMap),
        hourlyShiftMap: this.normalizeHourlyShiftMap(config?.hourlyShiftMap ?? snapshot.hourlyShiftMap),
        isOverride: config?.isOverride ?? false,
        snapshotHourlyRateMap: this.normalizeHourlyRateMap(config?.snapshotHourlyRateMap ?? snapshot.hourlyRateMap),
        snapshotHourlyShiftMap: this.normalizeHourlyShiftMap(config?.snapshotHourlyShiftMap ?? snapshot.hourlyShiftMap),
        syncedAt: config?.syncedAt,
        updatedAt: config?.updatedAt
      }
    })
  }

  async listSpecialSalaryDays(query: IGetSpecialSalaryDaysQuery) {
    const filter: Record<string, unknown> = {}
    if (query.from !== undefined && query.to !== undefined) {
      filter.businessDate = { $gte: query.from, $lte: query.to }
    } else if (query.from !== undefined) {
      filter.businessDate = { $gte: query.from }
    } else if (query.to !== undefined) {
      filter.businessDate = { $lte: query.to }
    }
    return databaseService.employeeSalarySpecialDays.find(filter).sort({ businessDate: 1 }).toArray()
  }

  async upsertSpecialSalaryDay(adminId: string, data: IUpsertSpecialSalaryDayBody) {
    const parsed = dayjs(data.businessDate)
    if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== data.businessDate) {
      throw new ErrorWithStatus({
        message: 'businessDate phải là chuỗi YYYY-MM-DD hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const admin = await databaseService.users.findOne({ _id: new ObjectId(adminId) })
    const normalizedMap = this.normalizePartialHourlyAmountMap(data.hourlyAmountMap)
    if (Object.keys(normalizedMap).length === 0) {
      throw new ErrorWithStatus({
        message: 'hourlyAmountMap cần có ít nhất một giờ hợp lệ (0–23)',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()
    await databaseService.employeeSalarySpecialDays.updateOne(
      { businessDate: data.businessDate },
      {
        $set: {
          businessDate: data.businessDate,
          hourlyAmountMap: normalizedMap,
          updatedBy: new ObjectId(adminId),
          updatedByName: admin?.name,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    )

    return databaseService.employeeSalarySpecialDays.findOne({ businessDate: data.businessDate })
  }

  async deleteSpecialSalaryDay(businessDate: string) {
    const parsed = dayjs(businessDate)
    if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== businessDate) {
      throw new ErrorWithStatus({
        message: 'businessDate phải là chuỗi YYYY-MM-DD hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await databaseService.employeeSalarySpecialDays.deleteOne({ businessDate })
    if (result.deletedCount === 0) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy cấu hình lương ngày đặc biệt',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
  }

  /**
   * Cronjob: Auto start shifts (approved → in-progress)
   */
  async autoStartShifts() {
    const now = dayjs().tz('Asia/Ho_Chi_Minh').toDate()
    const today = dayjs().tz('Asia/Ho_Chi_Minh').startOf('day').toDate()

    console.log(`[Auto Start Shifts] Current time: ${dayjs(now).format('YYYY-MM-DD HH:mm:ss')}`)
    console.log(`[Auto Start Shifts] Today start: ${dayjs(today).format('YYYY-MM-DD HH:mm:ss')}`)

    // Find approved schedules that should have started
    const schedules = await databaseService.employeeSchedules
      .find({
        status: EmployeeScheduleStatus.Approved,
        date: { $lte: today },
        startedAt: { $exists: false }
      })
      .limit(1000)
      .toArray()

    console.log(`[Auto Start Shifts] Found ${schedules.length} approved schedules without startedAt`)

    const toStart = []

    for (const schedule of schedules) {
      const startTime = this.calculateStartDateTime(
        schedule.date,
        schedule.shiftType,
        schedule.salarySnapshot,
        schedule.customStartTime,
        schedule.customEndTime
      )
      const shouldStart = now >= startTime

      console.log(
        `[Auto Start Shifts] Schedule ${schedule._id}: ${schedule.shiftType} on ${dayjs(schedule.date).format('YYYY-MM-DD')}, ` +
          `startTime: ${dayjs(startTime).format('YYYY-MM-DD HH:mm:ss')}, shouldStart: ${shouldStart}`
      )

      if (shouldStart) {
        toStart.push(schedule._id)
      }
    }

    if (toStart.length > 0) {
      await databaseService.employeeSchedules.updateMany(
        { _id: { $in: toStart } },
        {
          $set: {
            status: EmployeeScheduleStatus.InProgress,
            startedAt: now,
            updatedAt: now
          }
        }
      )
      console.log(`✅ Auto started ${toStart.length} shifts`)
    }

    return toStart.length
  }

  /**
   * Cronjob: Auto complete shifts (in-progress → completed)
   */
  async autoCompleteShifts() {
    const now = dayjs().tz('Asia/Ho_Chi_Minh').toDate()
    const today = dayjs().tz('Asia/Ho_Chi_Minh').startOf('day').toDate()

    console.log(`[Auto Complete Shifts] Current time: ${dayjs(now).format('YYYY-MM-DD HH:mm:ss')}`)
    console.log(`[Auto Complete Shifts] Today start: ${dayjs(today).format('YYYY-MM-DD HH:mm:ss')}`)

    // Find in-progress schedules that should be completed
    const schedules = await databaseService.employeeSchedules
      .find({
        status: EmployeeScheduleStatus.InProgress,
        date: { $lte: today },
        completedAt: { $exists: false }
      })
      .limit(1000)
      .toArray()

    console.log(`[Auto Complete Shifts] Found ${schedules.length} in-progress schedules without completedAt`)

    const toComplete = []

    for (const schedule of schedules) {
      const endTime = this.calculateEndDateTime(
        schedule.date,
        schedule.shiftType,
        schedule.salarySnapshot,
        schedule.customStartTime,
        schedule.customEndTime
      )
      const shouldComplete = now >= endTime

      console.log(
        `[Auto Complete Shifts] Schedule ${schedule._id}: ${schedule.shiftType} on ${dayjs(schedule.date).format('YYYY-MM-DD')}, ` +
          `endTime: ${dayjs(endTime).format('YYYY-MM-DD HH:mm:ss')}, shouldComplete: ${shouldComplete}`
      )

      if (shouldComplete) {
        toComplete.push(schedule._id)
      }
    }

    if (toComplete.length > 0) {
      await databaseService.employeeSchedules.updateMany(
        { _id: { $in: toComplete } },
        {
          $set: {
            status: EmployeeScheduleStatus.Completed,
            completedAt: now,
            updatedAt: now
          }
        }
      )
      console.log(`✅ Auto completed ${toComplete.length} shifts`)
    }

    return toComplete.length
  }

  /**
   * Helper: Calculate start date time
   */
  private calculateStartDateTime(
    date: Date,
    shiftType: ShiftType,
    salarySnapshot?: IEmployeeSalarySnapshotInSchedule,
    customStartTime?: string,
    customEndTime?: string
  ): Date {
    const shiftInfo = this.getShiftInfoFromSnapshot(shiftType, salarySnapshot, { customStartTime, customEndTime })
    const [hours, minutes] = shiftInfo.startTime.split(':').map(Number)

    return dayjs(date).hour(hours).minute(minutes).second(0).millisecond(0).toDate()
  }

  /**
   * Helper: Calculate end date time
   */
  private calculateEndDateTime(
    date: Date,
    shiftType: ShiftType,
    salarySnapshot?: IEmployeeSalarySnapshotInSchedule,
    customStartTime?: string,
    customEndTime?: string
  ): Date {
    const shiftInfo = this.getShiftInfoFromSnapshot(shiftType, salarySnapshot, { customStartTime, customEndTime })
    const [startHours, startMinutes] = shiftInfo.startTime.split(':').map(Number)
    const [hours, minutes] = shiftInfo.endTime.split(':').map(Number)
    let endDateTime = dayjs(date).hour(hours).minute(minutes).second(0).millisecond(0)

    if (hours < startHours || (hours === startHours && minutes <= startMinutes)) {
      endDateTime = endDateTime.add(1, 'day')
    }

    return endDateTime.toDate()
  }

  /**
   * Kiểm tra conflict - không cho đăng ký trùng ca trong cùng ngày
   * (trừ khi status = Rejected, Cancelled, Completed, Absent)
   */
  async checkConflict(userId: string, date: Date, shiftType: ShiftType, excludeId?: string) {
    const baseQuery: any = {
      userId: new ObjectId(userId),
      date: {
        $gte: dayjs(date).startOf('day').toDate(),
        $lte: dayjs(date).endOf('day').toDate()
      }
    }

    if (excludeId) {
      baseQuery._id = { $ne: new ObjectId(excludeId) }
    }

    const query = {
      ...baseQuery,
      shiftType
    }

    const existingSchedule = await databaseService.employeeSchedules.findOne(query)

    if (existingSchedule) {
      const shiftName = getShiftInfo(existingSchedule.shiftType).name
      throw new ErrorWithStatus({
        message: `Nhân viên đã có ca ${shiftName} cho ngày ${dayjs(date).format('DD/MM/YYYY')}. Vui lòng xóa ca cũ trước khi đăng ký ca mới.`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  /**
   * Helper: tạo/lấy global snapshot mặc định
   */
  private async ensureGlobalSalarySnapshot() {
    const existing = await databaseService.employeeSalarySnapshots.findOne({ key: 'default' })
    if (existing) {
      return {
        ...existing,
        hourlyRateMap: this.normalizeHourlyRateMap(existing.hourlyRateMap),
        hourlyShiftMap: this.normalizeHourlyShiftMap(existing.hourlyShiftMap)
      }
    }

    const now = new Date()
    const fallback = {
      key: 'default' as const,
      hourlyRateMap: this.createDefaultHourlyRateMap(DEFAULT_HOURLY_RATE),
      hourlyShiftMap: this.createDefaultHourlyShiftMap(),
      createdAt: now,
      updatedAt: now
    }
    await databaseService.employeeSalarySnapshots.insertOne(fallback)
    return fallback
  }

  private async buildGlobalSalarySnapshotInSchedule(): Promise<IEmployeeSalarySnapshotInSchedule> {
    return this.wrapGlobalSalarySnapshotDoc(await this.ensureGlobalSalarySnapshot())
  }

  private wrapGlobalSalarySnapshotDoc(snapshot: {
    hourlyRateMap: HourlyRateMap
    hourlyShiftMap: HourlyShiftMap
  }): IEmployeeSalarySnapshotInSchedule {
    const now = new Date()
    const hourlyRateMap = this.normalizeHourlyRateMap(snapshot.hourlyRateMap)
    const hourlyShiftMap = this.normalizeHourlyShiftMap(snapshot.hourlyShiftMap)
    return {
      hourlyRateMap,
      hourlyShiftMap,
      source: 'global',
      syncedFromSnapshotRateMap: hourlyRateMap,
      syncedFromSnapshotShiftMap: hourlyShiftMap,
      capturedAt: now
    }
  }

  private createDefaultSalarySnapshot(): IEmployeeSalarySnapshotInSchedule {
    return {
      hourlyRateMap: this.createDefaultHourlyRateMap(DEFAULT_HOURLY_RATE),
      hourlyShiftMap: this.createDefaultHourlyShiftMap(),
      source: 'global',
      syncedFromSnapshotRateMap: this.createDefaultHourlyRateMap(DEFAULT_HOURLY_RATE),
      syncedFromSnapshotShiftMap: this.createDefaultHourlyShiftMap(),
      capturedAt: new Date()
    }
  }

  private collectBusinessDateKeysForShift(scheduleDate: Date, startTime: string, endTime: string): string[] {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const [endHour, endMinute] = endTime.split(':').map(Number)
    const startTotalMinutes = startHour * 60 + startMinute
    let endTotalMinutes = endHour * 60 + endMinute
    if (endTotalMinutes <= startTotalMinutes) {
      endTotalMinutes += 24 * 60
    }

    const scheduleDay = dayjs(scheduleDate).startOf('day')
    const keys = new Set<string>()
    for (let cursor = startTotalMinutes; cursor < endTotalMinutes; ) {
      const normalizedMinute = cursor % (24 * 60)
      const hour = Math.floor(normalizedMinute / 60)
      const nextHourCursor = Math.min(Math.floor(cursor / 60) * 60 + 60, endTotalMinutes)
      const dateOffset = Math.floor(cursor / (24 * 60))
      const blockDate = scheduleDay.add(dateOffset, 'day')
      const businessDate = hour < NIGHT_SHIFT_CUTOFF_HOUR ? blockDate.subtract(1, 'day') : blockDate
      keys.add(businessDate.format('YYYY-MM-DD'))
      cursor = nextHourCursor
    }
    return [...keys]
  }

  private normalizePartialHourlyAmountMap(map: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(map)) {
      const hourNum = Number(key)
      if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
        continue
      }
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        continue
      }
      out[hourNum.toString()] = value
    }
    return out
  }

  private async loadSpecialDaysForKeys(businessDateKeys: string[]) {
    const map = new Map<string, Record<string, number>>()
    if (businessDateKeys.length === 0) {
      return map
    }

    const uniqueKeys = [...new Set(businessDateKeys)]
    const docs = await databaseService.employeeSalarySpecialDays.find({ businessDate: { $in: uniqueKeys } }).toArray()

    for (const doc of docs) {
      map.set(doc.businessDate, this.normalizePartialHourlyAmountMap(doc.hourlyAmountMap))
    }
    return map
  }

  /**
   * businessDate (YYYY-MM-DD) có trong map ⇔ có bản ghi holiday tương ứng.
   * Value: hệ số trên holiday (null = chưa cấu trên document — NV thử việc chỉ fallback nếu user có probationHolidayMultiplier > 0).
   */
  private async loadHolidayPayConfigByBusinessDate(businessDateKeys: string[]) {
    const map = new Map<string, number | null>()
    if (businessDateKeys.length === 0) {
      return map
    }

    const unique = [...new Set(businessDateKeys)].sort()
    const min = dayjs(unique[0]).startOf('day').toDate()
    const max = dayjs(unique[unique.length - 1])
      .endOf('day')
      .toDate()
    const holidays = await databaseService.holidays.find({ date: { $gte: min, $lte: max } }).toArray()
    for (const h of holidays) {
      const key = dayjs(h.date).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
      const raw = (h as { salaryMultiplier?: number | null }).salaryMultiplier
      if (typeof raw === 'number' && !Number.isNaN(raw) && raw > 0) {
        map.set(key, raw)
      } else {
        map.set(key, null)
      }
    }
    return map
  }

  private isScheduleDateInProbationWindow(scheduleDate: Date, user: UserProbationFields | undefined): boolean {
    if (!user?.probationStartDate || !user?.probationEndDate) {
      return false
    }
    if (
      typeof user.probationHourlyRate !== 'number' ||
      Number.isNaN(user.probationHourlyRate) ||
      user.probationHourlyRate < 0
    ) {
      return false
    }

    const d = dayjs(scheduleDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
    const start = dayjs(user.probationStartDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
    const end = dayjs(user.probationEndDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD')
    return d >= start && d <= end
  }

  /** Chỉ trả giá trị đã lưu trên user (FE/config), không mặc định số cố định ở BE. */
  private probationHolidayMultiplierFromUser(user: UserProbationFields | undefined): number | null {
    if (
      user &&
      typeof user.probationHolidayMultiplier === 'number' &&
      !Number.isNaN(user.probationHolidayMultiplier) &&
      user.probationHolidayMultiplier > 0
    ) {
      return user.probationHolidayMultiplier
    }
    return null
  }

  private buildProbationSalarySnapshot(
    probationHourlyRate: number,
    globalScheduleSnapshot: IEmployeeSalarySnapshotInSchedule
  ): IEmployeeSalarySnapshotInSchedule {
    const now = new Date()
    const hourlyRateMap = this.createDefaultHourlyRateMap(probationHourlyRate)
    const hourlyShiftMap = this.normalizeHourlyShiftMap(globalScheduleSnapshot.hourlyShiftMap)
    return {
      hourlyRateMap,
      hourlyShiftMap,
      source: 'global',
      syncedFromSnapshotRateMap: hourlyRateMap,
      syncedFromSnapshotShiftMap: hourlyShiftMap,
      capturedAt: now
    }
  }

  private resolveEffectiveSalarySnapshot({
    scheduleSnapshot,
    globalScheduleSnapshot,
    scheduleDate,
    user
  }: {
    scheduleSnapshot?: IEmployeeSalarySnapshotInSchedule
    globalScheduleSnapshot: IEmployeeSalarySnapshotInSchedule
    scheduleDate: Date
    user?: UserProbationFields | null
  }): {
    salarySnapshot: IEmployeeSalarySnapshotInSchedule
    salarySource: 'legacy_manual' | 'probation' | 'global'
    probationHolidayMultiplier: number | null
  } {
    if (scheduleSnapshot?.source === 'manual') {
      return {
        salarySnapshot: this.normalizeScheduleSalarySnapshot(scheduleSnapshot),
        salarySource: 'legacy_manual',
        probationHolidayMultiplier: null
      }
    }

    if (this.isScheduleDateInProbationWindow(scheduleDate, user ?? undefined)) {
      const rate = user!.probationHourlyRate!
      return {
        salarySnapshot: this.buildProbationSalarySnapshot(rate, globalScheduleSnapshot),
        salarySource: 'probation',
        probationHolidayMultiplier: this.probationHolidayMultiplierFromUser(user ?? undefined)
      }
    }

    return {
      salarySnapshot: globalScheduleSnapshot,
      salarySource: 'global',
      probationHolidayMultiplier: null
    }
  }

  private applySalaryViewToSchedulePayload(payload: Record<string, unknown>, salaryView: 'compact' | 'full') {
    if (salaryView !== 'compact') {
      return payload
    }

    const salary = payload.salary as
      | {
          hourlyRate: number
          hours: number
          totalAmount: number
          isPayable: boolean
          hourlyBreakdown?: unknown
        }
      | undefined
    const snap = payload.salarySnapshot as IEmployeeSalarySnapshotInSchedule | undefined

    return {
      ...payload,
      salary: salary
        ? {
            hourlyRate: salary.hourlyRate,
            hours: salary.hours,
            totalAmount: salary.totalAmount,
            isPayable: salary.isPayable
          }
        : salary,
      salarySnapshot: snap
        ? {
            source: snap.source,
            capturedAt: snap.capturedAt
          }
        : snap
    }
  }

  private calculateScheduleSalary(
    startTime: string,
    endTime: string,
    _shiftType: ShiftType,
    scheduleDate: Date,
    salarySnapshot: IEmployeeSalarySnapshotInSchedule,
    status: EmployeeScheduleStatus,
    salarySource: 'legacy_manual' | 'probation' | 'global',
    specialByDate: Map<string, Record<string, number>>,
    holidayPayConfig: Map<string, number | null>,
    probationHolidayMultiplier: number | null
  ) {
    const normalizedSnapshot = this.normalizeScheduleSalarySnapshot(salarySnapshot)
    const hourlyBreakdown = this.buildHourlyBreakdown(
      startTime,
      endTime,
      scheduleDate,
      normalizedSnapshot,
      specialByDate,
      salarySource,
      holidayPayConfig,
      probationHolidayMultiplier
    )
    const totalAmount = hourlyBreakdown.reduce((total, item) => total + item.amount, 0)
    const payableMinutes = hourlyBreakdown.reduce((total, item) => total + (item.rate > 0 ? item.minutes : 0), 0)
    const payableHours = payableMinutes / 60
    const isPayable = status === EmployeeScheduleStatus.Completed

    const specialBusinessDates = [
      ...new Set(hourlyBreakdown.filter((row) => row.basis === 'special').map((row) => row.businessDate))
    ]

    const holidayBoostSegments = hourlyBreakdown.filter((row) => row.holidayBoostApplied).length

    return {
      hourlyRate: payableHours > 0 ? Math.round((totalAmount / payableHours) * 100) / 100 : 0,
      hours: payableHours,
      totalAmount,
      isPayable,
      hourlyBreakdown,
      salaryResolution: {
        mode: salarySource,
        specialBusinessDates,
        ...(holidayBoostSegments > 0 ? { holidayBoostSegments } : {}),
        ...(salarySource === 'probation' && probationHolidayMultiplier !== null ? { probationHolidayMultiplier } : {})
      }
    }
  }

  private calculateShiftHours(startTime: string, endTime: string) {
    const [startHours, startMinutes] = startTime.split(':').map(Number)
    const [endHours, endMinutes] = endTime.split(':').map(Number)
    const startTotalMinutes = startHours * 60 + startMinutes
    let endTotalMinutes = endHours * 60 + endMinutes

    if (endTotalMinutes <= startTotalMinutes) {
      endTotalMinutes += 24 * 60
    }

    return (endTotalMinutes - startTotalMinutes) / 60
  }

  private buildHourlyBreakdown(
    startTime: string,
    endTime: string,
    scheduleDate: Date,
    salarySnapshot: IEmployeeSalarySnapshotInSchedule,
    specialByDate: Map<string, Record<string, number>>,
    salarySource: 'legacy_manual' | 'probation' | 'global',
    holidayPayConfig: Map<string, number | null>,
    probationHolidayMultiplier: number | null
  ) {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const [endHour, endMinute] = endTime.split(':').map(Number)
    const startTotalMinutes = startHour * 60 + startMinute
    let endTotalMinutes = endHour * 60 + endMinute
    if (endTotalMinutes <= startTotalMinutes) {
      endTotalMinutes += 24 * 60
    }

    const scheduleDay = dayjs(scheduleDate).startOf('day')
    const breakdown: Array<{
      hour: number
      minutes: number
      rate: number
      amount: number
      businessDate: string
      basis: 'global' | 'special'
      holidayBoostApplied?: boolean
      holidayPayFactor?: number
    }> = []
    for (let cursor = startTotalMinutes; cursor < endTotalMinutes; ) {
      const normalizedMinute = cursor % (24 * 60)
      const hour = Math.floor(normalizedMinute / 60)
      const nextHourCursor = Math.min(Math.floor(cursor / 60) * 60 + 60, endTotalMinutes)
      const minutes = nextHourCursor - cursor
      const dateOffset = Math.floor(cursor / (24 * 60))
      const blockDate = scheduleDay.add(dateOffset, 'day')
      const businessDate = hour < NIGHT_SHIFT_CUTOFF_HOUR ? blockDate.subtract(1, 'day') : blockDate
      const isSameBusinessDay = businessDate.isSame(scheduleDay, 'day')
      const hourKey = hour.toString()
      const businessDateKey = businessDate.format('YYYY-MM-DD')
      const specialMap = specialByDate.get(businessDateKey)
      const specialRate = specialMap?.[hourKey]
      const hasSpecial = typeof specialRate === 'number' && !Number.isNaN(specialRate) && specialRate >= 0

      const assignedShift = salarySnapshot.hourlyShiftMap[hourKey] ?? null
      const rate = salarySnapshot.hourlyRateMap[hourKey] ?? 0
      const hasAssignedShift = assignedShift !== null

      let payableRate = 0
      let basis: 'global' | 'special' = 'global'
      if (hasSpecial) {
        payableRate = isSameBusinessDay ? specialRate : 0
        basis = 'special'
      } else {
        payableRate = isSameBusinessDay && hasAssignedShift ? rate : 0
      }

      let holidayBoostApplied = false
      let holidayPayFactor: number | undefined
      const holidayEntry = holidayPayConfig.get(businessDateKey)
      if (holidayEntry !== undefined && basis === 'global' && payableRate > 0) {
        let factor: number | null = null
        if (typeof holidayEntry === 'number' && holidayEntry > 0) {
          factor = holidayEntry
        } else if (
          salarySource === 'probation' &&
          probationHolidayMultiplier !== null &&
          probationHolidayMultiplier > 0
        ) {
          factor = probationHolidayMultiplier
        }
        if (factor !== null && factor !== 1) {
          payableRate = Math.round(payableRate * factor * 100) / 100
          holidayBoostApplied = true
          holidayPayFactor = factor
        }
      }

      const amount = (minutes / 60) * payableRate

      breakdown.push({
        hour,
        minutes,
        rate: payableRate,
        amount: Math.round(amount),
        businessDate: businessDateKey,
        basis,
        holidayBoostApplied,
        ...(holidayPayFactor !== undefined ? { holidayPayFactor } : {})
      })
      cursor = nextHourCursor
    }

    return breakdown
  }

  private createDefaultHourlyRateMap(defaultRate: number): HourlyRateMap {
    const rateMap: HourlyRateMap = {}
    for (let hour = 0; hour < 24; hour++) {
      rateMap[hour.toString()] = defaultRate
    }
    return rateMap
  }

  private createDefaultHourlyShiftMap(): HourlyShiftMap {
    const shiftMap: HourlyShiftMap = {}
    for (let hour = 0; hour < 24; hour++) {
      if (hour >= 9 && hour < 14) {
        shiftMap[hour.toString()] = ShiftType.Shift1
      } else if (hour >= 14 && hour < 19) {
        shiftMap[hour.toString()] = ShiftType.Shift2
      } else if (hour >= 19 || hour === 0) {
        shiftMap[hour.toString()] = ShiftType.Shift3
      } else {
        shiftMap[hour.toString()] = null
      }
    }
    return shiftMap
  }

  private normalizeHourlyRateMap(rateMap?: HourlyRateMap): HourlyRateMap {
    const normalized = this.createDefaultHourlyRateMap(DEFAULT_HOURLY_RATE)
    for (let hour = 0; hour < 24; hour++) {
      const key = hour.toString()
      const value = rateMap?.[key]
      if (typeof value === 'number' && !Number.isNaN(value) && value >= 0) {
        normalized[key] = value
      }
    }
    return normalized
  }

  private resolveHourlyRateMapPayload(data: { hourlyRateMap?: HourlyRateMap; hourlyRate?: number }) {
    if (data.hourlyRateMap) {
      return this.normalizeHourlyRateMap(data.hourlyRateMap)
    }
    if (typeof data.hourlyRate === 'number' && !Number.isNaN(data.hourlyRate) && data.hourlyRate >= 0) {
      return this.createDefaultHourlyRateMap(data.hourlyRate)
    }
    return this.createDefaultHourlyRateMap(DEFAULT_HOURLY_RATE)
  }

  private normalizeHourlyShiftMap(shiftMap?: HourlyShiftMap): HourlyShiftMap {
    const normalized = this.createDefaultHourlyShiftMap()
    const validShiftValues = new Set([...Object.values(ShiftType), null])
    for (let hour = 0; hour < 24; hour++) {
      const key = hour.toString()
      const value = shiftMap?.[key] ?? null
      if (validShiftValues.has(value)) {
        normalized[key] = value
      }
    }
    return normalized
  }

  private getShiftInfoFromSnapshot(
    shiftType: ShiftType,
    snapshot?: IEmployeeSalarySnapshotInSchedule,
    options?: { customStartTime?: string; customEndTime?: string }
  ) {
    if (options?.customStartTime || options?.customEndTime) {
      return getShiftInfo(shiftType, options.customStartTime, options.customEndTime)
    }
    const normalizedSnapshot = this.normalizeScheduleSalarySnapshot(snapshot)
    const shiftMap = this.normalizeHourlyShiftMap(normalizedSnapshot.hourlyShiftMap)
    const assignedHours = Object.entries(shiftMap)
      .filter(([, assignedShift]) => assignedShift === shiftType)
      .map(([hourKey]) => Number(hourKey))
      .sort((a, b) => a - b)

    if (assignedHours.length === 0) {
      return getShiftInfo(shiftType)
    }

    let bestStart = assignedHours[0]
    let bestLength = 1
    let currentStart = assignedHours[0]
    let currentLength = 1

    for (let index = 1; index < assignedHours.length; index++) {
      const prev = assignedHours[index - 1]
      const current = assignedHours[index]
      if (current === prev + 1) {
        currentLength += 1
      } else {
        if (currentLength > bestLength) {
          bestLength = currentLength
          bestStart = currentStart
        }
        currentStart = current
        currentLength = 1
      }
    }

    if (currentLength > bestLength) {
      bestLength = currentLength
      bestStart = currentStart
    }

    const startHour = bestStart
    const endHour = (bestStart + bestLength) % 24
    return {
      name: getShiftInfo(shiftType).name,
      startTime: `${startHour.toString().padStart(2, '0')}:00`,
      endTime: `${endHour.toString().padStart(2, '0')}:00`
    }
  }

  private normalizeScheduleSalarySnapshot(
    snapshot?: IEmployeeSalarySnapshotInSchedule
  ): IEmployeeSalarySnapshotInSchedule {
    const fallback = this.createDefaultSalarySnapshot()
    if (!snapshot) {
      return fallback
    }

    const legacySnapshot = snapshot as IEmployeeSalarySnapshotInSchedule & {
      hourlyRate?: number
      syncedFromSnapshot?: number
    }
    const hasLegacyHourlyRate =
      typeof legacySnapshot.hourlyRate === 'number' &&
      !Number.isNaN(legacySnapshot.hourlyRate) &&
      legacySnapshot.hourlyRate >= 0
    const hasLegacySyncedFromSnapshot =
      typeof legacySnapshot.syncedFromSnapshot === 'number' &&
      !Number.isNaN(legacySnapshot.syncedFromSnapshot) &&
      legacySnapshot.syncedFromSnapshot >= 0

    const normalizedHourlyRateMap = snapshot.hourlyRateMap
      ? this.normalizeHourlyRateMap(snapshot.hourlyRateMap)
      : hasLegacyHourlyRate
        ? this.createDefaultHourlyRateMap(legacySnapshot.hourlyRate as number)
        : this.normalizeHourlyRateMap(fallback.hourlyRateMap)
    const normalizedSyncedFromSnapshotRateMap = snapshot.syncedFromSnapshotRateMap
      ? this.normalizeHourlyRateMap(snapshot.syncedFromSnapshotRateMap)
      : hasLegacySyncedFromSnapshot
        ? this.createDefaultHourlyRateMap(legacySnapshot.syncedFromSnapshot as number)
        : this.normalizeHourlyRateMap(fallback.syncedFromSnapshotRateMap)
    const normalizedSource =
      snapshot.source === 'global' || snapshot.source === 'override' || snapshot.source === 'manual'
        ? snapshot.source
        : fallback.source

    return {
      hourlyRateMap: normalizedHourlyRateMap,
      hourlyShiftMap: this.normalizeHourlyShiftMap(snapshot.hourlyShiftMap ?? fallback.hourlyShiftMap),
      source: normalizedSource,
      syncedFromSnapshotRateMap: normalizedSyncedFromSnapshotRateMap,
      syncedFromSnapshotShiftMap: this.normalizeHourlyShiftMap(
        snapshot.syncedFromSnapshotShiftMap ?? fallback.syncedFromSnapshotShiftMap
      ),
      capturedAt: snapshot.capturedAt ?? fallback.capturedAt
    }
  }

  /**
   * Helper: Convert status sang tiếng Việt
   */
  private getStatusText(status: EmployeeScheduleStatus): string {
    const statusMap: Record<EmployeeScheduleStatus, string> = {
      [EmployeeScheduleStatus.Pending]: 'chờ duyệt',
      [EmployeeScheduleStatus.Approved]: 'đã phê duyệt',
      [EmployeeScheduleStatus.InProgress]: 'đang làm việc',
      [EmployeeScheduleStatus.Completed]: 'hoàn thành',
      [EmployeeScheduleStatus.Absent]: 'vắng mặt',
      [EmployeeScheduleStatus.Rejected]: 'bị từ chối',
      [EmployeeScheduleStatus.Cancelled]: 'đã hủy'
    }
    return statusMap[status] || status
  }

  /**
   * Validate shifts array
   */
  private validateShifts(shifts: ShiftType[]) {
    if (!shifts || shifts.length === 0) {
      throw new ErrorWithStatus({
        message: 'Shifts không được để trống',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (shifts.length > 3) {
      throw new ErrorWithStatus({
        message: 'Chỉ có thể đăng ký tối đa 3 ca',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
}

const employeeScheduleService = new EmployeeScheduleService()
export default employeeScheduleService
