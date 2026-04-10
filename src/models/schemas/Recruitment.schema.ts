import { ObjectId } from 'mongodb'
import { RecruitmentStatus } from '~/constants/enum'

export interface IRecruitment {
  _id?: ObjectId
  fullName: string
  birthDate: Date
  gender: string // "male" | "female" | "other"
  phone: string // Format: 0xxxxxxxxx
  email: string | null // Optional
  socialMedia: string // Facebook/Zalo link
  currentStatus: string // "student" | "working" | "other"
  otherStatus: string | null // Thông tin khác (nếu currentStatus = "other")
  position: string[] // ["cashier", "server", "parking"] - có thể chọn nhiều
  workShifts: string[] // ["morning", "evening"] - có thể chọn nhiều
  submittedAt: Date
  status: RecruitmentStatus
  workDays?: string[] | null // Optional - backward compatibility
  /** Ghi chú / lời nhắn từ ứng viên (optional) */
  note?: string | null
}

export class Recruitment {
  _id?: ObjectId
  fullName: string
  birthDate: Date
  gender: string
  phone: string
  email: string | null
  socialMedia: string
  currentStatus: string
  otherStatus: string | null
  position: string[]
  workShifts: string[]
  submittedAt: Date
  status: RecruitmentStatus
  workDays?: string[] | null
  note: string | null

  constructor(recruitment: IRecruitment) {
    const date = new Date()

    this._id = recruitment._id
    this.fullName = recruitment.fullName
    this.birthDate = recruitment.birthDate || date
    this.gender = recruitment.gender
    this.phone = recruitment.phone
    this.email = recruitment.email
    this.socialMedia = recruitment.socialMedia
    this.currentStatus = recruitment.currentStatus
    this.otherStatus = recruitment.otherStatus
    this.position = recruitment.position || []
    this.workShifts = recruitment.workShifts || []
    this.submittedAt = recruitment.submittedAt || date
    this.status = recruitment.status || RecruitmentStatus.Pending
    this.workDays = recruitment.workDays
    this.note = recruitment.note ?? null
  }

  /** Đảm bảo GET (danh sách / chi tiết) luôn có trường `note` trong JSON */
  toJSON() {
    return {
      _id: this._id,
      fullName: this.fullName,
      birthDate: this.birthDate,
      gender: this.gender,
      phone: this.phone,
      email: this.email,
      socialMedia: this.socialMedia,
      currentStatus: this.currentStatus,
      otherStatus: this.otherStatus,
      position: this.position,
      workShifts: this.workShifts,
      submittedAt: this.submittedAt,
      status: this.status,
      workDays: this.workDays ?? null,
      note: this.note ?? null
    }
  }

  // Tính tuổi từ ngày sinh
  getAge(): number {
    const today = new Date()
    const birthDate = new Date(this.birthDate)
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }

    return age
  }

  // Kiểm tra xem có đủ tuổi không (18-25 tuổi)
  isValidAge(): boolean {
    const age = this.getAge()
    return age >= 18 && age <= 25
  }

  // Kiểm tra format số điện thoại Việt Nam
  isValidPhone(): boolean {
    const phoneRegex = /^0[0-9]{9}$/
    return phoneRegex.test(this.phone)
  }

  // Kiểm tra email hợp lệ (nếu có)
  isValidEmail(): boolean {
    if (!this.email) return true // Optional
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(this.email)
  }
}
