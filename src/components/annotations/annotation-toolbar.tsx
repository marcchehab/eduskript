'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pen, Eraser, Trash2, Eye, EyeOff, Radio, User, Users, UserPen, ChevronDown, Globe, Layers, Camera, Highlighter, Ellipsis, SeparatorHorizontal, StickyNote as StickyNoteIcon } from 'lucide-react'
import type { SpacerPattern } from '@/types/spacer'
import { Circle } from '@uiw/react-color'
import { cn } from '@/lib/utils'
import { useLayout } from '@/contexts/layout-context'
import { createLogger } from '@/lib/logger'

const log = createLogger('annotations:toolbar')

// =============================================================================
// TYPES
// =============================================================================

// Types for broadcast controls
export interface ClassOption {
  id: string
  name: string
  hasAnnotationsOnPage?: boolean
}

export interface StudentOption {
  id: string
  displayName: string
  pseudonym?: string
  hasAnnotationsOnPage?: boolean
}

export type BroadcastMode = 'personal' | 'class' | 'student' | 'page'

// Inline SVG brush icons - use currentColor for automatic light/dark mode support
// Paths extracted from brush_thick.svg and brush_thin.svg with transforms applied
function BrushThickIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 95.1 55.3"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m 5.28,37.02 c -8.35,-6.1 5.09,-22.53 18.72,-22.1 20.18,0.63 32.97,26.23 53.83,21.66 5.7,-1.25 10.45,-4.36 13.6,-6.76 -10.15,10.24 -19.28,11.66 -25.65,11.64 -15.84,-0.04 -28.81,-10.07 -39.55,-10.07 -6.54,0 -15.92,9.3 -20.95,5.63 z" />
    </svg>
  )
}

function BrushThinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 95.1 55.3"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m 176.44,128.54 c -1.61,-2.99 11.93,-12.25 22.02,-12.14 17.74,0.58 33.83,14.77 50.55,14.55 4.74,-0.22 11.01,-1.9 18.49,-8.11 -10.3,9.54 -18.15,9.77 -23.17,9.75 -9.22,-0.04 -33.96,-11.68 -46.1,-11.89 -11.13,-0.19 -20.17,10.83 -21.79,7.84 z" transform="translate(-174.16,-95.58)" />
    </svg>
  )
}

// Small brush indicator for showing annotation status (uses thick brush path)
function BrushIndicator({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 95.1 55.3"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m 5.28,37.02 c -8.35,-6.1 5.09,-22.53 18.72,-22.1 20.18,0.63 32.97,26.23 53.83,21.66 5.7,-1.25 10.45,-4.36 13.6,-6.76 -10.15,10.24 -19.28,11.66 -25.65,11.64 -15.84,-0.04 -28.81,-10.07 -39.55,-10.07 -6.54,0 -15.92,9.3 -20.95,5.63 z" />
    </svg>
  )
}

// =============================================================================
// TOOLBAR SECTION WRAPPER - provides consistent styling for each section
// =============================================================================

function ToolbarSection({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {children}
    </div>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-border mx-1" />
}

export type AnnotationMode = 'view' | 'draw' | 'erase' | 'spacer'

export interface AnnotationLayer {
  id: string
  label: string
  color: string // border color class like 'border-gray-500'
  visible: boolean
  hasContent: boolean
  isActive: boolean // true for the layer being edited
  canDelete: boolean // true if this layer can be cleared
}

interface AnnotationToolbarProps {
  mode: AnnotationMode
  onModeChange: (mode: AnnotationMode) => void
  onClear: () => void
  hasAnnotations: boolean
  activePen: number
  onPenChange: (penIndex: number) => void
  penColors: [string, string, string]
  onPenColorChange: (penIndex: number, color: string) => void
  penSizes: [number, number, number]
  onPenSizeChange: (penIndex: number, size: number) => void
  onResetZoom: () => void
  // Layers (for students - broadcasted teacher annotations)
  layers?: AnnotationLayer[]
  onLayerToggle?: (layerId: string) => void
  onLayerDelete?: (layerId: string) => void
  // Layer badges visibility (controlled by layers dropdown hover)
  showLayerBadges?: boolean
  onShowLayerBadgesChange?: (show: boolean) => void
  // My annotations controls
  myAnnotationsVisible?: boolean
  myAnnotationsActive?: boolean // True when this is the layer we're drawing to
  onMyAnnotationsToggle?: () => void
  onMyAnnotationsDelete?: () => void
  // Broadcast controls (teachers only)
  isTeacher?: boolean
  // Page author broadcast (public annotations for all visitors)
  isPageAuthor?: boolean
  broadcastToPage?: boolean
  onBroadcastToPageChange?: (value: boolean) => void
  hasPageBroadcastAnnotations?: boolean
  onPageBroadcastDelete?: () => void
  pageBroadcastVisible?: boolean
  onPageBroadcastToggle?: () => void
  // For teachers: visibility/delete of broadcast layers
  classBroadcastVisible?: boolean
  onClassBroadcastToggle?: () => void
  onClassBroadcastDelete?: () => void
  hasClassBroadcastAnnotations?: boolean
  studentFeedbackVisible?: boolean
  onStudentFeedbackToggle?: () => void
  onStudentFeedbackDelete?: () => void
  hasStudentFeedbackAnnotations?: boolean
  classes?: ClassOption[]
  selectedClass?: ClassOption | null
  onClassSelect?: (classData: ClassOption | null) => void
  students?: StudentOption[]
  selectedStudent?: StudentOption | null
  onStudentSelect?: (student: StudentOption | null) => void
  // Last selected student for quick-access (managed by parent)
  lastSelectedStudent?: StudentOption | null
  onClearLastSelectedStudent?: () => void
  // Spacer controls
  spacerPattern?: SpacerPattern
  onSpacerPatternChange?: (pattern: SpacerPattern) => void
  spacerDeleteAnnotations?: boolean
  onSpacerDeleteAnnotationsChange?: (value: boolean) => void
  // Sticky notes controls
  stickyNotePlacementMode?: boolean
  onStickyNotePlacementToggle?: () => void
  stickyNoteCount?: number
}

export function AnnotationToolbar({
  mode,
  onModeChange,
  onClear,
  hasAnnotations,
  activePen,
  onPenChange,
  penColors,
  onPenColorChange,
  penSizes,
  onPenSizeChange,
  onResetZoom,
  layers = [],
  onLayerToggle,
  onLayerDelete,
  // Layer badges visibility
  showLayerBadges = false,
  onShowLayerBadgesChange,
  // My annotations
  myAnnotationsVisible = true,
  myAnnotationsActive = true,
  onMyAnnotationsToggle,
  onMyAnnotationsDelete,
  // Broadcast controls
  isTeacher = false,
  // Page author broadcast
  isPageAuthor = false,
  broadcastToPage = false,
  onBroadcastToPageChange,
  hasPageBroadcastAnnotations = false,
  onPageBroadcastDelete,
  pageBroadcastVisible = true,
  onPageBroadcastToggle,
  // Class broadcast
  classBroadcastVisible = true,
  onClassBroadcastToggle,
  onClassBroadcastDelete,
  hasClassBroadcastAnnotations = false,
  studentFeedbackVisible = true,
  onStudentFeedbackToggle,
  onStudentFeedbackDelete,
  hasStudentFeedbackAnnotations = false,
  classes = [],
  selectedClass = null,
  onClassSelect,
  students = [],
  selectedStudent = null,
  onStudentSelect,
  lastSelectedStudent = null,
  onClearLastSelectedStudent,
  spacerPattern = 'blank',
  onSpacerPatternChange,
  spacerDeleteAnnotations = true,
  onSpacerDeleteAnnotationsChange,
  stickyNotePlacementMode = false,
  onStickyNotePlacementToggle,
  stickyNoteCount = 0,
}: AnnotationToolbarProps) {
  // Get layout context for centering toolbar on page content (not viewport)
  const { sidebarWidth } = useLayout()

  // Broadcast dropdown state
  const [showClassDropdown, setShowClassDropdown] = useState(false)
  const [showStudentDropdown, setShowStudentDropdown] = useState(false)
  const classDropdownRef = useRef<HTMLDivElement>(null)
  const studentDropdownRef = useRef<HTMLDivElement>(null)

  // Layers dropdown state
  const [showLayersDropdown, setShowLayersDropdown] = useState(false)
  const layersDropdownRef = useRef<HTMLDivElement>(null)

  // My annotations button state (for delete popup)
  const [showMyAnnotationsPopup, setShowMyAnnotationsPopup] = useState(false)
  const myAnnotationsRef = useRef<HTMLDivElement>(null)
  const myAnnotationsHoverTimer = useRef<NodeJS.Timeout | null>(null)
  const myAnnotationsHideTimer = useRef<NodeJS.Timeout | null>(null)
  const myAnnotationsLongPressTimer = useRef<NodeJS.Timeout | null>(null)
  // Save confirm preference to localStorage
  const handleToggleConfirm = (value: boolean) => {
    setConfirmBeforeDelete(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-confirm-delete', value.toString())
    }
  }

  const handleColorChange = (penIndex: number, color: string) => {
    onPenColorChange(penIndex, color)
    onPenChange(penIndex)
    if (mode !== 'draw') {
      onModeChange('draw')
    }
  }

  const handleSizeChange = (penIndex: number, size: number) => {
    onPenSizeChange(penIndex, size)
    onPenChange(penIndex)
    if (mode !== 'draw') {
      onModeChange('draw')
    }
  }

  const [showPenControls, setShowPenControls] = useState<number | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressStartPos = useRef<{ x: number; y: number } | null>(null)

  const [showDeleteControls, setShowDeleteControls] = useState(false)
  const deleteHoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const deleteHideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const deleteLongPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const deleteLongPressStartPos = useRef<{ x: number; y: number } | null>(null)

  const [confirmBeforeDelete, setConfirmBeforeDelete] = useState<boolean>(() => {
    // Load preference from localStorage - default is false (no popup)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('annotation-confirm-delete')
      if (saved !== null) {
        return saved === 'true'
      }
    }
    return false
  })

  // "More tools" popover state
  const [showMoreTools, setShowMoreTools] = useState(false)
  const moreToolsRef = useRef<HTMLDivElement>(null)

  // Spacer pattern picker state (hover/long-press popover, same pattern as pen)
  const [showSpacerPicker, setShowSpacerPicker] = useState(false)
  const spacerHoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const spacerHideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const spacerLongPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const spacerLongPressStartPos = useRef<{ x: number; y: number } | null>(null)
  const spacerPopoverRef = useRef<HTMLDivElement>(null)

  // Ref for the popover elements to detect clicks outside
  const penPopoverRef = useRef<HTMLDivElement>(null)
  const deletePopoverRef = useRef<HTMLDivElement>(null)

  // Close popovers when stylus touches paper or when clicking outside
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element

      // Close all popovers on stylus input on paper/canvas (user wants to draw)
      if (e.pointerType === 'pen') {
        // Only close if touching paper/canvas area, not the toolbar
        const isOnToolbar = target.closest('[data-annotation-toolbar]')
        if (!isOnToolbar) {
          setShowPenControls(null)
          setShowDeleteControls(false)
        }
        return
      }

      // For touch/mouse, close if clicking outside the popover and toolbar
      const isInsideToolbar = target.closest('[data-annotation-toolbar]')
      if (isInsideToolbar) return // Don't close for any toolbar interaction

      // Clicking outside toolbar closes all popovers
      if (showPenControls !== null) {
        setShowPenControls(null)
      }
      if (showDeleteControls) {
        setShowDeleteControls(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [showPenControls, showDeleteControls])

  const handlePenMouseEnter = (penIndex: number) => {
    // Clear any pending hide timer
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    // Set timer to show pen controls
    hoverTimerRef.current = setTimeout(() => {
      setShowPenControls(penIndex)
    }, 300)
  }

  const handlePenMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // If pen controls are showing, delay hiding them to give user time to move into them
    if (showPenControls !== null) {
      hideTimerRef.current = setTimeout(() => {
        setShowPenControls(null)
      }, 200)
    }
  }

  const handlePenClick = (penIndex: number) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setShowPenControls(null)

    // If clicking the currently active pen, deactivate it
    if (mode === 'draw' && activePen === penIndex) {
      onModeChange('view')
    } else {
      // Switch to this pen and enter draw mode
      onPenChange(penIndex)
      if (mode !== 'draw') {
        onModeChange('draw')
      }
    }
  }

  // Long-press handlers for pen tools (stylus/touch support)
  const handlePenPointerDown = (e: React.PointerEvent, penIndex: number) => {
    // Only handle touch/pen, not mouse (mouse uses hover)
    if (e.pointerType === 'mouse') return

    // Prevent default to avoid text selection on long-press (iOS Safari)
    e.preventDefault()

    longPressStartPos.current = { x: e.clientX, y: e.clientY }
    longPressTimerRef.current = setTimeout(() => {
      setShowPenControls(penIndex)
      // Also select this pen when opening its config
      onPenChange(penIndex)
      if (mode !== 'draw') {
        onModeChange('draw')
      }
      longPressTimerRef.current = null
    }, 500)
  }

  const handlePenPointerMove = (e: React.PointerEvent) => {
    if (!longPressStartPos.current || !longPressTimerRef.current) return

    const dx = e.clientX - longPressStartPos.current.x
    const dy = e.clientY - longPressStartPos.current.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    // Cancel long-press if moved more than 10px
    if (distance > 10) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
      longPressStartPos.current = null
    }
  }

  const handlePenPointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartPos.current = null
  }

  const handleEraserClick = () => {
    onModeChange(mode === 'erase' ? 'view' : 'erase')
  }

  const handleDeleteMouseEnter = () => {
    // Clear any pending hide timer
    if (deleteHideTimerRef.current) {
      clearTimeout(deleteHideTimerRef.current)
      deleteHideTimerRef.current = null
    }

    // Set timer to show delete controls
    deleteHoverTimerRef.current = setTimeout(() => {
      setShowDeleteControls(true)
    }, 300)
  }

  const handleDeleteMouseLeave = () => {
    if (deleteHoverTimerRef.current) {
      clearTimeout(deleteHoverTimerRef.current)
      deleteHoverTimerRef.current = null
    }

    // If delete controls are showing, delay hiding them
    if (showDeleteControls) {
      deleteHideTimerRef.current = setTimeout(() => {
        setShowDeleteControls(false)
      }, 200)
    }
  }

  const handleDeleteClick = () => {
    if (deleteHoverTimerRef.current) {
      clearTimeout(deleteHoverTimerRef.current)
      deleteHoverTimerRef.current = null
    }
    setShowDeleteControls(false)

    if (confirmBeforeDelete) {
      if (confirm('Clear all annotations on this page?')) {
        onClear()
      }
    } else {
      onClear()
    }
  }

  // Long-press handlers for delete button (stylus/touch support)
  const handleDeletePointerDown = (e: React.PointerEvent) => {
    // Only handle touch/pen, not mouse (mouse uses hover)
    if (e.pointerType === 'mouse') return

    // Prevent default to avoid text selection on long-press (iOS Safari)
    e.preventDefault()

    deleteLongPressStartPos.current = { x: e.clientX, y: e.clientY }
    deleteLongPressTimerRef.current = setTimeout(() => {
      setShowDeleteControls(true)
      deleteLongPressTimerRef.current = null
    }, 500)
  }

  const handleDeletePointerMove = (e: React.PointerEvent) => {
    if (!deleteLongPressStartPos.current || !deleteLongPressTimerRef.current) return

    const dx = e.clientX - deleteLongPressStartPos.current.x
    const dy = e.clientY - deleteLongPressStartPos.current.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    // Cancel long-press if moved more than 10px
    if (distance > 10) {
      clearTimeout(deleteLongPressTimerRef.current)
      deleteLongPressTimerRef.current = null
      deleteLongPressStartPos.current = null
    }
  }

  const handleDeletePointerUp = () => {
    if (deleteLongPressTimerRef.current) {
      clearTimeout(deleteLongPressTimerRef.current)
      deleteLongPressTimerRef.current = null
    }
    deleteLongPressStartPos.current = null
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (classDropdownRef.current && !classDropdownRef.current.contains(e.target as Node)) {
        setShowClassDropdown(false)
      }
      if (studentDropdownRef.current && !studentDropdownRef.current.contains(e.target as Node)) {
        setShowStudentDropdown(false)
      }
      if (myAnnotationsRef.current && !myAnnotationsRef.current.contains(e.target as Node)) {
        setShowMyAnnotationsPopup(false)
      }
      if (layersDropdownRef.current && !layersDropdownRef.current.contains(e.target as Node)) {
        setShowLayersDropdown(false)
        onShowLayerBadgesChange?.(false)
      }
      if (spacerPopoverRef.current && !spacerPopoverRef.current.contains(e.target as Node)) {
        setShowSpacerPicker(false)
      }
      if (moreToolsRef.current && !moreToolsRef.current.contains(e.target as Node)) {
        setShowMoreTools(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onShowLayerBadgesChange])

  // My annotations button hover/long-press handlers
  const handleMyAnnotationsMouseEnter = () => {
    if (myAnnotationsHideTimer.current) {
      clearTimeout(myAnnotationsHideTimer.current)
      myAnnotationsHideTimer.current = null
    }
    myAnnotationsHoverTimer.current = setTimeout(() => {
      log('Showing my annotations popup', { hasAnnotations })
      setShowMyAnnotationsPopup(true)
    }, 400)
  }

  const handleMyAnnotationsMouseLeave = () => {
    if (myAnnotationsHoverTimer.current) {
      clearTimeout(myAnnotationsHoverTimer.current)
      myAnnotationsHoverTimer.current = null
    }
    if (showMyAnnotationsPopup) {
      myAnnotationsHideTimer.current = setTimeout(() => {
        setShowMyAnnotationsPopup(false)
      }, 200)
    }
  }

  const handleMyAnnotationsPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    myAnnotationsLongPressTimer.current = setTimeout(() => {
      setShowMyAnnotationsPopup(true)
      myAnnotationsLongPressTimer.current = null
    }, 500)
  }

  const handleMyAnnotationsPointerUp = () => {
    if (myAnnotationsLongPressTimer.current) {
      clearTimeout(myAnnotationsLongPressTimer.current)
      myAnnotationsLongPressTimer.current = null
    }
  }

  const toolbarContent = (
    <div
      data-annotation-toolbar
      className="fixed bottom-6 z-50 select-none"
      style={{ left: `calc(${sidebarWidth}px + (100% - ${sidebarWidth}px) / 2)`, transform: 'translateX(-50%)', isolation: 'isolate', touchAction: 'manipulation' }}
      onMouseEnter={() => onShowLayerBadgesChange?.(true)}
      onMouseLeave={() => onShowLayerBadgesChange?.(false)}
    >
      {/* Single horizontal toolbar */}
      <div className="bg-background/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 flex items-center gap-1">

        {/* ============ SECTION 1: Broadcast Controls (Teachers and Page Authors) ============ */}
        {(isTeacher || isPageAuthor) && (
          <>
            <ToolbarSection>
              {/* Class/Page selector dropdown - picks class or "Public" for page authors */}
              <div className="relative" ref={classDropdownRef}>
                <button
                  onClick={() => {
                    setShowClassDropdown(!showClassDropdown)
                    setShowStudentDropdown(false)
                  }}
                  className={cn(
                    'p-2 rounded-md transition-colors flex items-center gap-1',
                    broadcastToPage || selectedClass
                      ? 'text-foreground hover:bg-accent'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                  title={broadcastToPage ? 'Broadcasting publicly' : 'Select class'}
                >
                  {broadcastToPage ? (
                    <Globe className="w-5 h-5 text-green-500" />
                  ) : (
                    <Radio className={cn('w-5 h-5', selectedClass && 'text-red-500')} />
                  )}
                  <span className="text-xs max-w-[80px] truncate">
                    {broadcastToPage ? 'Public' : selectedClass ? selectedClass.name : 'Broadcast'}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showClassDropdown && (classes.length > 0 || isPageAuthor) && (
                  <div className="absolute bottom-full mb-2 left-0 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px] max-h-[200px] overflow-y-auto">
                    {/* Public option (page authors only) */}
                    {isPageAuthor && (
                      <>
                        <button
                          onClick={() => {
                            onBroadcastToPageChange?.(true)
                            setShowClassDropdown(false)
                          }}
                          className={cn(
                            'w-full px-3 py-1.5 text-left text-sm truncate hover:bg-accent transition-colors flex items-center gap-2',
                            broadcastToPage && 'bg-accent font-medium'
                          )}
                        >
                          <Globe className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span className="truncate">Public</span>
                        </button>
                        {classes.length > 0 && <div className="h-px bg-border my-1" />}
                      </>
                    )}
                    {/* All classes (teachers only) */}
                    {isTeacher && classes.map(cls => (
                      <button
                        key={cls.id}
                        onClick={() => {
                          onBroadcastToPageChange?.(false)
                          onClassSelect?.(cls)
                          onStudentSelect?.(null) // Reset to "Entire class" when switching classes
                          setShowClassDropdown(false)
                        }}
                        className={cn(
                          'w-full px-3 py-1.5 text-left text-sm truncate hover:bg-accent transition-colors flex items-center gap-2',
                          !broadcastToPage && cls.id === selectedClass?.id && 'bg-accent font-medium'
                        )}
                      >
                        <span className={cn('w-4 flex-shrink-0', !cls.hasAnnotationsOnPage && 'invisible')}>
                          <BrushIndicator className="w-4 h-4" />
                        </span>
                        <span className="truncate">{cls.name}</span>
                      </button>
                    ))}
                    {/* Divider and Off option */}
                    <div className="h-px bg-border my-1" />
                    <button
                      onClick={() => {
                        onBroadcastToPageChange?.(false)
                        onClassSelect?.(null)
                        onStudentSelect?.(null)
                        setShowClassDropdown(false)
                      }}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors',
                        !broadcastToPage && !selectedClass ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Off
                    </button>
                  </div>
                )}
              </div>

              {/* Page broadcast indicator (when Public is selected) */}
              {broadcastToPage && (
                <div className="flex items-center gap-1 px-2 py-1.5 bg-primary text-primary-foreground rounded-md">
                  <Globe className="w-4 h-4" />
                  <span className="text-xs">Public</span>
                  <button
                    onClick={onPageBroadcastToggle}
                    className="p-1 rounded hover:bg-primary-foreground/20 transition-colors"
                    title={pageBroadcastVisible ? 'Hide page annotations' : 'Show page annotations'}
                  >
                    {pageBroadcastVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={onPageBroadcastDelete}
                    disabled={!hasPageBroadcastAnnotations}
                    className={cn(
                      'p-1 rounded transition-colors',
                      hasPageBroadcastAnnotations
                        ? 'hover:bg-primary-foreground/20'
                        : 'opacity-30 cursor-not-allowed'
                    )}
                    title="Clear page annotations"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Target selector dropdown (only when class is selected, not in page-broadcast mode) */}
              {selectedClass && !broadcastToPage && (
                <div className="relative" ref={studentDropdownRef}>
                  <button
                    onClick={() => {
                      setShowStudentDropdown(!showStudentDropdown)
                      setShowClassDropdown(false)
                    }}
                    className={cn(
                      'p-2 rounded-md transition-colors flex items-center gap-1',
                      'bg-primary text-primary-foreground' // Always highlighted - this is the active target
                    )}
                    title={selectedStudent ? 'Individual student feedback' : 'Broadcasting to entire class'}
                  >
                    {selectedStudent ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    <span className="text-xs max-w-[100px] truncate">
                      {selectedStudent ? selectedStudent.displayName : 'Entire class'}
                    </span>
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {showStudentDropdown && (() => {
                    // Determine which student to show in quick-access section
                    // Use fresh data from students array to get current hasAnnotationsOnPage
                    const quickAccessStudentId = selectedStudent?.id || lastSelectedStudent?.id
                    const quickAccessStudent = quickAccessStudentId
                      ? students.find(s => s.id === quickAccessStudentId) || selectedStudent || lastSelectedStudent
                      : null
                    // Filter out the quick-access student from the main list
                    const mainListStudents = students.filter(s => s.id !== quickAccessStudent?.id)

                    return (
                    <div
                      className="absolute bottom-full mb-2 left-0 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[200px] max-h-[280px] overflow-y-auto"
                    >
                      {/* Student list (excluding quick-access student) */}
                      {mainListStudents.map(student => (
                        <button
                          key={student.id}
                          onClick={() => {
                            onStudentSelect?.(student)
                            setShowStudentDropdown(false)
                          }}
                          className="w-full px-3 py-1.5 text-left text-sm truncate hover:bg-accent transition-colors flex items-center gap-2"
                        >
                          <span className={cn('w-4 flex-shrink-0', !student.hasAnnotationsOnPage && 'invisible')}>
                            <BrushIndicator className="w-4 h-4" />
                          </span>
                          <span className="truncate">{student.displayName}</span>
                        </button>
                      ))}

                      {/* Separator before quick-access section */}
                      <div className="h-px bg-border my-1" />

                      {/* Quick-access section: selected/last student + "Entire class" */}
                      {/* Show last selected student for quick switching (when in "Entire class" mode) */}
                      {quickAccessStudent && (() => {
                        const isStudentActive = selectedStudent?.id === quickAccessStudent.id
                        return (
                        <div className={cn(
                          'flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md layers-menu-purple',
                          isStudentActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                        )}>
                          <button
                            onClick={() => {
                              log('Student clicked', { displayName: quickAccessStudent.displayName, id: quickAccessStudent.id })
                              onStudentSelect?.(quickAccessStudent)
                              setShowStudentDropdown(false)
                            }}
                            className={cn(
                              'flex-1 text-left text-sm truncate transition-colors flex items-center gap-2',
                              isStudentActive ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <span className={cn('w-4 flex-shrink-0', !quickAccessStudent.hasAnnotationsOnPage && 'invisible')}>
                              <BrushIndicator className="w-4 h-4" />
                            </span>
                            <span className="truncate">{quickAccessStudent.displayName}</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              log('Student feedback eye clicked, toggling visibility')
                              onStudentFeedbackToggle?.()
                            }}
                            className={cn(
                              'p-1 rounded transition-colors',
                              isStudentActive
                                ? 'hover:bg-primary-foreground/20'
                                : studentFeedbackVisible
                                  ? 'text-foreground hover:bg-background/50'
                                  : 'text-muted-foreground/50 hover:bg-background/50'
                            )}
                            title={studentFeedbackVisible ? 'Hide student feedback' : 'Show student feedback'}
                          >
                            {studentFeedbackVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              log('Student feedback trash clicked, deleting')
                              onStudentFeedbackDelete?.()
                              onClearLastSelectedStudent?.()
                              setShowStudentDropdown(false)
                            }}
                            className={cn(
                              'p-1 rounded transition-colors',
                              hasStudentFeedbackAnnotations
                                ? isStudentActive
                                  ? 'hover:bg-primary-foreground/20'
                                  : 'text-muted-foreground hover:text-destructive hover:bg-background/50'
                                : 'opacity-30 cursor-not-allowed'
                            )}
                            title="Clear student feedback"
                            disabled={!hasStudentFeedbackAnnotations}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )})()}

                      {/* "Entire class" option */}
                      <div className={cn(
                        'flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md layers-menu-blue',
                        !selectedStudent ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      )}>
                        <button
                          onClick={() => {
                            log('Entire class clicked, setting selectedStudent to null')
                            onStudentSelect?.(null)
                            setShowStudentDropdown(false)
                          }}
                          className={cn(
                            'flex-1 text-left text-sm truncate transition-colors flex items-center gap-2',
                            !selectedStudent ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <Users className="w-4 h-4 flex-shrink-0" />
                          <span>Entire class</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            log('Class broadcast eye clicked, toggling visibility')
                            onClassBroadcastToggle?.()
                          }}
                          className={cn(
                            'p-1 rounded transition-colors',
                            !selectedStudent
                              ? 'hover:bg-primary-foreground/20'
                              : classBroadcastVisible
                                ? 'text-foreground hover:bg-background/50'
                                : 'text-muted-foreground/50 hover:bg-background/50'
                          )}
                          title={classBroadcastVisible ? 'Hide class broadcast' : 'Show class broadcast'}
                        >
                          {classBroadcastVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            log('Class broadcast trash clicked, deleting')
                            onClassBroadcastDelete?.()
                          }}
                          className={cn(
                            'p-1 rounded transition-colors',
                            hasClassBroadcastAnnotations
                              ? !selectedStudent
                                ? 'hover:bg-primary-foreground/20'
                                : 'text-muted-foreground hover:text-destructive hover:bg-background/50'
                              : 'opacity-30 cursor-not-allowed'
                          )}
                          title="Clear class broadcast"
                          disabled={!hasClassBroadcastAnnotations}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )})()}
                </div>
              )}
            </ToolbarSection>
            <ToolbarDivider />
          </>
        )}

        {/* ============ SECTION 2: Layer Controls (Students - broadcasted teacher layers) ============ */}
        {/* Layers dropdown button - hovering shows labels on annotations */}
        {!isTeacher && layers.filter(l => !l.isActive).length > 0 && (
          <>
            <ToolbarSection>
              <div className="relative" ref={layersDropdownRef}>
                <button
                  onClick={() => {
                    const newState = !showLayersDropdown
                    setShowLayersDropdown(newState)
                    onShowLayerBadgesChange?.(newState)
                  }}
                  className={cn(
                    'p-2 rounded-md transition-colors flex items-center gap-1',
                    showLayersDropdown
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                  title="View layers"
                >
                  <Layers className="w-4 h-4" />
                  <ChevronDown className="w-3 h-3" />
                </button>

                {/* Layers dropdown menu */}
                {showLayersDropdown && (
                  <div
                    className="absolute bottom-full mb-2 left-0 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
                  >
                    {layers.filter(l => !l.isActive).map(layer => {
                      // Map layer color to badge color class
                      const colorClass = layer.color.includes('blue') ? 'layers-menu-blue'
                        : layer.color.includes('orange') ? 'layers-menu-orange'
                        : layer.color.includes('green') ? 'layers-menu-green'
                        : layer.color.includes('purple') ? 'layers-menu-purple'
                        : ''

                      return (
                        <div
                          key={layer.id}
                          className={cn(
                            'flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                            colorClass,
                            !layer.visible && 'opacity-50'
                          )}
                        >
                          <button
                            onClick={() => onLayerToggle?.(layer.id)}
                            className="p-0.5 rounded hover:bg-accent/50 transition-colors"
                            title={layer.visible ? `Hide ${layer.label}` : `Show ${layer.label}`}
                          >
                            {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          <span className="flex-1 truncate">{layer.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </ToolbarSection>
            <ToolbarDivider />
          </>
        )}

        {/* ============ SECTION 3: My Annotations Button (Everyone) ============ */}
        <ToolbarSection>
          <div className="relative" ref={myAnnotationsRef}>
            <button
              onClick={onMyAnnotationsToggle}
              onMouseEnter={handleMyAnnotationsMouseEnter}
              onMouseLeave={handleMyAnnotationsMouseLeave}
              onPointerDown={handleMyAnnotationsPointerDown}
              onPointerUp={handleMyAnnotationsPointerUp}
              onPointerCancel={handleMyAnnotationsPointerUp}
              className={cn(
                'p-2 rounded-md transition-colors relative',
                myAnnotationsActive && myAnnotationsVisible
                  ? 'bg-primary text-primary-foreground'
                  : myAnnotationsVisible
                    ? 'text-foreground hover:bg-accent'
                    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent'
              )}
              title={myAnnotationsActive
                ? (myAnnotationsVisible ? 'Hide my annotations' : 'Show my annotations')
                : (myAnnotationsVisible ? 'Hide my annotations' : 'Show my annotations')
              }
            >
              <UserPen className="w-4 h-4" />
              {/* Visibility indicator - show when not active, OR when active but hidden */}
              {(!myAnnotationsActive || !myAnnotationsVisible) && (
                <span className="absolute -top-0.5 -right-0.5">
                  {myAnnotationsVisible
                    ? <Eye className="w-2.5 h-2.5 text-foreground" />
                    : <EyeOff className="w-2.5 h-2.5 text-muted-foreground" />
                  }
                </span>
              )}
            </button>

            {/* Delete popup on hover/long-press */}
            {showMyAnnotationsPopup && hasAnnotations && (
              <div
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-background border border-border rounded-lg shadow-lg p-2"
                onMouseEnter={() => {
                  if (myAnnotationsHideTimer.current) {
                    clearTimeout(myAnnotationsHideTimer.current)
                    myAnnotationsHideTimer.current = null
                  }
                }}
                onMouseLeave={() => setShowMyAnnotationsPopup(false)}
              >
                <button
                  onClick={() => {
                    log('Delete button clicked, calling onMyAnnotationsDelete')
                    onMyAnnotationsDelete?.()
                    setShowMyAnnotationsPopup(false)
                  }}
                  className="p-2 text-destructive hover:bg-destructive/10 rounded transition-colors"
                  title="Clear"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </ToolbarSection>
        <ToolbarDivider />

        {/* ============ SECTION 4: Drawing Tools ============ */}
        <ToolbarSection>
          {/* Three Pen Tools */}
          {[0, 1, 2].map((penIndex) => (
            <div key={penIndex} className="relative">
              <button
                data-pen-button
                onClick={() => handlePenClick(penIndex)}
                onMouseEnter={() => handlePenMouseEnter(penIndex)}
                onMouseLeave={handlePenMouseLeave}
                onPointerDown={(e) => handlePenPointerDown(e, penIndex)}
                onPointerMove={handlePenPointerMove}
                onPointerUp={handlePenPointerUp}
                onPointerCancel={handlePenPointerUp}
                className={cn(
                  'p-2 rounded-md transition-colors relative',
                  mode === 'draw' && activePen === penIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
                title={`Pen ${penIndex + 1}`}
                aria-label={`Select pen ${penIndex + 1}`}
              >
                <Pen className="w-4 h-4" />
                {/* Color indicator - uses annotation-color-indicator for dark mode filter */}
                <div
                  className="annotation-color-indicator absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-white dark:border-gray-800"
                  style={{ backgroundColor: penColors[penIndex] }}
                />
              </button>

              {/* Pen controls popover (size slider + color picker) */}
              {showPenControls === penIndex && (
                <div
                  ref={penPopoverRef}
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex gap-2"
                  onMouseEnter={() => {
                    if (hoverTimerRef.current) {
                      clearTimeout(hoverTimerRef.current)
                    }
                    if (hideTimerRef.current) {
                      clearTimeout(hideTimerRef.current)
                      hideTimerRef.current = null
                    }
                  }}
                  onMouseLeave={() => setShowPenControls(null)}
                >
                  {/* Size slider */}
                  <div className="bg-background border border-border rounded-lg shadow-lg p-3 flex flex-col items-center gap-3 min-h-[200px]">
                    <BrushThickIcon className="w-6 h-6 flex-shrink-0 opacity-60" />
                    <input
                      type="range"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={penSizes[penIndex]}
                      onChange={(e) => handleSizeChange(penIndex, parseFloat(e.target.value))}
                      className="flex-grow cursor-pointer [writing-mode:vertical-lr] [direction:rtl] slider-vertical"
                    />
                    <BrushThinIcon className="w-6 h-6 flex-shrink-0 opacity-60" />
                  </div>

                  {/* Color picker */}
                  <div className="bg-background border border-border rounded-lg shadow-lg p-3 annotation-color-picker">
                    <Circle
                      colors={['#000000', '#808080', '#DD5555', '#EE8844', '#44AA66', '#5577DD', '#9966DD']}
                      color={penColors[penIndex]}
                      onChange={(color) => handleColorChange(penIndex, color.hex)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Eraser Tool */}
          <button
            onClick={handleEraserClick}
            className={cn(
              'p-2 rounded-md transition-colors',
              mode === 'erase'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
            title="Erase"
            aria-label="Toggle eraser mode"
          >
            <Eraser className="w-4 h-4" />
          </button>

          {/* Spacer tool - insert visual spacers between content blocks */}
          <div className="relative" ref={spacerPopoverRef}>
            <button
              className={cn(
                'p-2 rounded-md transition-colors',
                mode === 'spacer'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              onClick={() => {
                onModeChange(mode === 'spacer' ? 'view' : 'spacer')
              }}
              onMouseEnter={() => {
                if (spacerHideTimerRef.current) {
                  clearTimeout(spacerHideTimerRef.current)
                  spacerHideTimerRef.current = null
                }
                spacerHoverTimerRef.current = setTimeout(() => {
                  setShowSpacerPicker(true)
                }, 300)
              }}
              onMouseLeave={() => {
                if (spacerHoverTimerRef.current) {
                  clearTimeout(spacerHoverTimerRef.current)
                  spacerHoverTimerRef.current = null
                }
                spacerHideTimerRef.current = setTimeout(() => {
                  setShowSpacerPicker(false)
                }, 200)
              }}
              onTouchStart={(e) => {
                spacerLongPressStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                spacerLongPressTimerRef.current = setTimeout(() => {
                  setShowSpacerPicker(true)
                }, 500)
              }}
              onTouchMove={(e) => {
                if (spacerLongPressStartPos.current) {
                  const dx = e.touches[0].clientX - spacerLongPressStartPos.current.x
                  const dy = e.touches[0].clientY - spacerLongPressStartPos.current.y
                  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    if (spacerLongPressTimerRef.current) {
                      clearTimeout(spacerLongPressTimerRef.current)
                      spacerLongPressTimerRef.current = null
                    }
                  }
                }
              }}
              onTouchEnd={() => {
                if (spacerLongPressTimerRef.current) {
                  clearTimeout(spacerLongPressTimerRef.current)
                  spacerLongPressTimerRef.current = null
                }
              }}
              title="Insert spacer"
              aria-label="Toggle spacer mode"
            >
              <SeparatorHorizontal className="w-4 h-4" />
            </button>

            {/* Spacer pattern picker popover */}
            {showSpacerPicker && (
              <div
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50"
                onMouseEnter={() => {
                  if (spacerHideTimerRef.current) {
                    clearTimeout(spacerHideTimerRef.current)
                    spacerHideTimerRef.current = null
                  }
                }}
                onMouseLeave={() => {
                  spacerHideTimerRef.current = setTimeout(() => {
                    setShowSpacerPicker(false)
                  }, 200)
                }}
              >
                <div className="bg-popover text-popover-foreground rounded-md shadow-lg border border-border p-2 spacer-preview">
                  {/* Erase-on-delete toggle - above patterns */}
                  <label
                    className="flex items-center gap-1.5 mb-2 px-1 cursor-pointer select-none"
                    title="When enabled, removing a spacer also erases any annotations drawn inside it"
                  >
                    <input
                      type="checkbox"
                      checked={spacerDeleteAnnotations}
                      onChange={(e) => onSpacerDeleteAnnotationsChange?.(e.target.checked)}
                      className="rounded border-border accent-primary w-3.5 h-3.5"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Erase ink on remove</span>
                  </label>
                  <div className="flex gap-1.5">
                    {([
                      { key: 'blank' as SpacerPattern, label: 'Blank' },
                      { key: 'checkered' as SpacerPattern, label: 'Grid' },
                      { key: 'lines' as SpacerPattern, label: 'Lines' },
                      { key: 'dots' as SpacerPattern, label: 'Dots' },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        className={cn(
                          'w-8 h-8 rounded border-2 transition-colors',
                          spacerPattern === key
                            ? 'border-primary ring-1 ring-primary'
                            : 'border-border hover:border-muted-foreground'
                        )}
                        onClick={() => {
                          onSpacerPatternChange?.(key)
                          if (mode !== 'spacer') onModeChange('spacer')
                        }}
                        title={label}
                        aria-label={`${label} spacer pattern`}
                      >
                        <div className={cn('w-full h-full rounded-sm spacer-element', `spacer-${key}`)} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sticky Note tool */}
          <div className="relative">
            <button
              className={cn(
                'p-2 rounded-md transition-colors relative',
                stickyNotePlacementMode
                  ? 'bg-yellow-400 dark:bg-yellow-500 text-yellow-950'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              onClick={onStickyNotePlacementToggle}
              title={stickyNotePlacementMode ? 'Cancel sticky note placement (Esc)' : 'Add sticky note'}
              aria-label={stickyNotePlacementMode ? 'Cancel sticky note placement' : 'Add sticky note'}
              aria-pressed={stickyNotePlacementMode}
            >
              <StickyNoteIcon className="w-4 h-4" />
              {stickyNoteCount > 0 && !stickyNotePlacementMode && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-yellow-400 dark:bg-yellow-500 text-yellow-950 text-[9px] font-bold flex items-center justify-center px-0.5 leading-none tabular-nums">
                  {stickyNoteCount > 99 ? '99+' : stickyNoteCount}
                </span>
              )}
            </button>
          </div>

          {/* More tools - popover with snap and highlight explanations */}
          <div className="relative" ref={moreToolsRef}>
            <button
              className={cn(
                'p-2 rounded-md transition-colors',
                showMoreTools
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              onClick={() => setShowMoreTools(!showMoreTools)}
              title="More tools"
              aria-label="More tools"
            >
              <Ellipsis className="w-4 h-4" />
            </button>
            {showMoreTools && (
              <div className="absolute bottom-full mb-2 left-0 z-50">
                <div className="bg-popover text-popover-foreground text-sm rounded-md shadow-lg border border-border p-2 w-64 space-y-2">
                  {/* Snap explanation */}
                  <div className="flex items-start gap-2.5 px-1 py-1">
                    <Camera className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div>
                      <span className="text-foreground font-medium">Snap</span>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Paste and crop a screenshot
                        <br />
                        <span className="inline-flex items-baseline gap-0.5 mt-0.5">
                          <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono border border-border shadow-sm">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd>
                          <span className="text-muted-foreground mx-0.5">+</span>
                          <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono border border-border shadow-sm">V</kbd>
                        </span>
                      </p>
                    </div>
                  </div>
                  {/* Highlight explanation */}
                  <div className="flex items-start gap-2.5 px-1 py-1">
                    <Highlighter className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div>
                      <span className="text-foreground font-medium">Highlight</span>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Select text to highlight
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </ToolbarSection>
      </div>
    </div>
  )

  // Render to document.body to avoid zoom transforms
  return typeof window !== 'undefined' ? createPortal(toolbarContent, document.body) : toolbarContent
}
