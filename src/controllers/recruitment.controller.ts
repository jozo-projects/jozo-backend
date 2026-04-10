import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { GetRecruitmentsRequest } from '~/models/requests/Recruitment.request'
import { recruitmentService } from '~/services/recruitment.service'

export class RecruitmentController {
  // Lấy danh sách đơn ứng tuyển (admin only)
  async getRecruitments(req: Request, res: Response) {
    try {
      const query: GetRecruitmentsRequest = {
        status: req.query.status as string,
        position: req.query.position as string,
        gender: req.query.gender as string,
        workShifts: req.query.workShifts as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        search: req.query.search as string
      }

      const result = await recruitmentService.getRecruitments(query)

      res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Lấy danh sách đơn ứng tuyển thành công',
        data: result.recruitments,
        pagination: {
          page: query.page || 1,
          limit: query.limit || 10,
          total: result.total,
          totalPages: Math.ceil(result.total / (query.limit || 10))
        }
      })
    } catch (error: any) {
      res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
        message: error.message || 'Có lỗi xảy ra khi lấy danh sách đơn ứng tuyển'
      })
    }
  }

  // Lấy chi tiết đơn ứng tuyển (admin only)
  async getRecruitmentById(req: Request, res: Response) {
    try {
      const { id } = req.params

      const recruitment = await recruitmentService.getRecruitmentById(id)

      if (!recruitment) {
        return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
          message: 'Không tìm thấy đơn ứng tuyển'
        })
      }

      res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Lấy chi tiết đơn ứng tuyển thành công',
        data: recruitment
      })
    } catch (error: any) {
      res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
        message: error.message || 'Có lỗi xảy ra khi lấy chi tiết đơn ứng tuyển'
      })
    }
  }

  // Cập nhật trạng thái đơn ứng tuyển (admin only)
  async updateRecruitmentStatus(req: Request, res: Response) {
    try {
      const { id } = req.params
      const { status } = req.body

      if (!status) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: 'Trạng thái không được để trống'
        })
      }

      // Kiểm tra status có hợp lệ không
      const validStatuses = ['pending', 'reviewed', 'approved', 'rejected', 'hired', 'contacted']
      if (!validStatuses.includes(status)) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: 'Trạng thái không hợp lệ'
        })
      }

      const recruitment = await recruitmentService.updateRecruitment(id, { status })

      if (!recruitment) {
        return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
          message: 'Không tìm thấy đơn ứng tuyển'
        })
      }

      res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Cập nhật trạng thái đơn ứng tuyển thành công',
        data: recruitment
      })
    } catch (error: any) {
      res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
        message: error.message || 'Có lỗi xảy ra khi cập nhật trạng thái đơn ứng tuyển'
      })
    }
  }

  // Lấy thống kê đơn ứng tuyển (admin only)
  async getRecruitmentStats(req: Request, res: Response) {
    try {
      const stats = await recruitmentService.getRecruitmentStats()

      res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Lấy thống kê đơn ứng tuyển thành công',
        data: stats
      })
    } catch (error: any) {
      res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
        message: error.message || 'Có lỗi xảy ra khi lấy thống kê đơn ứng tuyển'
      })
    }
  }
}

export const recruitmentController = new RecruitmentController()
