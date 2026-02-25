/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from 'express'
import { type ParamsDictionary } from 'express-serve-static-core'
import { randomUUID } from 'crypto'
import { searchYoutube } from '~/services/youtubeSearch.service'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { SONG_QUEUE_MESSAGES } from '~/constants/messages'
import { AddSongRequestBody } from '~/models/requests/Song.request'
import { VideoSchema } from '~/models/schemas/Video.schema'
import redis from '~/services/redis.service'
import { roomMusicServices } from '~/services/roomMusic.service'
import { songService } from '~/services/song.service'
import serverService from '~/services/server.service'
import { fetchVideoInfo } from '~/utils/common'

/**
 * @description Add song to queue
 * @path /song-queue/rooms/:roomId/queue
 * @method POST
 * @body {video_id: string, title: string, thumbnail: string, author: string, position?: "top" | "end"} @type {AddSongRequestBody}
 * @author QuangDoo
 */
export const addSong = async (
  req: Request<ParamsDictionary, any, AddSongRequestBody & { position?: 'top' | 'end' }>,
  res: Response,
  next: NextFunction
) => {
  const { roomId } = req.params
  const { video_id, title, thumbnail, author, position = 'end', duration } = req.body

  try {
    const updatedQueue = await roomMusicServices.addSongToQueue(
      roomId,
      { video_id, title, thumbnail, author, duration },
      position
    )

    let nowPlaying = await roomMusicServices.getNowPlaying(roomId)
    const currentQueue = await roomMusicServices.getSongsInQueue(roomId)

    // Emit sự kiện cập nhật queue cho tất cả client trong phòng
    serverService.io.to(roomId).emit('queue_updated', updatedQueue)

    if (!nowPlaying) {
      nowPlaying = await roomMusicServices.getNowPlaying(roomId)

      if (!nowPlaying && currentQueue.length > 0) {
        const { nowPlaying: nextSong, queue } = await roomMusicServices.playNextSong(roomId)

        // Emit các sự kiện khi bắt đầu phát bài hát mới
        serverService.io.to(roomId).emit('queue_updated', queue)
        serverService.io.to(roomId).emit('video_event', {
          event: 'play',
          videoId: nextSong?.video_id,
          currentTime: 0
        })
        serverService.io.to(roomId).emit('play_song', {
          ...nextSong,
          isPlaying: true,
          currentTime: 0,
          timestamp: Date.now()
        })

        return res.status(HTTP_STATUS_CODE.CREATED).json({
          message: SONG_QUEUE_MESSAGES.ADD_SONG_TO_QUEUE_SUCCESS,
          result: {
            nowPlaying: nextSong,
            queue
          }
        })
      }
    }

    res.status(HTTP_STATUS_CODE.CREATED).json({
      message: SONG_QUEUE_MESSAGES.ADD_SONG_TO_QUEUE_SUCCESS,
      result: {
        nowPlaying: nowPlaying,
        queue: updatedQueue
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Save song to library (upsert by video_id)
 * @path /song-queue/rooms/:roomId/save-song
 * @method POST
 * @body {video_id: string, title: string, thumbnail?: string, author: string, duration?: number, url?: string}
 */
export const saveSong = async (
  req: Request<ParamsDictionary, any, AddSongRequestBody>,
  res: Response,
  next: NextFunction
) => {
  const { video_id, title, thumbnail, author, duration, url } = req.body

  try {
    if (!video_id || !title || !author) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'video_id, title và author là bắt buộc'
      })
    }

    const savedSong = await songService.upsertSong({
      video_id,
      title,
      author,
      duration,
      url,
      thumbnail
    })

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SAVE_SONG_SUCCESS,
      result: savedSong
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Add songs to queue
 * @path /song-queue/rooms/:roomId/add-songs
 * @method POST
 * @body {songs: AddSongRequestBody[]} @type {AddSongRequestBody[]}
 * @author QuangDoo
 */
export const addSongsToQueue = async (
  req: Request<ParamsDictionary, any, { songs: AddSongRequestBody[] }>,
  res: Response,
  next: NextFunction
) => {
  const { roomId } = req.params
  const { songs } = req.body

  try {
    const updatedQueue = await roomMusicServices.addSongsToQueue(roomId, songs)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: SONG_QUEUE_MESSAGES.ADD_SONGS_TO_QUEUE_SUCCESS,
      result: {
        queue: updatedQueue
      }
    })
  } catch (error) {
    next(error)
  }
}
/**
 * @description Remove song from queue
 * @path /song-queue/rooms/:roomId/queue
 * @method DELETE
 * @body {index: number} @type {{ index: number }}
 * @author QuangDoo
 */
export const removeSong = async (
  req: Request<ParamsDictionary, any, { index: string }>,
  res: Response,
  next: NextFunction
) => {
  const { roomId, index } = req.params

  try {
    const updatedQueue = await roomMusicServices.removeSongFromQueue(roomId, Number(index))
    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.REMOVE_SONG_FROM_QUEUE_SUCCESS,
      result: {
        queue: updatedQueue
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Remove all songs in queue
 * @path /song-queue/rooms/:roomId/queue
 * @method DELETE
 * @author QuangDoo
 */
export const removeAllSongsInQueue = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params
  try {
    await roomMusicServices.removeAllSongsInQueue(roomId)
    res.status(HTTP_STATUS_CODE.OK).json({ message: SONG_QUEUE_MESSAGES.REMOVE_ALL_SONGS_IN_QUEUE_SUCCESS })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Play next song
 * @path /song-queue/rooms/:roomId/play
 * @method POST
 * @author QuangDoo
 */
export const playNextSong = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params

  try {
    // Kiểm tra trạng thái hiện tại trước khi thực hiện thay đổi
    const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)

    const { nowPlaying, queue } = await roomMusicServices.playNextSong(roomId)

    if (!nowPlaying && queue.length === 0) {
      // Chỉ xóa now_playing khi không còn bài hát nào trong hàng đợi
      await redis.del(`room_${roomId}_now_playing`)
      serverService.io.to(roomId).emit('now_playing_cleared')

      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: SONG_QUEUE_MESSAGES.NO_SONG_IN_QUEUE,
        result: {
          previousSong: currentNowPlaying, // Thêm thông tin về bài hát trước đó
          queue: []
        }
      })
    }

    // Reset các trạng thái liên quan đến playback
    await Promise.all([
      redis.set(`room_${roomId}_playback`, 'play'),
      redis.set(`room_${roomId}_current_time`, '0'),
      redis.set(
        `room_${roomId}_now_playing`,
        JSON.stringify({
          ...nowPlaying,
          currentTime: 0,
          timestamp: Date.now()
        })
      )
    ])

    // Emit các sự kiện theo thứ tự
    serverService.io.to(roomId).emit('queue_updated', queue)

    // 2. Reset và load video mới
    serverService.io.to(roomId).emit('video_event', {
      event: 'play',
      videoId: nowPlaying?.video_id,
      currentTime: 0
    })

    // 3. Cập nhật thông tin now playing
    serverService.io.to(roomId).emit('play_song', {
      ...nowPlaying,
      isPlaying: true,
      currentTime: 0,
      timestamp: Date.now()
    })

    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SONG_IS_NOW_PLAYING,
      result: {
        nowPlaying: {
          ...nowPlaying,
          currentTime: 0,
          timestamp: Date.now()
        },
        queue
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get songs in queue
 * @path /song-queue/:roomId
 * @method GET
 * @author QuangDoo
 */
export const getSongsInQueue = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params

  try {
    const queue = await roomMusicServices.getSongsInQueue(roomId)
    const nowPlaying = await roomMusicServices.getNowPlaying(roomId)

    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.GET_SONGS_IN_QUEUE_SUCCESS,
      result: {
        nowPlaying,
        queue
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Control song playback (play/pause)
 * @path /song-queue/rooms/:roomId/playback/:action
 * @method POST
 * @params action: "play" | "pause"
 * @author QuangDoo
 */
export const controlPlayback = async (req: Request<ParamsDictionary>, res: Response, next: NextFunction) => {
  const { roomId, action } = req.params
  const { current_time } = req.body
  const BUFFER_TIME = 1.5 // Buffer 1.5 giây

  try {
    const nowPlaying = await roomMusicServices.getNowPlaying(roomId)

    if (!nowPlaying) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: SONG_QUEUE_MESSAGES.NO_SONG_IN_QUEUE
      })
    }

    // Kiểm tra nếu video gần kết thúc (còn 1.5s hoặc ít hơn)
    if (current_time && nowPlaying.duration) {
      const remainingTime = nowPlaying.duration - current_time
      if (remainingTime <= BUFFER_TIME) {
        // Tự động chuyển sang bài tiếp theo
        const { nowPlaying: nextSong, queue } = await roomMusicServices.playNextSong(roomId)

        if (nextSong) {
          serverService.io.to(roomId).emit('video_event', {
            event: 'play',
            videoId: nextSong.video_id,
            currentTime: 0
          })

          return res.status(HTTP_STATUS_CODE.OK).json({
            message: SONG_QUEUE_MESSAGES.SONG_IS_NOW_PLAYING,
            result: {
              nowPlaying: nextSong,
              queue
            }
          })
        }
      }
    }

    // Emit video_event thay vì play_song/pause_song riêng lẻ
    serverService.io.to(roomId).emit('video_event', {
      event: action, // 'play' hoặc 'pause'
      videoId: nowPlaying.video_id,
      currentTime: current_time || 0
    })

    // Lưu trạng thái playback
    await redis.set(`room_${roomId}_playback`, action)

    if (current_time) {
      await redis.set(`room_${roomId}_current_time`, current_time)
    }

    res.status(HTTP_STATUS_CODE.OK).json({
      message: action === 'play' ? SONG_QUEUE_MESSAGES.SONG_PLAYING : SONG_QUEUE_MESSAGES.SONG_PAUSED,
      result: { action, current_time }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * get video info by ytdl
 * @path /song-queue/rooms/:roomId/youtube/:url
 * @method GET
 * @author QuangDoo
 */
export const getVideoInfo = async (req: Request, res: Response, next: NextFunction) => {
  const { videoId } = req.params
  try {
    console.log('videoId', videoId)
    const videoInfo = await roomMusicServices.getVideoInfo(videoId)
    res.status(HTTP_STATUS_CODE.OK).json({ message: SONG_QUEUE_MESSAGES.GET_VIDEO_INFO_SUCCESS, result: videoInfo })
  } catch (error) {
    next(error)
  }
}

/**
 * Update queue
 * @path /song-queue/rooms/:roomId/queue
 * @method PUT
 * @author QuangDoo
 */
export const updateQueue = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params
  const { queue } = req.body

  try {
    const updatedQueue = await roomMusicServices.updateQueue(roomId, queue)
    res.status(HTTP_STATUS_CODE.OK).json({ message: SONG_QUEUE_MESSAGES.UPDATE_QUEUE_SUCCESS, result: updatedQueue })
  } catch (error) {
    next(error)
  }
}

/**
 * Get song name
 * @path /song-queue/rooms/:roomId/autocomplete
 * @method GET
 * @author QuangDoo
 */
export const getSongName = async (req: Request, res: Response, next: NextFunction) => {
  const { isKaraoke, keyword } = req.query

  try {
    const _keyword = String(keyword || '')
    const isKaraokeBoolean = isKaraoke === 'true'
    const songName = await roomMusicServices.getSongName(_keyword, isKaraokeBoolean)
    res.status(HTTP_STATUS_CODE.OK).json({ message: SONG_QUEUE_MESSAGES.GET_SONG_NAME_SUCCESS, result: songName })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Play chosen song at specific index in queue
 * @path /room-music/:roomId/play-chosen-song
 * @method POST
 * @body {videoIndex: number}
 * @author [Your Name]
 */
export const playChosenSong = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params
  const { videoIndex } = req.body

  if (videoIndex === undefined || videoIndex === null) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Video index is required'
    })
  }

  try {
    // Kiểm tra trạng thái hiện tại trước khi thực hiện thay đổi
    const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)

    // Phát bài hát được chọn từ hàng đợi
    const { nowPlaying, queue } = await roomMusicServices.playChosenSong(roomId, parseInt(videoIndex))

    if (!nowPlaying) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: SONG_QUEUE_MESSAGES.NO_SONG_IN_QUEUE,
        result: {
          previousSong: currentNowPlaying,
          queue
        }
      })
    }

    // Reset các trạng thái liên quan đến playback
    await Promise.all([
      redis.set(`room_${roomId}_playback`, 'play'),
      redis.set(`room_${roomId}_current_time`, '0'),
      redis.set(
        `room_${roomId}_now_playing`,
        JSON.stringify({
          ...nowPlaying,
          currentTime: 0,
          timestamp: Date.now()
        })
      )
    ])

    // Emit các sự kiện theo thứ tự
    serverService.io.to(roomId).emit('queue_updated', queue)

    // Reset và load video mới
    serverService.io.to(roomId).emit('video_event', {
      event: 'play',
      videoId: nowPlaying?.video_id,
      currentTime: 0
    })

    // Cập nhật thông tin now playing
    serverService.io.to(roomId).emit('play_song', {
      ...nowPlaying,
      isPlaying: true,
      currentTime: 0,
      timestamp: Date.now()
    })

    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SONG_IS_NOW_PLAYING,
      result: {
        nowPlaying: {
          ...nowPlaying,
          currentTime: 0,
          timestamp: Date.now()
        },
        queue
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description send notification to admin by room index
 * @path /song-queue/rooms/:roomId/send-notification
 * @method POST
 * @author QuangDoo
 */
export const sendNotification = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params
  const { message } = req.body

  try {
    await roomMusicServices.sendNotificationToAdmin(roomId, message)
    // Send success response
    res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Notification sent successfully',
      result: {
        roomId,
        message,
        timestamp: Date.now()
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Stream video
 * @path /song-queue/rooms/:roomId/stream-video
 * @method GET
 * @author QuangDoo
 */
export const streamVideo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await fetchVideoInfo(req.params.videoId)
    res.status(HTTP_STATUS_CODE.OK).json({ result: data })
  } catch (err) {
    next(err)
  }
}

/**
 * @description Search songs
 * @path /room-music/:roomId/search-songs
 * @method GET
 * @author QuangDoo
 */
export const searchSongs = async (req: Request, res: Response, next: NextFunction) => {
  const { q, limit = '30' } = req.query
  const { roomId } = req.params
  const parsedLimit = parseInt(limit as string, 10)
  const requestId = randomUUID()
  const LOCAL_LIMIT = 25
  const YT_SEARCH_TIMEOUT = 20000 // 20 giây timeout cho yt-search

  // Validate search query
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid search query' })
  }

  // Validate limit parameter - Giảm limit tối đa để tăng tốc độ
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 50' })
  }

  try {
    // 1) Tìm nhanh trong DB và trả về ngay
    const localSongs = await songService.searchSongs(q, LOCAL_LIMIT)
    const localResults = localSongs.map((song) => ({
      ...new VideoSchema({
        video_id: song.video_id,
        title: song.title,
        duration: song.duration ?? 0,
        url: song.url ?? '',
        thumbnail: song.thumbnail ?? '',
        author: song.author
      }),
      match_score: song.match_score,
      is_phrase_match: song.is_phrase_match
    }))

    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
      result: {
        requestId,
        local: localResults.map((video) => ({ ...video, is_saved: true, source: 'local' })),
        remote: [],
        remote_pending: true
      }
    })

    // 2) Chạy yt-search bất đồng bộ và đẩy kết quả qua socket
    void (async () => {
      const startTime = Date.now()
      let socketEmitted = false

      // Helper function để emit socket một cách an toàn
      const safeEmit = (data: { requestId: string; source: string; remote: any[]; status: string }) => {
        try {
          // Kiểm tra số lượng socket trong room trước khi emit
          const room = serverService.io.sockets.adapter.rooms.get(roomId)
          const socketCount = room ? room.size : 0

          if (socketCount === 0) {
            console.log(`[search-songs] Room ${roomId} has no active sockets, skipping emit for requestId ${requestId}`)
            return
          }

          console.log(
            `[search-songs] Emitting to room ${roomId} (${socketCount} sockets) - requestId: ${requestId}, status: ${data.status}`
          )
          serverService.io.to(roomId).emit('search_songs_completed', data)
          socketEmitted = true
        } catch (emitError) {
          console.error(`[search-songs] Error emitting socket for requestId ${requestId}:`, emitError)
        }
      }

      try {
        console.log(
          `[search-songs] Starting YouTube search for query: "${q}", requestId: ${requestId}, roomId: ${roomId}`
        )

        const searchPromise = searchYoutube(q, { limit: parsedLimit })
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`YouTube search timeout after ${YT_SEARCH_TIMEOUT}ms`))
          }, YT_SEARCH_TIMEOUT)
        })

        const result = await Promise.race([searchPromise, timeoutPromise])
        const searchDuration = Date.now() - startTime
        console.log(
          `[search-songs] query="${q}" videos=${result.videos?.length ?? 0} duration=${searchDuration}ms requestId=${requestId}`
        )

        const videos = (result.videos ?? []).slice(0, parsedLimit).map((video) => ({
          ...new VideoSchema({
            video_id: video.videoId,
            title: video.title ?? '',
            duration: video.seconds,
            url: video.url ?? '',
            thumbnail: video.thumbnail || '',
            author: video.author?.name ?? ''
          }),
          views: video.views || 0
        }))

        const savedMap = await songService.getSavedSongsByVideoIds(videos.map((video) => video.video_id))

        const savedVideos: Array<VideoSchema & { is_saved: boolean; views: number }> = []
        const otherVideos: Array<VideoSchema & { is_saved: boolean; views: number }> = []

        videos.forEach((video) => {
          const withFlag = { ...video, is_saved: Boolean(savedMap[video.video_id]) }
          if (withFlag.is_saved) {
            savedVideos.push(withFlag)
          } else {
            otherVideos.push(withFlag)
          }
        })

        // Sắp xếp từng nhóm theo view count (giảm dần)
        savedVideos.sort((a, b) => (b.views || 0) - (a.views || 0))
        otherVideos.sort((a, b) => (b.views || 0) - (a.views || 0))

        const prioritizedVideos = [...savedVideos, ...otherVideos]
          .map((video) => {
            const scored = songService.computeMatchScore(q as string, video.title, video.author)
            return {
              ...video,
              source: 'yt',
              match_score: scored.match_score,
              is_phrase_match: scored.is_phrase_match
            }
          })
          // Lọc bỏ các video có match_score quá thấp (không liên quan)
          .filter((video) => video.match_score >= 0)
          // Sắp xếp theo match_score giảm dần để ưu tiên kết quả liên quan nhất
          .sort((a, b) => b.match_score - a.match_score)
          // Giới hạn số lượng kết quả
          .slice(0, parsedLimit)

        console.log(`[yt-emit] count=${prioritizedVideos.length} requestId=${requestId} roomId=${roomId}`)
        safeEmit({
          requestId,
          source: 'yt',
          remote: prioritizedVideos,
          status: 'ok'
        })
      } catch (error) {
        const errorDuration = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(
          `[search-songs] Error after ${errorDuration}ms - requestId: ${requestId}, roomId: ${roomId}, error:`,
          errorMessage
        )

        // Đảm bảo luôn emit error response để client biết
        if (!socketEmitted) {
          safeEmit({
            requestId,
            source: 'yt',
            remote: [],
            status: 'error'
          })
        }
      }
    })()
  } catch (error) {
    console.error('[search-songs] Fatal error:', error)
    next(error)
  }
}

/**
 * @description Search local songs (from database) - Fast response
 * @path /room-music/search-songs/local
 * @method GET
 * @query q: string, limit?: number
 * @author QuangDoo
 */
export const searchLocalSongs = async (req: Request, res: Response, next: NextFunction) => {
  const { q, limit = '25' } = req.query
  const parsedLimit = parseInt(limit as string, 10)

  // Validate search query
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid search query' })
  }

  // Validate limit parameter
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 50' })
  }

  try {
    const startTime = Date.now()
    const localSongs = await songService.searchSongs(q, parsedLimit)
    const searchDuration = Date.now() - startTime

    const localResults = localSongs.map((song) => ({
      ...new VideoSchema({
        video_id: song.video_id,
        title: song.title,
        duration: song.duration ?? 0,
        url: song.url ?? '',
        thumbnail: song.thumbnail ?? '',
        author: song.author
      }),
      match_score: song.match_score,
      is_phrase_match: song.is_phrase_match,
      is_saved: true,
      source: 'local'
    }))

    console.log(`[search-local] query="${q}" results=${localResults.length} duration=${searchDuration}ms`)

    res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
      result: {
        songs: localResults,
        source: 'local',
        duration: searchDuration
      }
    })
  } catch (error) {
    console.error('[search-local] Error:', error)
    next(error)
  }
}

/**
 * @description Search remote songs (from YouTube) - May take longer, uses Redis cache
 * @path /room-music/search-songs/remote
 * @method GET
 * @query q: string, limit?: number
 * @author QuangDoo
 */
export const searchRemoteSongs = async (req: Request, res: Response, next: NextFunction) => {
  const { q, limit = '30' } = req.query
  const parsedLimit = parseInt(limit as string, 10)
  const YT_SEARCH_TIMEOUT = 20000 // 20 giây timeout

  // Validate search query
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid search query' })
  }

  // Validate limit parameter
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 50' })
  }

  try {
    const startTime = Date.now()
    const cacheKey = `remote_search:${q.toLowerCase().trim()}:${parsedLimit}`
    const CACHE_TTL = 300 // Cache 5 phút
    const RATE_LIMIT_CACHE_TTL = 90 // Cache lỗi 429 trong 90s để tránh gọi liên tục

    // Kiểm tra cache "đang bị rate limit" (prod hay gặp 429) — trả 503 ngay, không gọi yt-search
    const rateLimitKey = `remote_search_429:${q.toLowerCase().trim()}:${parsedLimit}`
    const rateLimitCached = await redis.get(rateLimitKey)
    if (rateLimitCached) {
      console.log(`[search-remote] Rate limit cache hit for query="${q}", returning 503`)
      return res.status(503).json({
        error: 'Search temporarily unavailable',
        message: 'Quá tải, vui lòng thử lại sau vài phút.',
        code: 'RATE_LIMIT',
        duration: Date.now() - startTime
      })
    }

    // Kiểm tra cache trước
    const cachedResult = await redis.get(cacheKey)
    if (cachedResult) {
      const cachedData = JSON.parse(cachedResult)
      console.log(`[search-remote] Cache hit for query="${q}"`)
      return res.status(HTTP_STATUS_CODE.OK).json({
        message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
        result: {
          ...cachedData,
          source: 'remote',
          cached: true,
          duration: Date.now() - startTime
        }
      })
    }

    // Kiểm tra xem có request đang chạy không (tránh duplicate requests)
    const lockKey = `remote_search_lock:${q.toLowerCase().trim()}:${parsedLimit}`
    const lockExists = await redis.exists(lockKey)
    const POLL_INTERVAL_MS = 1500
    const MAX_WAIT_FOR_CACHE_MS = 25000 // ~25s, nhiều hơn YT_SEARCH_TIMEOUT để đợi request đầu hoàn thành

    if (lockExists) {
      // Poll cache thay vì chạy thêm yt-search trùng → request sau đợi và dùng kết quả cache từ request đầu
      console.log(`[search-remote] Request in progress for query="${q}", polling cache...`)
      let waited = 0
      while (waited < MAX_WAIT_FOR_CACHE_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        waited += POLL_INTERVAL_MS
        const retryCachedResult = await redis.get(cacheKey)
        if (retryCachedResult) {
          const cachedData = JSON.parse(retryCachedResult)
          console.log(`[search-remote] Cache hit after waiting ${waited}ms for query="${q}"`)
          return res.status(HTTP_STATUS_CODE.OK).json({
            message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
            result: {
              ...cachedData,
              source: 'remote',
              cached: true,
              duration: Date.now() - startTime
            }
          })
        }
        const stillLocked = await redis.exists(lockKey)
        if (!stillLocked) break // request đầu đã xong (lỗi hoặc timeout), mình chạy tiếp
      }
    }

    // Set lock để tránh duplicate requests
    await redis.setex(lockKey, 30, '1') // Lock trong 30 giây

    try {
      console.log(`[search-remote] Starting YouTube search for query: "${q}"`)

      const searchPromise = searchYoutube(q, { limit: parsedLimit })
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`YouTube search timeout after ${YT_SEARCH_TIMEOUT}ms`))
        }, YT_SEARCH_TIMEOUT)
      })

      const result = await Promise.race([searchPromise, timeoutPromise])
      const ytSearchDuration = Date.now() - startTime
      console.log(`[search-remote] YouTube search done in ${ytSearchDuration}ms for query="${q}"`)

      if (!result?.videos || !Array.isArray(result.videos)) {
        throw new Error('YouTube search returned invalid result (missing or empty videos)')
      }

      const videos = result.videos.slice(0, parsedLimit).map((video) => ({
        ...new VideoSchema({
          video_id: video.videoId,
          title: video.title ?? '',
          duration: video.seconds,
          url: video.url ?? '',
          thumbnail: video.thumbnail || '',
          author: video.author?.name ?? ''
        }),
        views: video.views || 0
      }))

      const beforeSaved = Date.now()
      const savedMap = await songService.getSavedSongsByVideoIds(videos.map((video) => video.video_id))
      console.log(
        `[search-remote] getSavedSongsByVideoIds in ${Date.now() - beforeSaved}ms for ${videos.length} videos`
      )

      const savedVideos: Array<VideoSchema & { is_saved: boolean; views: number }> = []
      const otherVideos: Array<VideoSchema & { is_saved: boolean; views: number }> = []

      videos.forEach((video) => {
        const withFlag = { ...video, is_saved: Boolean(savedMap[video.video_id]) }
        if (withFlag.is_saved) {
          savedVideos.push(withFlag)
        } else {
          otherVideos.push(withFlag)
        }
      })

      // Sắp xếp từng nhóm theo view count (giảm dần)
      savedVideos.sort((a, b) => (b.views || 0) - (a.views || 0))
      otherVideos.sort((a, b) => (b.views || 0) - (a.views || 0))

      const prioritizedVideos = [...savedVideos, ...otherVideos]
        .map((video) => {
          const scored = songService.computeMatchScore(q as string, video.title, video.author)
          return {
            ...video,
            source: 'yt',
            match_score: scored.match_score,
            is_phrase_match: scored.is_phrase_match
          }
        })
        .filter((video) => video.match_score >= 0)
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, parsedLimit)

      const searchDuration = Date.now() - startTime
      const responseData = {
        songs: prioritizedVideos,
        source: 'remote',
        cached: false,
        duration: searchDuration
      }

      // Lưu vào cache
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(responseData))

      console.log(`[search-remote] query="${q}" results=${prioritizedVideos.length} duration=${searchDuration}ms`)

      // Xóa lock
      await redis.del(lockKey)

      res.status(HTTP_STATUS_CODE.OK).json({
        message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
        result: responseData
      })
    } catch (error) {
      // Xóa lock khi có lỗi
      await redis.del(lockKey)

      const errorDuration = Date.now() - startTime
      // yt-search có thể throw string, object (vd { statusCode, message }) hoặc Error — chuẩn hóa để log + trả client
      const rawMessage = (() => {
        if (error instanceof Error) return error.message
        if (typeof error === 'string') return error
        if (error && typeof error === 'object' && 'message' in error) {
          return String((error as { message: unknown }).message)
        }
        return error != null ? String(error) : 'Unknown error'
      })()
      const safeMessage = rawMessage.length > 200 ? rawMessage.slice(0, 200) + '…' : rawMessage
      const is429 =
        /429|rate limit|too many requests/i.test(rawMessage) ||
        (error && typeof error === 'object' && (error as { statusCode?: number }).statusCode === 429)

      console.error(
        `[search-remote] Error after ${errorDuration}ms - query: "${q}", message:`,
        safeMessage,
        error instanceof Error ? error.stack : error
      )

      if (is429) {
        await redis.setex(rateLimitKey, RATE_LIMIT_CACHE_TTL, '1')
        return res.status(503).json({
          error: 'Search temporarily unavailable',
          message: 'Quá tải, vui lòng thử lại sau vài phút.',
          code: 'RATE_LIMIT',
          duration: errorDuration
        })
      }

      res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to search remote songs',
        message: safeMessage,
        duration: errorDuration
      })
    }
  } catch (error) {
    console.error('[search-remote] Fatal error:', error)
    next(error)
  }
}

export const getBillByRoom = async (req: Request, res: Response, next: NextFunction) => {
  const { roomId } = req.params

  try {
    const bill = await roomMusicServices.getBillByRoom(Number(roomId))
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get bill successfully',
      result: bill
    })
  } catch (error) {
    next(error)
  }
}

export const getSongsInCollection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, keyword } = req.query

    const pageNum = page ? parseInt(page as string, 10) : undefined
    const limitNum = limit ? parseInt(limit as string, 10) : undefined
    const keywordStr = keyword ? (keyword as string) : undefined

    // Validate page and limit if provided
    if (pageNum !== undefined && (isNaN(pageNum) || pageNum < 1)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Page must be a positive number'
      })
    }

    if (limitNum !== undefined && (isNaN(limitNum) || limitNum < 1 || limitNum > 100)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Limit must be between 1 and 100'
      })
    }

    const result = await roomMusicServices.getSongsInCollection({
      page: pageNum,
      limit: limitNum,
      keyword: keywordStr
    })

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get songs in collection successfully',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Delete song from collection
 * @path /room-music/songs-collection/:videoId
 * @method DELETE
 * @author QuangDoo
 */
export const deleteSong = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { videoId } = req.params

    if (!videoId) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Video ID is required'
      })
    }

    const deleted = await songService.deleteSong(videoId)

    if (!deleted) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: SONG_QUEUE_MESSAGES.SONG_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.DELETE_SONG_SUCCESS,
      result: { video_id: videoId }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Normalize existing songs to support accent-insensitive search
 * @path /room-music/songs/normalize
 * @method POST
 */
export const normalizeSongsLibrary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await songService.normalizeAllSongs()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Normalize songs successfully',
      result
    })
  } catch (error) {
    next(error)
  }
}
