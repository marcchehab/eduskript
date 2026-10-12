/**
 * <muxvideo> renders a plain <video> for both providers: Infomaniak rows with
 * their poster + WebVTT <track>, legacy Mux rows from stream.mux.com. With
 * preload "none" nothing but the poster is requested until the viewer
 * presses play (hls.js isn't even imported).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SkriptFilesData } from '@/lib/skript-files'

const hlsInstances: Array<{ url?: string }> = []
vi.mock('hls.js', () => {
  class Hls {
    static isSupported() { return true }
    url?: string
    constructor() { hlsInstances.push(this) }
    loadSource(url: string) { this.url = url }
    attachMedia() {}
    destroy() {}
  }
  return { default: Hls }
})

vi.mock('@/components/markdown/coupled-video-context', () => ({
  useVideoGate: () => ({ onTimeUpdate: () => {}, onManualPlay: () => {} }),
  CouplingToggle: () => null,
}))

vi.mock('@/components/markdown/stick-me', () => ({
  StickMe: ({ children }: { children: React.ReactNode }) => children,
}))

import { MuxVideo } from '@/components/markdown/mux-video'

function filesWith(provider: string, metadata: Record<string, unknown>): SkriptFilesData {
  return {
    env: 'csr',
    files: {},
    videos: { 'clip.mp4': { id: 'v1', filename: 'clip.mp4', provider, metadata } },
  }
}

describe('MuxVideo provider switch', () => {
  it('Infomaniak: poster, captions track, HLS attached only after play', async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    const files = filesWith('infomaniak', {
      status: 'ready',
      hlsUrl: 'https://play.vod2.infomaniak.com/hls/M/e/,a,.urlset/manifest.m3u8',
      poster: 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/bucket/files/p.jpg',
      captions: [{ src: 'https://api.infomaniak.com/2/vod/res/subtitles/S.vtt', lang: 'de', label: 'Deutsch' }],
    })
    const { container } = render(<MuxVideo src="clip.mp4" files={files} />)
    const video = container.querySelector('video')!
    expect(video.getAttribute('poster')).toContain('/files/p.jpg')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.getAttribute('crossorigin')).toBe('anonymous')
    const track = container.querySelector('track')!
    expect(track.getAttribute('src')).toBe('https://api.infomaniak.com/2/vod/res/subtitles/S.vtt')
    expect(track.getAttribute('srclang')).toBe('de')
    expect(hlsInstances).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }))
    await waitFor(() => expect(hlsInstances).toHaveLength(1))
    expect(hlsInstances[0].url).toBe('https://play.vod2.infomaniak.com/hls/M/e/,a,.urlset/manifest.m3u8')
  })

  it('Mux (not yet migrated): plays from stream.mux.com', async () => {
    hlsInstances.length = 0
    const files = filesWith('mux', { playbackId: 'PB', status: 'ready', poster: 'https://image.mux.com/PB/thumbnail.webp' })
    render(<MuxVideo src="clip.mp4" files={files} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }))
    await waitFor(() => expect(hlsInstances).toHaveLength(1))
    expect(hlsInstances[0].url).toBe('https://stream.mux.com/PB.m3u8')
  })

  it('gif mode loads at once, muted, looping, without controls', async () => {
    hlsInstances.length = 0
    const files = filesWith('infomaniak', { status: 'ready', hlsUrl: 'https://play.vod2.infomaniak.com/hls/G/x.m3u8' })
    const { container } = render(<MuxVideo src="clip.mp4" files={files} gif />)
    const video = container.querySelector('video')!
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.controls).toBe(false)
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull()
    await waitFor(() => expect(hlsInstances).toHaveLength(1))
  })

  it('shows a processing placeholder for an upload that is not ready yet', () => {
    render(<MuxVideo src="clip.mp4" files={filesWith('infomaniak', { status: 'processing', mediaId: 'M' })} />)
    expect(screen.getByText(/still processing/)).toBeTruthy()
  })
})
