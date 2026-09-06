export interface CreateMusicCategoryRequestBody {
  name: string
  isActive?: boolean
}

export interface UpdateMusicCategoryRequestBody {
  name?: string
  isActive?: boolean
}

export interface CategoryIdsRequestBody {
  categoryIds: string[]
}

export interface VideoIdsRequestBody {
  videoIds: string[]
}

export interface MusicCategorySongsQuery {
  page?: string
  limit?: string
  keyword?: string
}
