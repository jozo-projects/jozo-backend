import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'

export type RoomService = 'singing' | 'gaming'

// Missing means legacy/unknown, not an inferred capability.
export function validateRoomServices(value: unknown): RoomService[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => item !== 'singing' && item !== 'gaming') ||
    new Set(value).size !== value.length
  ) {
    throw new ErrorWithStatus({ message: 'Dịch vụ phòng không hợp lệ', status: HTTP_STATUS_CODE.BAD_REQUEST })
  }
  return value as RoomService[]
}
