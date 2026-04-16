import cron from 'node-cron'
import employeeScheduleService from '~/services/employeeSchedule.service'

/**
 * Cronjob chạy mỗi 30 phút để:
 * 1. Auto start shifts (approved → in-progress)
 * 2. Auto complete shifts (in-progress → completed)
 */
export function startShiftScheduler() {
  // Chạy mỗi 30 phút (phút 0 và 30 của mỗi giờ)
  cron.schedule('0,30 * * * *', async () => {
    try {
      console.log('⏰ [Shift Scheduler] Running...')

      // Auto start shifts
      const startedCount = await employeeScheduleService.autoStartShifts()

      // Auto complete shifts
      const completedCount = await employeeScheduleService.autoCompleteShifts()

      if (startedCount > 0 || completedCount > 0) {
        console.log(`✅ [Shift Scheduler] Started: ${startedCount}, Completed: ${completedCount}`)
      } else {
        console.log(`✅ [Shift Scheduler] No shifts to update`)
      }
    } catch (error) {
      console.error('❌ [Shift Scheduler] Error:', error)
    }
  })

  console.log('✅ Shift Scheduler initialized (runs every 30 minutes)')
}
