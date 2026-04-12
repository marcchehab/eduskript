import { describe, it, expect } from 'vitest'
import {
  extractReferencedFilenames,
  extractReferencedVideoFilenames,
} from '@/lib/extract-file-references'

describe('extractReferencedFilenames', () => {
  it('skips video refs (they live in the Video table)', () => {
    const md = '![demo](lecture.mp4)\n![shot](photo.png)\n![clip](demo.mov)'
    expect(extractReferencedFilenames(md)).toEqual(['photo.png'])
  })
})

describe('extractReferencedVideoFilenames', () => {
  it('captures .mp4 and .mov image-syntax refs', () => {
    const md = '![](intro.mp4)\n![clip](bonus.mov)'
    expect(extractReferencedVideoFilenames(md).sort()).toEqual([
      'bonus.mov',
      'intro.mp4',
    ])
  })

  it('skips absolute URLs', () => {
    const md =
      '![](https://example.com/foo.mp4)\n![](/public/bar.mov)\n![](local.mp4)'
    expect(extractReferencedVideoFilenames(md)).toEqual(['local.mp4'])
  })

  it('ignores non-video refs', () => {
    const md = '![](image.png)\n![](doc.pdf)\n![](data.db)'
    expect(extractReferencedVideoFilenames(md)).toEqual([])
  })

  it('dedupes repeated video refs', () => {
    const md = '![a](same.mp4)\n![b](same.mp4)'
    expect(extractReferencedVideoFilenames(md)).toEqual(['same.mp4'])
  })

  it('is case-insensitive for the extension', () => {
    const md = '![](UPPER.MP4)'
    expect(extractReferencedVideoFilenames(md)).toEqual(['UPPER.MP4'])
  })
})
