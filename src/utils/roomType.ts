import { RoomType } from '~/constants/enum'

/**
 * Ánh xạ giá trị field roomType trên document phòng (vd. "dorm", "Dorm", "large") sang enum.
 * Trả về null nếu không khớp — caller có thể fallback logic khác (vd. hardcode theo roomId).
 */
export function roomTypeFieldToEnum(roomType: string | RoomType | undefined): RoomType | null {
  if (roomType === undefined || roomType === null) return null
  const t = String(roomType).trim().toLowerCase()
  if (t === 'small') return RoomType.Small
  if (t === 'medium') return RoomType.Medium
  if (t === 'large') return RoomType.Large
  if (t === 'dorm') return RoomType.Dorm
  return null
}

/** Chuẩn hóa roomType từ client (API/booking online): small, dorm, hoặc đúng enum Pascal. */
export function parseClientRoomTypeString(value: string): RoomType {
  const trimmed = value.trim()
  const fromField = roomTypeFieldToEnum(trimmed)
  if (fromField) return fromField
  if (Object.values(RoomType).includes(trimmed as RoomType)) {
    return trimmed as RoomType
  }
  throw new Error(`Invalid room type: ${value}`)
}
