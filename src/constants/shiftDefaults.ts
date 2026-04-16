import { ShiftType } from './enum'

export const DEFAULT_SHIFT_TIMES = {
  [ShiftType.Shift1]: {
    name: 'Shift 1',
    startTime: '09:00',
    endTime: '14:00'
  },
  [ShiftType.Shift2]: {
    name: 'Shift 2',
    startTime: '14:00',
    endTime: '19:00'
  },
  [ShiftType.Shift3]: {
    name: 'Shift 3',
    startTime: '19:00',
    endTime: '01:00'
  }
} as const

// Helper function to get shift info
export function getShiftInfo(shiftType: ShiftType, customStartTime?: string, customEndTime?: string) {
  const defaultShift = DEFAULT_SHIFT_TIMES[shiftType]

  return {
    name: defaultShift.name,
    startTime: customStartTime || defaultShift.startTime,
    endTime: customEndTime || defaultShift.endTime
  }
}
