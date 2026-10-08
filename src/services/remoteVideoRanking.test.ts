import { rankRemoteVideos } from './remoteVideoRanking'

describe('remote video ranking', () => {
  it('respects provider order when exact matches have comparable views', () => {
    const videos = [
      { video_id: 'provider-first', title: 'Tháng Năm - SOOBIN', author: 'SOOBIN', views: 1000000, is_saved: false },
      { video_id: 'slightly-higher', title: 'Tháng Năm - SOOBIN', author: 'SOOBIN', views: 1200000, is_saved: false }
    ]
    expect(rankRemoteVideos(videos, 'tháng năm music', 2).map((v) => v.video_id)).toEqual([
      'provider-first',
      'slightly-higher'
    ])
  })
  it('does not promote a different parenthesized song name as an exact match', () => {
    const videos = [
      { video_id: 'different', title: 'Tháng Năm (Không Quên)', author: 'Singer', views: 50000000, is_saved: false },
      { video_id: 'exact', title: 'Tháng Năm (Official MV)', author: 'Singer', views: 1000000, is_saved: false }
    ]
    const result = rankRemoteVideos(videos, 'tháng năm music', 2)
    expect(result[0].video_id).toBe('exact')
    expect(result[1].exact_title_match).toBe(false)
  })

  it('does not treat Tháng 5 as a full match for Tháng Năm', () => {
    const videos = [
      { video_id: 'five', title: 'Tháng 5 Không Trở Lại', author: 'Singer', views: 80000000, is_saved: false },
      { video_id: 'year', title: 'SOOBIN - Tháng Năm', author: 'SOOBIN', views: 20000000, is_saved: false }
    ]
    const ranked = rankRemoteVideos(videos, 'Tháng Năm music', 2)
    expect(ranked[0].video_id).toBe('year')
    expect(ranked[1].recall).toBeLessThan(1)
  })
  it('keeps Tháng Năm itself ahead of more viewed longer songs while retaining partial matches', () => {
    const videos = [
      { video_id: 'long', title: 'Tháng Năm Không Quên - H2K', author: 'H2K', views: 58000000, is_saved: false },
      {
        video_id: 'exact',
        title: 'SOOBIN - THÁNG NĂM (Official Music Video)',
        author: 'SOOBIN',
        views: 20000000,
        is_saved: false
      },
      { video_id: 'reversed', title: 'Năm Tháng Ấy', author: 'Singer', views: 300000, is_saved: false },
      {
        video_id: 'version',
        title: 'Tháng Năm (Lofi Ver.) - Soobin',
        author: 'Soobin',
        views: 19000000,
        is_saved: false
      },
      { video_id: 'unrelated', title: 'Cooking tutorial', author: 'Chef', views: 90000000, is_saved: false }
    ]
    const ranked = rankRemoteVideos(videos, 'tháng năm music', 5)
    expect(ranked.map((v) => v.video_id)).toEqual(['exact', 'version', 'long', 'reversed'])
  })

  it('puts the most viewed matching Dinh Menh video first and excludes irrelevant videos', () => {
    const videos = [
      { video_id: 'low', title: 'Định Mệnh official MV', author: 'Singer', views: 100, is_saved: false },
      { video_id: 'irrelevant', title: 'Cooking tutorial', author: 'Chef', views: 5000000, is_saved: false },
      { video_id: 'high', title: 'Định Mệnh official MV', author: 'Singer', views: 900000, is_saved: false }
    ]
    const scored = rankRemoteVideos(videos, 'dinh menh music', 3)
    expect(scored.map((v) => v.video_id)).toEqual(['high', 'low'])
  })

  it('does not let a more viewed different song with the same phrase outrank the exact title', () => {
    const videos = [
      {
        video_id: 'different',
        title: 'Yêu Em Là Định Mệnh - official MV',
        author: 'Singer',
        views: 4000000,
        is_saved: false
      },
      { video_id: 'exact', title: 'Định Mệnh - Song Ngọc', author: 'Singer', views: 1700000, is_saved: false }
    ]
    expect(rankRemoteVideos(videos, 'dinh menh music', 2).map((v) => v.video_id)).toEqual(['exact', 'different'])
  })

  it('puts karaoke renditions before more-viewed lyric, official and live videos for a karaoke query', () => {
    const videos = [
      {
        video_id: 'Rzm_kltwHbg',
        title: 'Chạm Khẽ Tim Anh Một Chút Thôi | Noo Phước Thịnh | LYRIC VIDEO',
        author: 'Noo Phước Thịnh',
        views: 101467022,
        is_saved: true
      },
      {
        video_id: 'zshxAlfZYAI',
        title: 'Noo Phước Thịnh - Chạm Khẽ Tim Anh Một Chút Thôi (Official Music Video)',
        author: 'Noo Phước Thịnh',
        views: 41869631,
        is_saved: true
      },
      {
        video_id: 'gU6h1qlvd4w',
        title: 'CHẠM KHẼ TIM ANH MỘT CHÚT THÔI - MYRA TRẦN live at #Lululola',
        author: 'Lululola Show',
        views: 280142,
        is_saved: false
      },
      {
        video_id: 'DdLN2ASANaY',
        title: '[Karaoke] Chạm khẽ tim anh một chút thôi - Noo Phước Thịnh',
        author: 'TÔI THÍCH HÁT',
        views: 1210808,
        is_saved: true
      },
      {
        video_id: 'TujGgOG9L60',
        title: 'Chạm Khẽ Tim Anh Một Chút Thôi Karaoke Tone Nữ',
        author: 'Top Hit Karaoke',
        views: 128692,
        is_saved: false
      }
    ]
    const result = rankRemoteVideos(videos, 'chạm khẽ tim anh một chút thôi karaoke', 5)
    expect(result.map((video) => video.video_id)).toEqual([
      'DdLN2ASANaY',
      'TujGgOG9L60',
      'Rzm_kltwHbg',
      'zshxAlfZYAI',
      'gU6h1qlvd4w'
    ])
  })

  it('does not treat a saved YouTube match as HLS or prioritize it above more views', () => {
    const videos = [
      { video_id: 'saved', title: 'Định Mệnh', author: 'Singer', views: 10, is_saved: true },
      { video_id: 'high', title: 'Định Mệnh', author: 'Singer', views: 10000, is_saved: false }
    ]
    expect(rankRemoteVideos(videos, 'dinh menh', 2).map((v) => v.video_id)).toEqual(['high', 'saved'])
  })
})
