'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { Camera, ExternalLink, X, Trash2, ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SnapWithPageInfo } from '@/app/api/user-data/snaps/route'

export default function MySnapsPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [snaps, setSnaps] = useState<SnapWithPageInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSnapIndex, setExpandedSnapIndex] = useState<number | null>(null)
  const [lastViewedIndex, setLastViewedIndex] = useState<number | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [deletingSnap, setDeletingSnap] = useState<SnapWithPageInfo | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const expandedSnap = expandedSnapIndex !== null ? snaps[expandedSnapIndex] : null

  const goToPrevSnap = () => {
    if (expandedSnapIndex !== null && expandedSnapIndex > 0) {
      setExpandedSnapIndex(expandedSnapIndex - 1)
      setZoomLevel(1)
    }
  }

  const goToNextSnap = () => {
    if (expandedSnapIndex !== null && expandedSnapIndex < snaps.length - 1) {
      setExpandedSnapIndex(expandedSnapIndex + 1)
      setZoomLevel(1)
    }
  }

  const closeOverlay = () => {
    setLastViewedIndex(expandedSnapIndex)
    setExpandedSnapIndex(null)
    setZoomLevel(1)
  }

  // Keyboard navigation for overlay
  useEffect(() => {
    if (expandedSnapIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeOverlay()
      } else if (e.key === 'ArrowLeft') {
        goToPrevSnap()
      } else if (e.key === 'ArrowRight') {
        goToNextSnap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedSnapIndex, snaps.length])

  useEffect(() => {
    if (status === 'loading') return

    if (!session) {
      router.push('/auth/signin')
      return
    }

    loadSnaps()
  }, [session, status, router])

  const loadSnaps = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/user-data/snaps')

      if (!response.ok) {
        throw new Error('Failed to load snaps')
      }

      const data = await response.json()
      setSnaps(data.snaps)
    } catch (error) {
      console.error('Error loading snaps:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSnap = async () => {
    if (!deletingSnap) return

    try {
      setIsDeleting(true)

      // Fetch current snaps data for this page
      const response = await fetch(
        `/api/user-data/snaps/${encodeURIComponent(deletingSnap.pageId)}`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch snap data')
      }

      const data = await response.json()
      const currentSnaps = data.data?.snaps || []

      // Remove the snap from the list
      const updatedSnaps = currentSnaps.filter(
        (s: { id: string }) => s.id !== deletingSnap.id
      )

      // Save updated snaps
      const saveResponse = await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              adapter: 'snaps',
              itemId: deletingSnap.pageId,
              data: { snaps: updatedSnaps },
              version: (data.version || 0) + 1,
            },
          ],
        }),
      })

      if (!saveResponse.ok) {
        throw new Error('Failed to delete snap')
      }

      // Remove from local state
      setSnaps((prev) => prev.filter((s) => s.id !== deletingSnap.id))
      setDeletingSnap(null)
    } catch (error) {
      console.error('Error deleting snap:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const buildPageUrl = (snap: SnapWithPageInfo): string | null => {
    if (!snap.authorPageSlug || !snap.skriptSlug || !snap.pageSlug) {
      return null
    }

    if (snap.collectionSlug) {
      return `/${snap.authorPageSlug}/${snap.collectionSlug}/${snap.skriptSlug}/${snap.pageSlug}`
    }

    // Skript at root level (no collection)
    return `/${snap.authorPageSlug}/${snap.skriptSlug}/${snap.pageSlug}`
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-6xl mx-auto">
          <p>Loading your snaps...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">My Snaps</h1>
          <p className="text-muted-foreground mt-1">
            Screenshots you&apos;ve taken while studying
          </p>
        </div>

        {snaps.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Camera className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No snaps yet</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Take snaps while reading to save important content. Use the snap
                tool in the annotation toolbar when viewing any page.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {snaps.map((snap, index) => {
              const pageUrl = buildPageUrl(snap)
              const isCurrentlyViewed = expandedSnapIndex !== null ? expandedSnapIndex === index : lastViewedIndex === index

              return (
                <Card
                  key={`${snap.pageId}-${snap.id}`}
                  className={`overflow-hidden group transition-colors ${isCurrentlyViewed ? 'ring-2 ring-primary' : ''}`}
                >
                  {/* Image */}
                  <div
                    className="relative aspect-video cursor-pointer overflow-hidden border-b"
                    onClick={() => setExpandedSnapIndex(index)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={snap.imageUrl}
                      alt={snap.name}
                      className="w-full h-full object-contain transition-transform group-hover:scale-105"
                    />
                    {/* Delete button overlay */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingSnap(snap)
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-background/80 backdrop-blur border border-border rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                      title="Delete snap"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Info */}
                  <CardContent className="p-3">
                    <div className="space-y-1">
                      <h3 className="font-medium text-sm truncate">
                        {snap.name}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">
                        {snap.pageTitle}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(snap.createdAt)}
                        </span>
                        {pageUrl && (
                          <Link
                            href={pageUrl}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            title={`Go to ${snap.pageTitle}`}
                          >
                            View page
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Expanded snap modal */}
        {expandedSnap && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={closeOverlay}
          >
            {/* Top bar with controls */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
              {/* Info - left */}
              <div className="bg-background/80 backdrop-blur rounded-lg px-4 py-2">
                <h3 className="font-semibold text-foreground">
                  {expandedSnap.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {expandedSnap.pageTitle} • {expandedSnapIndex! + 1} / {snaps.length}
                </p>
              </div>

              {/* Controls - right */}
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.max(0.25, z - 0.25)) }}
                  className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <span className="bg-background/80 backdrop-blur rounded-lg px-3 py-1 text-sm min-w-[4rem] text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setZoomLevel(z => Math.min(4, z + 0.25)) }}
                  className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <a
                  href={expandedSnap.imageUrl}
                  download={`${expandedSnap.name}.jpg`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
                  title="Download"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button
                  onClick={closeOverlay}
                  className="p-2 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Previous button - left side */}
            {expandedSnapIndex! > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); goToPrevSnap() }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors z-10"
                title="Previous (←)"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Next button - right side */}
            {expandedSnapIndex! < snaps.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); goToNextSnap() }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-background/80 backdrop-blur hover:bg-background rounded-full transition-colors z-10"
                title="Next (→)"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

            {/* View page button - bottom left */}
            {buildPageUrl(expandedSnap) && (
              <div className="absolute bottom-4 left-4 z-10">
                <Button variant="secondary" size="sm" asChild>
                  <Link href={buildPageUrl(expandedSnap)!}>
                    <ExternalLink className="w-4 h-4 mr-1" />
                    View page
                  </Link>
                </Button>
              </div>
            )}

            {/* Dimensions - bottom right */}
            <div className="absolute bottom-4 right-4 bg-background/80 backdrop-blur rounded-lg px-3 py-1 text-sm text-muted-foreground z-10">
              {Math.round(expandedSnap.width)} x {Math.round(expandedSnap.height)} • {formatDate(expandedSnap.createdAt)}
            </div>

            {/* Image - fills available space */}
            <div
              className="w-full h-full flex items-center justify-center p-4 overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={expandedSnap.imageUrl}
                alt={expandedSnap.name}
                className="object-contain transition-transform duration-200"
                style={{ transform: `scale(${zoomLevel})`, minWidth: '50vw', maxWidth: zoomLevel <= 1 ? '100%' : 'none', maxHeight: zoomLevel <= 1 ? '100%' : 'none' }}
                onClick={closeOverlay}
              />
            </div>
          </div>
        )}

        {/* Delete confirmation dialog */}
        <AlertDialogModal
          open={!!deletingSnap}
          onOpenChange={(open: boolean) => !open && setDeletingSnap(null)}
          type="warning"
          title="Delete snap?"
          message={`Are you sure you want to delete "${deletingSnap?.name}"? This action cannot be undone.`}
          showCancel
          cancelText="Cancel"
          confirmText={isDeleting ? 'Deleting...' : 'Delete'}
          onConfirm={handleDeleteSnap}
        />
      </div>
    </div>
  )
}
