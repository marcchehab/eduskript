import { describe, it, expect } from 'vitest'
import { parseYoutubeUrl } from '@/lib/youtube-url'

describe('parseYoutubeUrl', () => {
  it('reads start and end times', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dX9CGRZwD-w&t=154&end=306')).toEqual({
      id: 'dX9CGRZwD-w', playlist: undefined, startTime: 154, endTime: 306,
    })
  })

  it('accepts 1m30s style for end', () => {
    expect(parseYoutubeUrl('https://youtu.be/abc?end=5m6s')?.endTime).toBe(306)
  })

  it('leaves endTime undefined without end param', () => {
    expect(parseYoutubeUrl('https://youtu.be/abc?t=10')?.endTime).toBeUndefined()
  })
})
