import { EventEmitter } from 'events'
import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import isoWeek from 'dayjs/plugin/isoWeek'
import { EmployeeScheduleStatus, ShiftType, UserRole, NotificationType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { EMPLOYEE_SCHEDULE_MESSAGES, NOTIFICATION_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import {
  IAdminCreateScheduleBody,
  ICreateEmployeeScheduleBody,
  IGetSchedulesQuery,
  IUpdateScheduleBody,
  IUpdateStatusBody
} from '~/models/requests/EmployeeSchedule.request'
import { EmployeeSchedule } from '~/models/schemas/EmployeeSchedule.schema'
import databaseService from './database.service'
import { getShiftInfo } from '~/constants/shiftDefaults'
import notificationService from './notification.service'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)
dayjs.tz.setDefault('Asia/Ho_Chi_Minh')

// EventEmitter cho employee schedule events
export const employeeScheduleEventEmitter = new EventEmitter()

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

    // Group by date và populate shift info
    const schedulesByDate: Record<string, any[]> = {}
    let totalShifts = 0
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
      const shiftInfo = getShiftInfo(schedule.shiftType, schedule.customStartTime, schedule.customEndTime)

      const scheduleWithInfo = {
        _id: schedule._id,
        userId: schedule.userId,
        userName: schedule.userName,
        userPhone: schedule.userPhone,
        date: schedule.date,
        shiftType: schedule.shiftType,
        customStartTime: schedule.customStartTime,
        customEndTime: schedule.customEndTime,
        shiftInfo,
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
      }

      if (!schedulesByDate[dateKey]) {
        schedulesByDate[dateKey] = []
      }
      schedulesByDate[dateKey].push(scheduleWithInfo)

      totalShifts++
      statusCount[schedule.status as keyof typeof statusCount]++
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
        byStatus: statusCount
      }
    }
  }

  /**
   * Lấy chi tiết một schedule
   */
  async getScheduleById(id: string) {
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

    // Populate shift info
    const shiftInfo = getShiftInfo(schedule.shiftType, schedule.customStartTime, schedule.customEndTime)

    return {
      ...schedule,
      shiftInfo
    }
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
    // Cho phép cập nhật note (Staff + Admin), customStartTime, customEndTime (chỉ Admin)

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
  async markCompleted(id: string, adminId: string) {
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
      const startTime = this.calculateStartDateTime(schedule.date, schedule.shiftType, schedule.customStartTime)
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
      const endTime = this.calculateEndDateTime(schedule.date, schedule.shiftType, schedule.customEndTime)
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
  private calculateStartDateTime(date: Date, shiftType: ShiftType, customStartTime?: string): Date {
    const shiftInfo = getShiftInfo(shiftType, customStartTime, undefined)
    const [hours, minutes] = shiftInfo.startTime.split(':').map(Number)

    return dayjs(date).hour(hours).minute(minutes).second(0).millisecond(0).toDate()
  }

  /**
   * Helper: Calculate end date time
   */
  private calculateEndDateTime(date: Date, shiftType: ShiftType, customEndTime?: string): Date {
    const shiftInfo = getShiftInfo(shiftType, undefined, customEndTime)
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
