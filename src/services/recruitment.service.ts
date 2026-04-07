import { ObjectId } from 'mongodb'
import { RecruitmentStatus } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  CreateRecruitmentRequest,
  GetRecruitmentsRequest,
  UpdateRecruitmentRequest
} from '~/models/requests/Recruitment.request'
import { IRecruitment, Recruitment } from '~/models/schemas/Recruitment.schema'
import databaseService from './database.service'

class RecruitmentService {
  private collection = 'recruitments'

  async createRecruitment(data: CreateRecruitmentRequest): Promise<Recruitment> {
    // Kiểm tra tuổi
    const recruitment = new Recruitment({
      fullName: data.fullName,
      birthDate: data.birthDate,
      gender: data.gender,
      phone: data.phone,
      email: data.email || null,
      socialMedia: data.socialMedia,
      currentStatus: data.currentStatus,
      otherStatus: data.otherStatus || null,
      position: data.position,
      workShifts: data.workShifts,
      submittedAt: new Date(),
      status: RecruitmentStatus.Pending,
      note: data.note ?? null
    })

    if (!recruitment.isValidAge()) {
      throw new ErrorWithStatus({
        message: 'Chỉ nhận ứng viên từ 18-25 tuổi',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (!recruitment.isValidPhone()) {
      throw new ErrorWithStatus({
        message: 'Số điện thoại không đúng định dạng Việt Nam (0xxxxxxxxx)',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (!recruitment.isValidEmail()) {
      throw new ErrorWithStatus({
        message: 'Email không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Kiểm tra position ít nhất 1 vị trí
    if (!data.position || data.position.length === 0) {
      throw new ErrorWithStatus({
        message: 'Phải chọn ít nhất 1 vị trí ứng tuyển',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Kiểm tra workShifts ít nhất 1 ca
    if (!data.workShifts || data.workShifts.length === 0) {
      throw new ErrorWithStatus({
        message: 'Phải chọn ít nhất 1 ca làm việc',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Kiểm tra otherStatus nếu currentStatus = "other"
    if (data.currentStatus === 'other' && (!data.otherStatus || data.otherStatus.trim() === '')) {
      throw new ErrorWithStatus({
        message: 'Vui lòng điền thông tin khi chọn "Khác"',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const noteMaxLen = 5000
    if (data.note != null && data.note.length > noteMaxLen) {
      throw new ErrorWithStatus({
        message: `Ghi chú không được vượt quá ${noteMaxLen} ký tự`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Kiểm tra số điện thoại đã tồn tại chưa
    const existingRecruitment = await databaseService.getCollection(this.collection).findOne({
      phone: data.phone
    })

    if (existingRecruitment) {
      throw new ErrorWithStatus({
        message: 'Số điện thoại này đã được sử dụng để ứng tuyển',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const recruitmentData: IRecruitment = {
      fullName: data.fullName,
      birthDate: data.birthDate,
      gender: data.gender,
      phone: data.phone,
      email: data.email || null,
      socialMedia: data.socialMedia,
      currentStatus: data.currentStatus,
      otherStatus: data.otherStatus || null,
      position: data.position,
      workShifts: data.workShifts,
      submittedAt: new Date(),
      status: RecruitmentStatus.Pending,
      note: data.note?.trim() || null
    }

    const result = await databaseService.getCollection(this.collection).insertOne(recruitmentData)

    return new Recruitment({
      _id: result.insertedId,
      ...recruitmentData
    })
  }

  async getRecruitments(query: GetRecruitmentsRequest = {}): Promise<{ recruitments: Recruitment[]; total: number }> {
    const { status, position, gender, workShifts, page = 1, limit = 10, search } = query
    const skip = (page - 1) * limit

    const filter: any = {}

    if (status) {
      filter.status = status
    }

    if (position) {
      filter.position = { $in: [position] }
    }

    if (gender) {
      filter.gender = gender
    }

    if (workShifts) {
      filter.workShifts = { $in: [workShifts] }
    }

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { position: { $regex: search, $options: 'i' } }
      ]
    }

    const [recruitments, total] = await Promise.all([
      databaseService
        .getCollection(this.collection)
        .find(filter)
        .sort({ submittedAt: -1 }) // Sắp xếp theo thứ tự mới nhất
        .skip(skip)
        .limit(limit)
        .toArray(),
      databaseService.getCollection(this.collection).countDocuments(filter)
    ])

    return {
      recruitments: recruitments.map((recruitment: any) => new Recruitment(recruitment)),
      total
    }
  }

  async getRecruitmentById(id: string): Promise<Recruitment | null> {
    const recruitment = await databaseService.getCollection(this.collection).findOne({
      _id: new ObjectId(id)
    })

    return recruitment ? new Recruitment(recruitment as IRecruitment) : null
  }

  async updateRecruitment(id: string, data: UpdateRecruitmentRequest): Promise<Recruitment | null> {
    const updateData: any = {}

    if (data.status) {
      updateData.status = data.status
    }

    const result = await databaseService
      .getCollection(this.collection)
      .findOneAndUpdate({ _id: new ObjectId(id) }, { $set: updateData }, { returnDocument: 'after' })

    return result ? new Recruitment(result as IRecruitment) : null
  }

  async deleteRecruitment(id: string): Promise<boolean> {
    const result = await databaseService.getCollection(this.collection).deleteOne({
      _id: new ObjectId(id)
    })

    return result.deletedCount > 0
  }

  async getRecruitmentStats(): Promise<{
    total: number
    pending: number
    reviewed: number
    approved: number
    rejected: number
    hired: number
  }> {
    const stats = await databaseService
      .getCollection(this.collection)
      .aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
      .toArray()

    const result = {
      total: 0,
      pending: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      hired: 0
    }

    stats.forEach((stat: any) => {
      result[stat._id as keyof typeof result] = stat.count
      result.total += stat.count
    })

    return result
  }
}

export const recruitmentService = new RecruitmentService()
