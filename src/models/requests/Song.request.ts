export interface AddSongRequestBody {
  video_id: string
  title: string
  thumbnail: string
  author: string
  url?: string
  position?: 'top' | 'end'
  duration?: number
  // Thêm các trường mới cho HLS support
  format_type?: 'hls' | 'progressive'
  headers?: Record<string, string>
  required_headers?: Record<string, string>
}

export interface MoveQueueRequestBody {
  targetRoomId: string
}
