'use client'

import { useState } from 'react'
import { Film, Copy, Check, Search, Plus, X, Loader2, Link, Upload, AlertCircle, Trash2 } from 'lucide-react'
import type { VideoInfo } from '@/lib/skript-files'
import { VideoUploadModal } from './video-upload-modal'

interface VideoBrowserProps {
  videos: VideoInfo[]
  loading: boolean
  className?: string
  isAdmin?: boolean
  onVideoAdded?: () => void
  onUploadComplete?: () => void
  // Skript to associate uploaded videos with via SkriptVideos.
  skriptId?: string
}

export function VideoBrowser({ videos, loading, className, isAdmin, onVideoAdded, onUploadComplete, skriptId }: VideoBrowserProps) {
  const [query, setQuery] = useState('')
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null)
  const [copiedPlaybackId, setCopiedPlaybackId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [addFilename, setAddFilename] = useState('')
  const [addPlaybackId, setAddPlaybackId] = useState('')
  const [addAspectRatio, setAddAspectRatio] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filtered = query.trim()
    ? videos.filter(v => v.filename.toLowerCase().includes(query.toLowerCase()))
    : videos

  const handleCopyFilename = async (filename: string) => {
    try {
      await navigator.clipboard.writeText(filename)
      setCopiedFilename(filename)
      setTimeout(() => setCopiedFilename(null), 1500)
    } catch {
      // clipboard not available, silently ignore
    }
  }

  const handleCopyPlaybackId = async (playbackId: string) => {
    try {
      await navigator.clipboard.writeText(playbackId)
      setCopiedPlaybackId(playbackId)
      setTimeout(() => setCopiedPlaybackId(null), 1500)
    } catch {
      // clipboard not available, silently ignore
    }
  }

  const handleDragStart = (e: React.DragEvent, video: VideoInfo) => {
    // Don't allow dragging non-ready videos
    const status = video.metadata.status
    if (status && status !== 'ready') {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('application/Eduskript-mux-video', JSON.stringify(video))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleAddVideo = async () => {
    if (!addFilename.trim() || !addPlaybackId.trim()) {
      setAddError('Filename and Playback ID are required')
      return
    }

    setAdding(true)
    setAddError('')

    try {
      const res = await fetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: addFilename.trim(),
          playbackId: addPlaybackId.trim(),
          aspectRatio: addAspectRatio.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setAddError(data.error || 'Failed to add video')
        return
      }

      // Reset form and refresh
      setAddFilename('')
      setAddPlaybackId('')
      setAddAspectRatio('')
      setShowAddForm(false)
      onVideoAdded?.()
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (video: VideoInfo) => {
    if (!confirm(`Delete "${video.filename}" from the database?`)) return

    setDeletingId(video.id)
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to delete video')
        return
      }
      onVideoAdded?.() // triggers refresh
    } catch {
      alert('Network error')
    } finally {
      setDeletingId(null)
    }
  }

  const getStatusIndicator = (video: VideoInfo) => {
    const status = video.metadata.status
    if (!status || status === 'ready') return null

    if (status === 'waiting' || status === 'processing') {
      return (
        <span className="flex-shrink-0" title={`Video is ${status}`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </span>
      )
    }

    if (status === 'errored') {
      return (
        <span className="flex-shrink-0" title="Video processing failed">
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
        </span>
      )
    }

    return null
  }

  if (loading) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  if (videos.length === 0 && !isAdmin) {
    return (
      <div className={`p-4 text-center text-sm text-muted-foreground ${className}`}>
        <Film className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>No videos available.</p>
        <p className="mt-1 text-xs">Click the upload button to add a video.</p>
        <button
          onClick={() => setShowUploadModal(true)}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload Video
        </button>
        <VideoUploadModal
          open={showUploadModal}
          onOpenChange={setShowUploadModal}
          onUploadComplete={onUploadComplete}
          skriptId={skriptId}
        />
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Search + Upload + Admin Add buttons */}
      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter videos…"
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* Upload button for all teachers */}
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex-shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Upload video"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        {/* Admin manual add form toggle */}
        {isAdmin && (
          <button
            onClick={() => setShowAddForm(f => !f)}
            className="flex-shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Add video entry manually"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Add video form (admin only) */}
      {isAdmin && showAddForm && (
        <div className="mx-2 mb-1 p-2 rounded-md border border-border bg-muted/50 space-y-1.5">
          <input
            type="text"
            value={addFilename}
            onChange={e => setAddFilename(e.target.value)}
            placeholder="Filename (e.g. lecture.mp4)"
            className="w-full text-xs rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            value={addPlaybackId}
            onChange={e => setAddPlaybackId(e.target.value)}
            placeholder="Mux Playback ID"
            className="w-full text-xs rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            value={addAspectRatio}
            onChange={e => setAddAspectRatio(e.target.value)}
            placeholder="Aspect ratio (optional, e.g. 1.778)"
            className="w-full text-xs rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
          />
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          <button
            onClick={handleAddVideo}
            disabled={adding}
            className="w-full text-xs rounded bg-primary text-primary-foreground px-2 py-1.5 hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {adding && <Loader2 className="w-3 h-3 animate-spin" />}
            Add Video
          </button>
        </div>
      )}

      {/* Scrollable list */}
      {videos.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground">
          <Film className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No videos yet.</p>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-64 p-1 space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No matches</p>
          ) : (
            filtered.map(video => {
              const status = video.metadata.status
              const isReady = !status || status === 'ready'
              return (
                <div
                  key={video.filename}
                  draggable={isReady}
                  onDragStart={e => handleDragStart(e, video)}
                  className={`group flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted transition-colors ${
                    isReady ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-60'
                  }`}
                  title={isReady ? `Drag to insert ${video.filename}` : `Video is ${status}`}
                >
                  {/* Poster or fallback */}
                  {video.metadata.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.metadata.poster}
                      alt=""
                      className="w-12 h-8 object-cover rounded flex-shrink-0 bg-muted"
                    />
                  ) : (
                    <div className="w-12 h-8 flex items-center justify-center rounded flex-shrink-0 bg-muted">
                      <Film className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}

                  <span className="flex-1 min-w-0 truncate font-medium text-xs">{video.filename}</span>

                  {/* Status indicator for non-ready videos */}
                  {getStatusIndicator(video)}

                  {isReady && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                      {video.provider}
                    </span>
                  )}

                  {/* Copy playback ID button */}
                  {video.metadata.playbackId && (
                    <button
                      onClick={e => { e.stopPropagation(); handleCopyPlaybackId(video.metadata.playbackId!) }}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                      title="Copy Mux Playback ID"
                    >
                      {copiedPlaybackId === video.metadata.playbackId ? (
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      ) : (
                        <Link className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  )}

                  {/* Copy filename button */}
                  <button
                    onClick={e => { e.stopPropagation(); handleCopyFilename(video.filename) }}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                    title="Copy filename to clipboard"
                  >
                    {copiedFilename === video.filename ? (
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(video) }}
                    disabled={deletingId === video.id}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                    title="Delete video entry"
                  >
                    {deletingId === video.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      <p className="px-3 py-1.5 text-xs text-muted-foreground border-t">
        Drag a video into the editor to insert it
      </p>

      <VideoUploadModal
        open={showUploadModal}
        onOpenChange={setShowUploadModal}
        onUploadComplete={onUploadComplete}
        skriptId={skriptId}
      />
    </div>
  )
}
