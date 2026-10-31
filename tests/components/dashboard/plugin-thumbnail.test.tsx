import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ downscale: vi.fn() }))
vi.mock('@/lib/plugin-thumbnail', () => ({ downscalePluginThumbnail: mocks.downscale }))

import { PluginThumbnail, PluginThumbnailField } from '@/components/dashboard/plugin-thumbnail'

const API = '/api/plugins/owner/clock/thumbnail'

beforeEach(() => {
  mocks.downscale.mockReset()
  mocks.downscale.mockResolvedValue(new Blob(['small'], { type: 'image/webp' }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ thumbnailUrl: 'https://bucket.test/new.webp' }))))
})

describe('PluginThumbnail', () => {
  it('shows the image when there is one', () => {
    const { container } = render(<PluginThumbnail name="Clock" url="https://bucket.test/a.webp" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://bucket.test/a.webp')
  })

  it('falls back to the upper-case first letter', () => {
    render(<PluginThumbnail name="  mod clock" url={null} />)
    expect(screen.getByText('M')).toBeTruthy()
  })

  it('keeps an emoji whole and survives an empty name', () => {
    const { rerender } = render(<PluginThumbnail name="🎲 Dice" />)
    expect(screen.getByText('🎲')).toBeTruthy()
    rerender(<PluginThumbnail name="" />)
    expect(screen.getByText('?')).toBeTruthy()
  })
})

describe('PluginThumbnailField', () => {
  it('uploads a pasted image after downscaling it', async () => {
    const onChange = vi.fn()
    render(<PluginThumbnailField apiPath={API} name="Clock" url={null} onChange={onChange} />)
    const pasted = new File(['big'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [pasted] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://bucket.test/new.webp'))
    expect(mocks.downscale).toHaveBeenCalledWith(pasted)
    const [path, init] = vi.mocked(fetch).mock.calls[0]
    expect(path).toBe(API)
    expect(init?.method).toBe('POST')
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('ignores a paste without an image', () => {
    render(<PluginThumbnailField apiPath={API} name="Clock" url={null} onChange={vi.fn()} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [] } })
    expect(mocks.downscale).not.toHaveBeenCalled()
  })

  it('removes the thumbnail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ thumbnailUrl: null }))))
    const onChange = vi.fn()
    render(<PluginThumbnailField apiPath={API} name="Clock" url="https://bucket.test/a.webp" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('shows the error from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Too large' }), { status: 413 })))
    const onChange = vi.fn()
    render(<PluginThumbnailField apiPath={API} name="Clock" url={null} onChange={onChange} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Too large')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })
})
