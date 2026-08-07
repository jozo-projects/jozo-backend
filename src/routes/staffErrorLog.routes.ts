import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  cancelLog,
  createLog,
  createPreset,
  deletePreset,
  getLogById,
  listLogs,
  listMyLogs,
  listPresets,
  updatePreset
} from '~/controllers/staffErrorLog.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  cancelStaffErrorLogValidator,
  createStaffErrorLogValidator,
  createStaffErrorPresetValidator,
  listStaffErrorLogsValidator,
  staffErrorIdParamValidator,
  updateStaffErrorPresetValidator
} from '~/middlewares/staffErrorLog.middleware'

const staffErrorLogRouter = Router()

/**
 * @route   GET /staff-error-logs/presets
 * @desc    Danh sách preset loại lỗi
 * @access  Private (Admin)
 */
staffErrorLogRouter.get('/presets', protect([UserRole.Admin]), listPresets)

/**
 * @route   POST /staff-error-logs/presets
 * @desc    Tạo preset loại lỗi
 * @access  Private (Admin)
 */
staffErrorLogRouter.post('/presets', protect([UserRole.Admin]), createStaffErrorPresetValidator, createPreset)

/**
 * @route   PUT /staff-error-logs/presets/:id
 * @desc    Cập nhật preset
 * @access  Private (Admin)
 */
staffErrorLogRouter.put(
  '/presets/:id',
  protect([UserRole.Admin]),
  staffErrorIdParamValidator,
  updateStaffErrorPresetValidator,
  updatePreset
)

/**
 * @route   DELETE /staff-error-logs/presets/:id
 * @desc    Xóa preset
 * @access  Private (Admin)
 */
staffErrorLogRouter.delete('/presets/:id', protect([UserRole.Admin]), staffErrorIdParamValidator, deletePreset)

/**
 * @route   GET /staff-error-logs/me
 * @desc    Staff xem log lỗi của mình
 * @access  Private (Staff, Admin)
 */
staffErrorLogRouter.get(
  '/me',
  protect([UserRole.Staff, UserRole.Admin]),
  listStaffErrorLogsValidator,
  listMyLogs
)

/**
 * @route   GET /staff-error-logs
 * @desc    Admin list log lỗi
 * @access  Private (Admin)
 */
staffErrorLogRouter.get('/', protect([UserRole.Admin]), listStaffErrorLogsValidator, listLogs)

/**
 * @route   POST /staff-error-logs
 * @desc    Admin tạo warning/penalty
 * @access  Private (Admin)
 */
staffErrorLogRouter.post('/', protect([UserRole.Admin]), createStaffErrorLogValidator, createLog)

/**
 * @route   GET /staff-error-logs/:id
 * @desc    Chi tiết một log
 * @access  Private (Admin)
 */
staffErrorLogRouter.get('/:id', protect([UserRole.Admin]), staffErrorIdParamValidator, getLogById)

/**
 * @route   POST /staff-error-logs/:id/cancel
 * @desc    Hủy log (soft cancel)
 * @access  Private (Admin)
 */
staffErrorLogRouter.post(
  '/:id/cancel',
  protect([UserRole.Admin]),
  staffErrorIdParamValidator,
  cancelStaffErrorLogValidator,
  cancelLog
)

export default staffErrorLogRouter
