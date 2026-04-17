export enum UserVerifyStatus {
  Unverified,
  Verified,
  Banned
}

export enum TokenType {
  AccessToken,
  RefreshToken,
  ForgotPasswordToken,
  EmailVerificationToken,
  CoffeeSessionToken
}

export enum UserRole {
  Admin = 'admin',
  Staff = 'staff',
  Client = 'client',
  User = 'user'
}

export enum RoomType {
  Small = 'Small',
  Medium = 'Medium',
  Large = 'Large',
  Dorm = 'Dorm'
}

export enum RoomSize {
  S = 'S',
  M = 'M',
  L = 'L'
}

export enum RoomStatus {
  Available = 'available',
  Occupied = 'occupied',
  Cleaning = 'cleaning',
  Reserved = 'reserved',
  Maintenance = 'maintenance'
}

export enum DayType {
  Weekday = 'weekday',
  Weekend = 'weekend',
  Holiday = 'holiday'
}

export enum RoomScheduleStatus {
  Booked = 'booked',
  InUse = 'in use',
  Locked = 'locked',
  Cancelled = 'cancelled',
  Finished = 'finished',
  Maintenance = 'maintenance'
}

export enum FnBCategory {
  SNACK = 'snack',
  DRINK = 'drink'
}

export enum RecruitmentStatus {
  Pending = 'pending',
  Reviewed = 'reviewed',
  Contacted = 'contacted',
  Hired = 'hired',
  Rejected = 'rejected'
}

export enum CurrentStatus {
  Student = 'student',
  Working = 'working',
  Other = 'other'
}

export enum WorkTimeSlot {
  Morning = 'morning', // 10h-14h
  Afternoon = 'afternoon', // 14h-18h
  Evening = 'evening', // 18h-24h
  Weekend = 'weekend' // T7-CN
}

export enum ShiftType {
  Shift1 = 'shift1',
  Shift2 = 'shift2',
  Shift3 = 'shift3'
}

export enum EmployeeScheduleStatus {
  Pending = 'pending',
  Approved = 'approved',
  InProgress = 'in-progress',
  Completed = 'completed',
  Absent = 'absent',
  Rejected = 'rejected',
  Cancelled = 'cancelled'
}

export enum NotificationType {
  SCHEDULE_CREATED_BY_EMPLOYEE = 'schedule_created_by_employee',
  SCHEDULE_CREATED_BY_ADMIN = 'schedule_created_by_admin',
  SCHEDULE_APPROVED = 'schedule_approved',
  SCHEDULE_REJECTED = 'schedule_rejected',
  SCHEDULE_STATUS_UPDATED = 'schedule_status_updated'
}

export enum MembershipTier {
  Member = 'Member',
  Silver = 'Silver',
  Gold = 'Gold',
  Platinum = 'Platinum',
  A = 'A',
  B = 'B'
}

export enum RewardSource {
  Point = 'point',
  Tier = 'tier',
  Streak = 'streak'
}
