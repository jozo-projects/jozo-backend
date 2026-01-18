/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from 'express'
import { type ParamsDictionary } from 'express-serve-static-core'
import ytSearch from 'yt-search'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { SONG_QUEUE_MESSAGES } from '~/constants/messages'
import { AddSongRequestBody } from '~/models/requests/Song.request'
import { VideoSchema } from '~/models/schemas/Video.schema'
import redis from '~/services/redis.service'
import { roomMusicServices } from '~/services/roomMusic.service'
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
 * @path /song-queue/rooms/:roomId/search-songs
 * @method GET
 * @author QuangDoo
 */
export const searchSongs = async (req: Request, res: Response) => {
  const { q, limit = '30' } = req.query
  const parsedLimit = parseInt(limit as string, 10)

  // Validate search query
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid search query' })
  }

  // Validate limit parameter - Giảm limit tối đa để tăng tốc độ
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 50' })
  }

  // Tạo một Promise với built-in timeout trong 3 giây
  try {
    let searchPromiseResolved = false

    // Phương pháp 1: ytSearch với tham số đơn giản
    const searchOptions = {
      query: q,
      pageStart: 1,
      pageEnd: 1,
      limit: parsedLimit
    }

    console.log('Starting search with query:', q)

    // Cài đặt timeout hẹp để tránh chờ quá lâu
    // eslint-disable-next-line no-async-promise-executor
    const searchPromise = new Promise<any[]>(async (resolve) => {
      try {
        // Dùng timeout tránh trường hợp ytSearch bị treo
        setTimeout(() => {
          if (!searchPromiseResolved) {
            console.log('Search timeout, returning empty results')
            resolve([])
            searchPromiseResolved = true
          }
        }, 3000)

        // Thực hiện tìm kiếm
        const result = await ytSearch(searchOptions)

        if (!searchPromiseResolved) {
          console.log('Search completed successfully, found videos:', result.videos.length)

          // Map kết quả thành video schema
          const videos = result.videos
            .filter((video) => video.seconds >= 30)
            .slice(0, parsedLimit)
            .map(
              (video) =>
                new VideoSchema({
                  video_id: video.videoId,
                  title: video.title,
                  duration: video.seconds,
                  url: video.url,
                  thumbnail: video.thumbnail || '',
                  author: video.author.name
                })
            )

          resolve(videos)
          searchPromiseResolved = true
        }
      } catch (error) {
        console.error('Error in ytSearch:', error)
        if (!searchPromiseResolved) {
          resolve([])
          searchPromiseResolved = true
        }
      }
    })

    const videos = await searchPromise

    console.log('Returning videos count:', videos.length)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
      result: videos
    })
  } catch (error) {
    console.error('Search error:', error)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: SONG_QUEUE_MESSAGES.SEARCH_SONGS_SUCCESS,
      result: [] // Trả về mảng rỗng trong trường hợp lỗi
    })
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
