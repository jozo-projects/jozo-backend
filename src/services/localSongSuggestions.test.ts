import { roomMusicServices } from './roomMusic.service'
import { songService } from './song.service'

jest.mock('./redis.service', () => ({ __esModule: true, default: {} }))

describe('local song suggestions', () => {
  afterEach(() => jest.restoreAllMocks())

  it('searches the local catalog and returns up to twelve distinct titles in popularity order', async () => {
    const titles = Array.from({ length: 14 }, (_, index) => ({ title: `Bài ${index + 1}` }))
    const search = jest
      .spyOn(songService, 'searchSongs')
      .mockResolvedValue([titles[0], { title: ' bài 1 ' }, ...titles.slice(1)] as any)
    expect(await roomMusicServices.getLocalSongNames('  bài  ')).toEqual(titles.slice(0, 12).map((song) => song.title))
    expect(search).toHaveBeenCalledWith('bài', 20)
  })

  it('prioritizes karaoke titles among local matches even when less played', async () => {
    jest
      .spyOn(songService, 'searchSongs')
      .mockResolvedValue([
        { title: 'Chúng Ta Không Thuộc Về Nhau | Official Music Video' },
        { title: 'Chúng ta không thuộc về nhau - Sơn Tùng' },
        { title: 'Chúng Ta Không Thuộc Về Nhau Karaoke - Beat Gốc' },
        { title: 'Karaoke Chúng Ta Không Thuộc Về Nhau' }
      ] as any)
    expect(await roomMusicServices.getLocalSongNames('chung ta khong thuoc ve nhau', true)).toEqual([
      'Chúng Ta Không Thuộc Về Nhau Karaoke - Beat Gốc',
      'Karaoke Chúng Ta Không Thuộc Về Nhau',
      'Chúng Ta Không Thuộc Về Nhau | Official Music Video',
      'Chúng ta không thuộc về nhau - Sơn Tùng'
    ])
  })

  it('does not query the catalog for short keywords', async () => {
    const search = jest.spyOn(songService, 'searchSongs')
    expect(await roomMusicServices.getLocalSongNames('a')).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })
})
