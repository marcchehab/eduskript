'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CircleCheckBig, CircleMinus, EyeOff } from 'lucide-react'

type VisibilityState = 'draft' | 'published' | 'unlisted'

interface PublishToggleProps {
  type: 'skript' | 'page'
  itemId: string
  isPublished: boolean
  isUnlisted?: boolean
  onToggle: (newIsPublished: boolean, newIsUnlisted: boolean) => void
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

function getState(isPublished: boolean, isUnlisted: boolean): VisibilityState {
  if (!isPublished) return 'draft'
  if (isUnlisted) return 'unlisted'
  return 'published'
}

// Cycle: draft → published → unlisted → draft
function nextState(state: VisibilityState): VisibilityState {
  if (state === 'draft') return 'published'
  if (state === 'published') return 'unlisted'
  return 'draft'
}

const stateConfig: Record<VisibilityState, {
  label: string
  color: string
  icon: typeof CircleCheckBig
  tooltip: string
}> = {
  draft: {
    label: 'Draft',
    color: 'text-warning hover:text-warning/80',
    icon: CircleMinus,
    tooltip: 'Publish',
  },
  published: {
    label: 'Published',
    color: 'text-success hover:text-success/80',
    icon: CircleCheckBig,
    tooltip: 'Make unlisted',
  },
  unlisted: {
    label: 'Unlisted',
    color: 'text-violet-500 hover:text-violet-500/80',
    icon: EyeOff,
    tooltip: 'Unpublish',
  },
}

export function PublishToggle({
  type,
  itemId,
  isPublished: initialIsPublished,
  isUnlisted: initialIsUnlisted = false,
  onToggle,
  size = 'sm',
  showText = true
}: PublishToggleProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [state, setState] = useState<VisibilityState>(
    getState(initialIsPublished, initialIsUnlisted)
  )

  const handleToggle = async () => {
    setIsLoading(true)
    const next = nextState(state)
    const newIsPublished = next !== 'draft'
    const newIsUnlisted = next === 'unlisted'
    try {
      const endpoint = type === 'skript' ? `/api/skripts/${itemId}` : `/api/pages/${itemId}`
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublished: newIsPublished,
          isUnlisted: newIsUnlisted
        })
      })

      if (response.ok) {
        setState(next)
        onToggle(newIsPublished, newIsUnlisted)
      } else {
        console.error(`Failed to toggle ${type} publish status`)
      }
    } catch (error) {
      console.error(`Error toggling ${type} publish status:`, error)
    } finally {
      setIsLoading(false)
    }
  }

  const iconSize = size === 'lg' ? 'w-5 h-5' : size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
  const buttonSize = size === 'lg' ? 'default' : 'sm'
  const config = stateConfig[state]
  const Icon = config.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={buttonSize}
            onClick={handleToggle}
            disabled={isLoading}
            className={`${config.color} px-2`}
          >
            <Icon className={iconSize} />
            {showText && (
              <span className="ml-1 text-xs">
                {config.label}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip} {type}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
