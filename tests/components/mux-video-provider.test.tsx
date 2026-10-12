/**
 * <muxvideo> renders a <video> + custom controls for both providers: self-hosted
 * rows with their poster + WebVTT <track>, legacy Mux rows from stream.mux.com. With
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
    static Events = { MANIFEST_PARSED: 'hlsManifestParsed', LEVEL_SWITCHED: 'hlsLevelSwitched' }
    url?: string
    levels = []
    constructor() { hlsInstances.push(this) }
    on() {}
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
  it('Self-hosted: poster, captions track, HLS attached only after play, custom controls', async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    const files = filesWith('self', {
      status: 'ready',
      hlsUrl: 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/bucket/videos/u/master.m3u8',
      poster: 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/bucket/videos/u/poster.jpg',
      captions: [{ src: 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/bucket/videos/u/captions.de.vtt', lang: 'de', label: 'Deutsch (auto)' }],
      thumbnailsVtt: 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/bucket/videos/u/thumbs/thumbnails.vtt',
    })
    const { container } = render(<MuxVideo src="clip.mp4" files={files} />)
    const video = container.querySelector('video')!
    expect(video.getAttribute('poster')).toContain('/videos/u/poster.jpg')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.getAttribute('crossorigin')).toBe('anonymous')
    const track = container.querySelector('track')!
    expect(track.getAttribute('src')).toContain('/videos/u/captions.de.vtt')
    expect(track.getAttribute('srclang')).toBe('de')
    expect(hlsInstances).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }))
    await waitFor(() => expect(hlsInstances).toHaveLength(1))
    expect(hlsInstances[0].url).toContain('/videos/u/master.m3u8')
    // custom controls appear once activated
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
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
    const files = filesWith('self', { status: 'ready', hlsUrl: 'https://s3.example/videos/g/master.m3u8' })
    const { container } = render(<MuxVideo src="clip.mp4" files={files} gif />)
    const video = container.querySelector('video')!
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.controls).toBe(false)
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    await waitFor(() => expect(hlsInstances).toHaveLength(1))
  })

  it('shows a processing placeholder for an upload that is not ready yet', () => {
    render(<MuxVideo src="clip.mp4" files={filesWith('self', { status: 'encoding', progress: 0.3 })} />)
    expect(screen.getByText(/still processing/)).toBeTruthy()
  })
})
