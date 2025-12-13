export const USER_MESSAGES = {
  USER_NOT_FOUND: 'User not found',
  GET_USER_SUCCESS: 'Get user success',
  USERNAME_NOT_EMPTY: 'User name is not empty',
  INVALID_EMAIL: 'Invalid email',
  INVALID_FIELD: 'Validation error',
  USER_EXISTS: 'User already exists',
  USERNAME_EXISTS: 'Username already exists',
  EMAIL_EXISTS: 'Email already exists',
  INVALID_VERIFY_TOKEN: 'Invalid verify token',
  INVALID_FORGOT_PASSWORD_TOKEN: 'Invalid forgot password token',
  INVALID_USER: 'Invalid user',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  INVALID_LOGIN: 'Invalid username or password',
  INVALID_VERIFY_EMAIL: 'Invalid verify email',
  INVALID_RESET_PASSWORD: 'Invalid reset password',
  INVALID_USER_VERIFY_STATUS: 'Invalid user verify status',
  INVALID_USER_BIO: 'Invalid user bio',
  INVALID_USER_LOCATION: 'Invalid user location',
  INVALID_USER_WEBSITE: 'Invalid user website',
  INVALID_USER_NAME: 'Name must be between 2 and 100 characters',
  USER_NOT_EXISTS: 'User not exists',
  INVALID_PASSWORD:
    'Password must be at least 6 characters long and contain at least one lowercase letter, one uppercase letter, one number, and one special character.',
  PASSWORD_NOT_MATCH: 'Password not match',
  PASSWORD_NOT_EMPTY: 'Password is not empty',
  CONFIRM_PASSWORD_NOT_EMPTY: 'Password confirm is not empty',
  EMAIL_NOT_EMPTY: 'Email is not empty',
  INVALID_DATE_OF_BIRTH: "Date of birth must be in ISO format 'YYYY-MM-DD'",
  LOGIN_SUCCESS: 'Login success',
  REGISTER_SUCCESS: 'Register success',
  REFRESH_TOKEN_NOT_EMPTY: 'Refresh token is not empty',
  LOGOUT_SUCCESS: 'Logout success',
  INVALID_ROLE: 'Invalid role',
  ROLE_NOT_EMPTY: 'Role is not empty',
  PHONE_NUMBER_NOT_EMPTY: 'Phone number is not empty',
  INVALID_PHONE_NUMBER: 'Invalid phone number',
  GET_USERS_SUCCESS: 'Get users success',
  UPDATE_USER_SUCCESS: 'Update user success',
  USERNAME_ALREADY_EXISTS: 'Username already exists',
  EMAIL_ALREADY_EXISTS: 'Email already exists',
  PHONE_ALREADY_EXISTS: 'Phone number already exists',
  FORGOT_PASSWORD_SUCCESS: 'Forgot password email sent successfully',
  RESET_PASSWORD_SUCCESS: 'Password reset successfully',
  EMAIL_NOT_FOUND: 'Email not found',
  OLD_PASSWORD_NOT_EMPTY: 'Old password is required',
  OLD_PASSWORD_INCORRECT: 'Old password is incorrect',
  CHANGE_PASSWORD_SUCCESS: 'Password changed successfully'
} as const

export const ROOM_TYPE_MESSAGES = {
  INVALID_ROOM_TYPE_ID: 'Invalid room type id',
  ROOM_TYPE_EXISTS: 'Room type already exists',
  ADD_ROOM_TYPE_SUCCESS: 'Add room type success',
  GET_ROOM_TYPES_SUCCESS: 'Get room types success',
  GET_ROOM_TYPE_BY_ID_SUCCESS: 'Get room type by id success',
  UPDATE_ROOM_TYPE_BY_ID_SUCCESS: 'Update room type by id success',
  DELETE_ROOM_TYPE_BY_ID_SUCCESS: 'Delete room type by id success',
  DELETE_MANY_ROOM_TYPES_SUCCESS: 'Delete many room types success',
  ROOM_TYPE_NOT_FOUND: 'Room type not found',
  INVALID_ROOM_TYPE_IDS: 'Invalid room type ids'
} as const

export const AUTH_MESSAGES = {
  ACCESS_TOKEN_NOT_EMPTY: 'Access token is not empty',
  INSUFFICIENT_PRIVILEGES: 'Your role does not have sufficient privileges for this operation'
} as const

export const ROOM_MESSAGES = {
  ADD_ROOM_TYPE_SUCCESS: 'Add room success',
  ROOM_EXISTS: 'Room already exists',
  GET_ROOM_SUCCESS: 'Get room success',
  GET_ROOMS_SUCCESS: 'Get rooms success',
  ROOM_NOT_FOUND: 'Room not found',
  UPDATE_ROOM_SUCCESS: 'Update room success',
  DELETE_ROOM_SUCCESS: 'Delete room success'
} as const

export const SONG_QUEUE_MESSAGES = {
  ADD_SONG_TO_QUEUE_SUCCESS: 'Add song to queue success',
  REMOVE_SONG_FROM_QUEUE_SUCCESS: 'Remove song from queue success',
  REMOVE_ALL_SONGS_IN_QUEUE_SUCCESS: 'Remove all songs in queue success',
  NO_SONG_IN_QUEUE: 'No song in queue',
  SONG_IS_NOW_PLAYING: 'Song is now playing',
  GET_SONGS_IN_QUEUE_SUCCESS: 'Get songs in queue success',
  SONG_PLAYING: 'Song is playing',
  SONG_PAUSED: 'Song is paused',
  SONG_SKIPPED: 'Song is skipped',
  GET_VIDEO_INFO_SUCCESS: 'Get video info success',
  UPDATE_QUEUE_SUCCESS: 'Update queue success',
  GET_SONG_NAME_SUCCESS: 'Get song name success',
  SEARCH_SONGS_SUCCESS: 'Search songs success',
  ADD_SONGS_TO_QUEUE_SUCCESS: 'Add songs to queue success'
} as const

export const Price_MESSAGES = {
  GET_Price_SUCCESS: 'Get Price success',
  GET_Price_BY_ID_SUCCESS: 'Get Price by id success',
  CREATE_Price_SUCCESS: 'Create Price success',
  UPDATE_Price_SUCCESS: 'Update Price success',
  DELETE_Price_SUCCESS: 'Delete Price success',
  DELETE_MULTIPLE_Price_SUCCESS: 'Delete multiple Price success',
  Price_NOT_FOUND: 'Price not found',
  Price_EXISTS: 'Price already exists'
} as const

export const ROOM_CATEGORY_MESSAGES = {
  CREATE_ROOM_CATEGORY_SUCCESS: 'Create room category success',
  GET_ALL_ROOM_CATEGORIES_SUCCESS: 'Get all room categories success',
  GET_ROOM_CATEGORY_BY_ID_SUCCESS: 'Get room category by id success',
  UPDATE_ROOM_CATEGORY_SUCCESS: 'Update room category success',
  DELETE_ROOM_CATEGORY_SUCCESS: 'Delete room category success',
  DELETE_MULTIPLE_ROOM_CATEGORY_SUCCESS: 'Delete multiple room category success',
  ROOM_CATEGORY_EXISTS: 'Room category already exists',
  ROOM_CATEGORY_NOT_FOUND: 'Room category not found',
  ROOM_CATEGORY_NAME_ALREADY_EXISTS: 'Room category name already exists'
} as const

export const ROOM_SCHEDULE_MESSAGES = {
  GET_SCHEDULES_SUCCESS: 'Get schedules success',
  CREATE_SCHEDULE_SUCCESS: 'Create schedule success',
  UPDATE_SCHEDULE_SUCCESS: 'Update schedule success',
  CANCEL_SCHEDULE_SUCCESS: 'Cancel schedule success',
  SCHEDULE_NOT_FOUND: 'Schedule not found',
  SCHEDULE_EXISTS: 'Schedule already exists',
  DATE_REQUIRED: 'Date parameter is required',
  ROOM_ID_REQUIRED: 'Room ID is required',
  START_TIME_REQUIRED: 'Start time is required',
  STATUS_REQUIRED: 'Status is required',
  SCHEDULE_ID_REQUIRED: 'Schedule ID is required'
} as const

export const FNB_MESSAGES = {
  CREATE_FNB_ORDER_SUCCESS: 'Create FNB order success',
  GET_FNB_ORDER_BY_ID_SUCCESS: 'Get FNB order by id success',
  UPDATE_FNB_ORDER_SUCCESS: 'Update FNB order success',
  DELETE_FNB_ORDER_SUCCESS: 'DELETE_FNB_ORDER_SUCCESS',
  GET_FNB_ORDERS_BY_ROOM_SCHEDULE_SUCCESS: 'Get FNB orders by room schedule success',
  FNB_ORDER_NOT_FOUND: 'FNB order not found',
  UPSERT_FNB_ORDER_SUCCESS: 'Upsert FNB order success',
  SET_FNB_ORDER_STATUS_SUCCESS: 'Set FNB order status success',
  GET_FNB_MENUS_SUCCESS: 'Get FNB menus success',
  COMPLETE_FNB_ORDER_SUCCESS: 'Complete FNB order and save to history success'
}

export const FNB_MENU_MESSAGES = {
  CREATE_FNB_MENU_SUCCESS: 'Create FNB menu success',
  GET_FNB_MENU_BY_ID_SUCCESS: 'Get FNB menu by id success',
  UPDATE_FNB_MENU_SUCCESS: 'Update FNB menu success',
  DELETE_FNB_MENU_SUCCESS: 'Delete FNB menu success',
  GET_FNB_MENUS_SUCCESS: 'Get FNB menus success',
  FNB_MENU_NOT_FOUND: 'FNB menu not found',
  FNB_MENU_EXISTS: 'FNB menu already exists'
}

export const RATE_LIMIT_MESSAGES = {
  TOO_MANY_REQUESTS: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  AUTH_TOO_MANY_REQUESTS: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút để bảo vệ tài khoản của bạn.',
  BOOKING_TOO_MANY_REQUESTS: 'Bạn đã tạo quá nhiều đặt phòng trong thời gian ngắn. Vui lòng thử lại sau.',
  LOOKUP_TOO_MANY_REQUESTS: 'Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau.',
  UPDATE_TOO_MANY_REQUESTS: 'Bạn đã cập nhật quá nhiều lần. Vui lòng thử lại sau.'
} as const

export const EMPLOYEE_SCHEDULE_MESSAGES = {
  CREATE_SCHEDULE_SUCCESS: 'Đăng ký lịch thành công, chờ admin phê duyệt',
  ADMIN_CREATE_SCHEDULE_SUCCESS: 'Đăng ký lịch cho nhân viên thành công',
  GET_SCHEDULES_SUCCESS: 'Lấy danh sách lịch thành công',
  GET_SCHEDULE_BY_ID_SUCCESS: 'Lấy chi tiết lịch thành công',
  UPDATE_SCHEDULE_SUCCESS: 'Cập nhật lịch thành công',
  UPDATE_STATUS_SUCCESS: 'Cập nhật trạng thái thành công',
  DELETE_SCHEDULE_SUCCESS: 'Xóa lịch thành công',
  APPROVE_SCHEDULE_SUCCESS: 'Phê duyệt lịch thành công',
  REJECT_SCHEDULE_SUCCESS: 'Từ chối lịch thành công',
  MARK_ABSENT_SUCCESS: 'Đánh dấu vắng mặt thành công',
  MARK_COMPLETED_SUCCESS: 'Đánh dấu hoàn thành thành công',
  SCHEDULE_NOT_FOUND: 'Không tìm thấy lịch',
  SCHEDULE_CONFLICT: 'Bạn đã đăng ký ca này cho ngày này rồi',
  INVALID_DATE: 'Ngày không hợp lệ',
  DATE_IN_PAST: 'Không thể đăng ký lịch cho ngày trong quá khứ',
  INVALID_SHIFT_TYPE: 'Loại ca không hợp lệ',
  INVALID_STATUS: 'Trạng thái không hợp lệ',
  INVALID_TIME_FORMAT: 'Định dạng thời gian không hợp lệ (phải là HH:mm)',
  INVALID_TIME_RANGE: 'Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc',
  CANNOT_UPDATE_APPROVED: 'Không thể cập nhật lịch đã được phê duyệt',
  CANNOT_DELETE_APPROVED: 'Không thể xóa lịch đã được phê duyệt',
  ONLY_PENDING_CAN_APPROVE: 'Chỉ có thể phê duyệt lịch đang chờ duyệt',
  UNAUTHORIZED_ACCESS: 'Bạn không có quyền truy cập lịch này',
  REJECTED_REASON_REQUIRED: 'Vui lòng nhập lý do từ chối',
  ALREADY_STARTED: 'Ca làm việc đã bắt đầu',
  ALREADY_COMPLETED: 'Ca làm việc đã hoàn thành',
  ALREADY_ABSENT: 'Đã được đánh dấu vắng mặt'
} as const

export const NOTIFICATION_MESSAGES = {
  GET_NOTIFICATIONS_SUCCESS: 'Lấy danh sách thông báo thành công',
  GET_UNREAD_COUNT_SUCCESS: 'Lấy số lượng thông báo chưa đọc thành công',
  MARK_AS_READ_SUCCESS: 'Đánh dấu đã đọc thành công',
  MARK_ALL_AS_READ_SUCCESS: 'Đánh dấu tất cả đã đọc thành công',
  DELETE_NOTIFICATION_SUCCESS: 'Xóa thông báo thành công',
  NOTIFICATION_NOT_FOUND: 'Không tìm thấy thông báo',
  UNAUTHORIZED_ACCESS: 'Bạn không có quyền truy cập thông báo này',
  // Notification content templates
  SCHEDULE_CREATED_BY_EMPLOYEE_TITLE: 'Đăng ký ca mới',
  SCHEDULE_CREATED_BY_EMPLOYEE_BODY: '{employeeName} đã đăng ký ca {shiftType} ngày {date}',
  SCHEDULE_CREATED_BY_ADMIN_TITLE: 'Được phân ca mới',
  SCHEDULE_CREATED_BY_ADMIN_BODY: 'Bạn được phân ca {shiftType} ngày {date}',
  SCHEDULE_APPROVED_TITLE: 'Ca làm việc được phê duyệt',
  SCHEDULE_APPROVED_BODY: 'Ca {shiftType} ngày {date} của bạn đã được phê duyệt',
  SCHEDULE_REJECTED_TITLE: 'Ca làm việc bị từ chối',
  SCHEDULE_REJECTED_BODY: 'Ca {shiftType} ngày {date} của bạn đã bị từ chối',
  SCHEDULE_STATUS_UPDATED_TITLE: 'Cập nhật trạng thái ca làm việc',
  SCHEDULE_STATUS_UPDATED_BODY: 'Ca {shiftType} ngày {date} đã chuyển sang trạng thái {status}'
} as const

export const GIFT_MESSAGES = {
  GET_GIFTS_SUCCESS: 'Lấy danh sách gift thành công',
  GET_GIFT_BY_ID_SUCCESS: 'Lấy gift by id thành công',
  CREATE_GIFT_SUCCESS: 'Tạo gift thành công',
  UPDATE_GIFT_SUCCESS: 'Cập nhật gift thành công',
  DELETE_GIFT_SUCCESS: 'Xóa gift thành công',
  CLAIM_GIFT_SUCCESS: 'Nhận quà thành công',
  GET_ROOM_GIFT_SUCCESS: 'Lấy thông tin quà của phòng thành công',
  ACTIVE_SCHEDULE_NOT_FOUND: 'Không tìm thấy lịch đang hoạt động cho phòng'
} as const
