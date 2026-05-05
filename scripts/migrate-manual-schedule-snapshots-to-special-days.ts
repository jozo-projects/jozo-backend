/**
 * Script gợi ý: chuyển schedule.salarySnapshot (source manual) cũ sang employee_salary_special_days.
 * Chạy tay sau khi review dữ liệu — merge logic theo từng tổ chức (tránh ghi đè ngày đã có config).
 *
 * Ví dụ: npx ts-node -r tsconfig-paths/register scripts/migrate-manual-schedule-snapshots-to-special-days.ts
 */
import { ObjectId } from 'mongodb'
import databaseService from '../src/services/database.service'

async function main() {
  await databaseService.connect()
  const cursor = databaseService.employeeSchedules.find({
    'salarySnapshot.source': 'manual',
    'salarySnapshot.hourlyRateMap': { $exists: true }
  })

  let n = 0
  for await (const doc of cursor) {
    const userId = (doc.userId as ObjectId).toString()
    const businessDate = doc.date
      ? new Date(doc.date).toISOString().slice(0, 10)
      : 'unknown-date'
    const hourlyAmountMap = doc.salarySnapshot?.hourlyRateMap as Record<string, number> | undefined
    if (!hourlyAmountMap || businessDate === 'unknown-date') continue

    // TODO: upsert hoặc skip nếu đã có document; có thể gắn metadata userId trong note riêng.
    console.log('Would migrate schedule', doc._id?.toString(), userId, businessDate)
    n++
  }
  console.log('Total manual schedules scanned count:', n)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
