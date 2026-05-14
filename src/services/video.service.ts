import youtubeDl from 'youtube-dl-exec'
import NodeCache from 'node-cache'

// Cache với TTL dài hơn (1 ngày) để giảm số lần gọi API
const mediaCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 })

// Timeout ngắn hơn để đảm bảo phản hồi nhanh
const FETCH_TIMEOUT = 8000 // 8 giây

// Cấu hình cơ bản cho youtube-dl-exec
const baseOptions = {
  getUrl: true,
  skipDownload: true,
  quiet: true,
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
  youtubeSkipDashManifest: true,
  retries: 1,
  socketTimeout: 5
}

// Định nghĩa kiểu dữ liệu cho format video
interface VideoFormat {
  url: string
  ext?: string
  acodec?: string
  vcodec?: string
  height?: number
  resolution?: string
}

interface VideoInfo {
  formats: VideoFormat[]
}

// Dùng FastInfo để lấy nhanh thông tin video
const getFastVideoInfo = async (videoId: string): Promise<VideoInfo | null> => {
  try {
    // Chỉ lấy thông tin video, không lấy URL
    const result = (await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      ...baseOptions,
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true
    })) as unknown as VideoInfo

    return result
  } catch (error) {
    console.error('Error getting fast video info:', error)
    return null
  }
}

/** Kết quả probe: chỉ nên xóa DB khi `unavailable`; `unknown` = giữ lại (timeout, rate limit, lỗi mơ hồ) */
export type YoutubeVideoPresence = 'available' | 'unavailable' | 'unknown'

const YOUTUBE_METADATA_PROBE_TIMEOUT_MS = 12000

/**
 * Kiểm tra nhanh (yt-dlp dump JSON) xem video YouTube còn metadata hay đã gỡ/chặn.
 * Dùng cho job dọn thư viện bài hát; không đảm bảo phân biệt được mọi lý do (chỉ “còn” / “hết” / “không chắc”).
 */
export const probeYoutubeVideoPresence = async (videoId: string): Promise<YoutubeVideoPresence> => {
  const id = videoId?.trim()
  if (!id) return 'unknown'

  try {
    await Promise.race([
      youtubeDl(`https://www.youtube.com/watch?v=${id}`, {
        ...baseOptions,
        dumpSingleJson: true,
        skipDownload: true,
        noPlaylist: true
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('__YOUTUBE_PROBE_TIMEOUT__')), YOUTUBE_METADATA_PROBE_TIMEOUT_MS)
      )
    ])
    return 'available'
  } catch (error: unknown) {
    const stderr = typeof (error as { stderr?: string })?.stderr === 'string' ? (error as { stderr: string }).stderr : ''
    const message = error instanceof Error ? error.message : String(error)
    const msg = `${message}\n${stderr}`.toLowerCase()

    if (msg.includes('__youtube_probe_timeout__')) {
      return 'unknown'
    }

    if (/\b429\b|too many requests|rate.?limit/i.test(msg)) {
      return 'unknown'
    }

    if (
      /unavailable|removed|private video|copyright|blocked|terminated|not found|no longer available|members-only|video is private|this video has been deleted|no video formats|video unavailable/.test(
        msg
      )
    ) {
      return 'unavailable'
    }

    if (/http error 403|http error 404|http error 410|giving up after/.test(msg)) {
      return 'unavailable'
    }

    return 'unknown'
  }
}

export const getAudioUrl = async (videoId: string): Promise<string> => {
  try {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    // Kiểm tra cache trước
    const cacheKey = `audio_${videoId}`
    const cachedUrl = mediaCache.get<string>(cacheKey)
    if (cachedUrl) {
      console.log('Returning cached audio URL')
      return cachedUrl
    }

    console.time('AudioFetch')

    // Phương pháp nhanh: Thử với format có sẵn đơn giản nhất trước
    try {
      const fastAudioUrl = (await Promise.race([
        youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
          ...baseOptions,
          format: 'bestaudio/bestaudio[ext=m4a]/bestaudio',
          extractAudio: true,
          audioFormat: 'mp3',
          audioQuality: 2 // 0 best, 9 worst
        }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Audio fetch timeout')), FETCH_TIMEOUT))
      ])) as string

      if (fastAudioUrl && typeof fastAudioUrl === 'string') {
        console.timeEnd('AudioFetch')
        console.log('Audio URL found (fast method)')
        mediaCache.set(cacheKey, fastAudioUrl)
        return fastAudioUrl
      }
    } catch (fastError) {
      console.log('Fast audio extraction failed, trying fallback')
    }

    // Fallback: Dùng cách đơn giản nhất, chỉ quan tâm lấy được URL
    const audioUrl = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      ...baseOptions,
      format: 'bestaudio',
      noPlaylist: true
    })

    console.timeEnd('AudioFetch')

    if (!audioUrl || typeof audioUrl !== 'string') {
      throw new Error('Audio URL not found')
    }

    mediaCache.set(cacheKey, audioUrl)
    console.log('Audio URL found (fallback method)')

    return audioUrl
  } catch (error) {
    console.error(`Failed to fetch audio for ID: ${videoId}`, error)
    throw new Error(`Could not retrieve audio URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const getVideoUrl = async (videoId: string): Promise<string> => {
  try {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    // Kiểm tra cache trước
    const cacheKey = `video_${videoId}`
    const cachedUrl = mediaCache.get<string>(cacheKey)
    if (cachedUrl) {
      console.log('Returning cached video URL')
      return cachedUrl
    }

    console.time('VideoFetch')

    // Phương pháp nhanh: Thử với format có sẵn đơn giản nhất trước
    try {
      const fastVideoUrl = (await Promise.race([
        youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
          ...baseOptions,
          format: 'bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]', // Giảm xuống 720p để lấy nhanh hơn
          noPlaylist: true
        }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Video fetch timeout')), FETCH_TIMEOUT))
      ])) as string

      if (fastVideoUrl && typeof fastVideoUrl === 'string') {
        console.timeEnd('VideoFetch')
        console.log('Video URL found (fast method)')
        mediaCache.set(cacheKey, fastVideoUrl)
        return fastVideoUrl
      }
    } catch (fastError) {
      console.log('Fast video extraction failed, trying fallback')
    }

    // Fallback: Dùng cách đơn giản nhất, chỉ quan tâm lấy được URL
    const videoUrl = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      ...baseOptions,
      format: 'bestvideo[height<=720]',
      noPlaylist: true
    })

    console.timeEnd('VideoFetch')

    if (!videoUrl || typeof videoUrl !== 'string') {
      throw new Error('Video URL not found')
    }

    mediaCache.set(cacheKey, videoUrl)
    console.log('Video URL found (fallback method)')

    return videoUrl
  } catch (error) {
    console.error(`Failed to fetch video for ID: ${videoId}`, error)
    throw new Error(`Could not retrieve video URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const getMediaUrls = async (videoId: string): Promise<{ audioUrl: string; videoUrl: string }> => {
  try {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    // Kiểm tra cache trước
    const cacheKey = `media_${videoId}`
    const cachedMedia = mediaCache.get<{ audioUrl: string; videoUrl: string }>(cacheKey)
    if (cachedMedia) {
      console.log('Returning cached media URLs')
      return cachedMedia
    }

    console.time('MediaFetch')

    // Thử lấy cả audio và video cùng lúc với định dạng đơn giản
    try {
      // 1. Cách tiếp cận nhanh nhất - chúng ta sẽ cố gắng lấy thông tin một lần duy nhất
      const fastInfo = await getFastVideoInfo(videoId)
      if (fastInfo && fastInfo.formats) {
        const audioFormat = fastInfo.formats.find(
          (f: VideoFormat) => (f.acodec !== 'none' && f.vcodec === 'none') || (f.acodec !== 'none' && !f.resolution)
        )

        const videoFormat = fastInfo.formats.find(
          (f: VideoFormat) => f.vcodec !== 'none' && f.height && f.height <= 720 && f.height >= 360 && f.ext === 'mp4'
        )

        if (audioFormat?.url && videoFormat?.url) {
          const result = {
            audioUrl: audioFormat.url,
            videoUrl: videoFormat.url
          }

          mediaCache.set(cacheKey, result)
          console.timeEnd('MediaFetch')
          console.log('Media URLs obtained via fast method')
          return result
        }
      }

      // 2. Song song với timeout ngắn
      console.log('Trying parallel fetch with short timeout')
      const [audioUrl, videoUrl] = await Promise.all([getAudioUrl(videoId), getVideoUrl(videoId)])

      const result = { audioUrl, videoUrl }
      mediaCache.set(cacheKey, result)

      console.timeEnd('MediaFetch')
      console.log('Media URLs obtained via parallel fetch')

      return result
    } catch (parallelError) {
      console.error('Parallel fetch error:', parallelError)

      // 3. Tuần tự nếu song song thất bại
      console.log('Trying sequential fetch as fallback')
      const audioUrl = await getAudioUrl(videoId)
      const videoUrl = await getVideoUrl(videoId)

      const result = { audioUrl, videoUrl }
      mediaCache.set(cacheKey, result)

      console.timeEnd('MediaFetch')
      console.log('Media URLs obtained via sequential fetch')

      return result
    }
  } catch (error) {
    console.error(`Failed to fetch media URLs for ID: ${videoId}`, error)
    throw new Error(`Could not retrieve media URLs: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
