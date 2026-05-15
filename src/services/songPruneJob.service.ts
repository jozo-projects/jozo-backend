import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { SongPruneAbortedError } from '~/errors/SongPruneAbortedError'
import { songService } from '~/services/song.service'
import { Logger } from '~/utils/logger'

export type SongPruneJobStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
export type SongPruneJobSource = 'api' | 'cron'

export interface SongPruneJobSnapshot {
  job_id: string | null
  status: SongPruneJobStatus
  source: SongPruneJobSource | null
  dry_run: boolean
  total: number
  checked: number
  percent: number
  removed_from_db: number
  unavailable_on_youtube: number
  skipped_unknown: number
  elapsed_sec: number
  started_at: string | null
  finished_at: string | null
  error: string | null
}

export interface SongPruneJobRunOptions {
  source: SongPruneJobSource
  concurrency?: number
  batchSize?: number
  dryRun?: boolean
  omitVideoIds?: boolean
}

export const songPruneJobEventEmitter = new EventEmitter()

const idleSnapshot = (): SongPruneJobSnapshot => ({
  job_id: null,
  status: 'idle',
  source: null,
  dry_run: false,
  total: 0,
  checked: 0,
  percent: 0,
  removed_from_db: 0,
  unavailable_on_youtube: 0,
  skipped_unknown: 0,
  elapsed_sec: 0,
  started_at: null,
  finished_at: null,
  error: null
})

class SongPruneJobService {
  private readonly logger = new Logger('SongPruneJobService')
  private snapshot: SongPruneJobSnapshot = idleSnapshot()
  private startedAtMs = 0
  private lastEmitAt = 0
  private running = false
  private abortController: AbortController | null = null

  getStatus(): SongPruneJobSnapshot {
    return { ...this.snapshot }
  }

  isRunning(): boolean {
    return this.running
  }

  /**
   * Yêu cầu dừng job đang chạy (dừng sau khi xong bài hiện tại đang probe).
   */
  cancel(): { cancelled: boolean; job: SongPruneJobSnapshot; message?: string } {
    if (!this.running || !this.abortController) {
      return {
        cancelled: false,
        job: this.getStatus(),
        message:
          this.snapshot.status === 'cancelled'
            ? 'Job đã được hủy trước đó'
            : 'Không có tiến trình quét/xóa bài YouTube đang chạy'
      }
    }

    this.abortController.abort()
    this.logger.info(`Cancel requested for job ${this.snapshot.job_id}`)
    return {
      cancelled: true,
      job: this.getStatus(),
      message: 'Đã gửi yêu cầu hủy. Tiến trình sẽ dừng trong giây lát.'
    }
  }

  /**
   * Chạy prune nền. Trả về false nếu đã có job đang chạy.
   */
  start(options: SongPruneJobRunOptions): { started: boolean; job: SongPruneJobSnapshot; message?: string } {
    if (this.running) {
      return {
        started: false,
        job: this.getStatus(),
        message: 'Đang có tiến trình quét/xóa bài YouTube chạy. Vui lòng đợi hoàn tất.'
      }
    }

    void this.execute(options)
    return { started: true, job: this.getStatus() }
  }

  private emitProgress(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmitAt < 400) return
    this.lastEmitAt = now
    songPruneJobEventEmitter.emit('progress', this.getStatus())
  }

  private patch(partial: Partial<SongPruneJobSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial }
    if (this.snapshot.status === 'running') {
      this.emitProgress()
    }
  }

  private async execute(options: SongPruneJobRunOptions) {
    const jobId = randomUUID()
    const dryRun = Boolean(options.dryRun)
    this.running = true
    this.abortController = new AbortController()
    this.startedAtMs = Date.now()
    this.lastEmitAt = 0

    this.snapshot = {
      ...idleSnapshot(),
      job_id: jobId,
      status: 'running',
      source: options.source,
      dry_run: dryRun,
      started_at: new Date().toISOString()
    }
    this.emitProgress(true)
    songPruneJobEventEmitter.emit('started', this.getStatus())

    try {
      const result = await songService.pruneSongsNotOnYoutube({
        concurrency: options.concurrency,
        batchSize: options.batchSize,
        dryRun,
        omitVideoIds: options.omitVideoIds ?? true,
        signal: this.abortController?.signal,
        onProgress: (progress) => {
          this.patch({
            total: progress.total,
            checked: progress.checked,
            percent: progress.percent,
            removed_from_db: progress.removed_from_db,
            unavailable_on_youtube: progress.unavailable_on_youtube,
            skipped_unknown: progress.skipped_unknown,
            elapsed_sec: progress.elapsed_sec
          })
        }
      })

      const elapsedSec = Math.round((Date.now() - this.startedAtMs) / 1000)
      const percent = this.snapshot.total > 0 ? 100 : 0

      this.snapshot = {
        job_id: jobId,
        status: 'completed',
        source: options.source,
        dry_run: dryRun,
        total: this.snapshot.total || result.checked,
        checked: result.checked,
        percent,
        removed_from_db: result.removed_from_db,
        unavailable_on_youtube: result.unavailable_on_youtube,
        skipped_unknown: result.skipped_unknown,
        elapsed_sec: elapsedSec,
        started_at: this.snapshot.started_at,
        finished_at: new Date().toISOString(),
        error: null
      }

      this.logger.info(
        `Job ${jobId} completed: removed=${result.removed_from_db}, unavailable=${result.unavailable_on_youtube}, checked=${result.checked}`
      )
      songPruneJobEventEmitter.emit('finished', this.getStatus())
    } catch (error) {
      const elapsedSec = Math.round((Date.now() - this.startedAtMs) / 1000)

      if (error instanceof SongPruneAbortedError) {
        this.snapshot = {
          ...this.snapshot,
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          error: null,
          elapsed_sec: elapsedSec
        }
        this.logger.info(
          `Job ${jobId} cancelled: checked=${this.snapshot.checked}, removed=${this.snapshot.removed_from_db}`
        )
        songPruneJobEventEmitter.emit('finished', this.getStatus())
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      this.snapshot = {
        ...this.snapshot,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: message,
        elapsed_sec: elapsedSec
      }
      this.logger.error(`Job ${jobId} failed`, error)
      songPruneJobEventEmitter.emit('finished', this.getStatus())
    } finally {
      this.running = false
      this.abortController = null
    }
  }
}

export const songPruneJobService = new SongPruneJobService()
