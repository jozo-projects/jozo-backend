import cron from 'node-cron'
import { songPruneJobService } from '~/services/songPruneJob.service'

const TZ = 'Asia/Ho_Chi_Minh'

/**
 * Cronjob chạy mỗi ngày lúc 04:00 (giờ VN): quét thư viện songs, xóa bài không còn trên YouTube.
 */
export function startSongPruneScheduler() {
  cron.schedule(
    '0 4 * * *',
    async () => {
      const startedAt = Date.now()
      try {
        console.log(
          `⏰ [Song Prune] Bắt đầu quét và xóa bài không còn trên YouTube (${new Date().toLocaleString('vi-VN', { timeZone: TZ })})`
        )

        const { started, job, message } = songPruneJobService.start({
          source: 'cron',
          omitVideoIds: true
        })

        if (!started) {
          console.warn(`⚠️ [Song Prune] Bỏ qua: ${message ?? 'job đang chạy'}`)
          return
        }

        // Đợi job nền hoàn tất (cron không fire-and-forget hoàn toàn để log kết quúc)
        while (songPruneJobService.isRunning()) {
          await new Promise((r) => setTimeout(r, 5000))
        }

        const finalJob = songPruneJobService.getStatus()
        const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
        console.log(
          `✅ [Song Prune] Xong (${elapsedMin} phút, job=${job.job_id}): đã quét=${finalJob.checked}, không còn YT=${finalJob.unavailable_on_youtube}, đã xóa DB=${finalJob.removed_from_db}, bỏ qua=${finalJob.skipped_unknown}, status=${finalJob.status}`
        )
      } catch (error) {
        console.error('❌ [Song Prune] Lỗi:', error)
      }
    },
    { timezone: TZ }
  )

  console.log(`✅ Song Prune Scheduler initialized (04:00 hằng ngày, ${TZ})`)
}
