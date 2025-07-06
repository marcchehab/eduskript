'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'

interface PublishToggleProps {
  type: 'chapter' | 'page'
  itemId: string
  isPublished: boolean
  onToggle: () => void
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

export function PublishToggle({ 
  type, 
  itemId, 
  isPublished, 
  onToggle, 
  size = 'sm',
  showText = true 
}: PublishToggleProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleToggle = async () => {
    setIsLoading(true)
    try {
      const endpoint = type === 'chapter' ? `/api/chapters/${itemId}` : `/api/pages/${itemId}`
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublished: !isPublished
        })
      })

      if (response.ok) {
        onToggle()
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

  return (
    <Button
      variant="ghost"
      size={buttonSize}
      onClick={handleToggle}
      disabled={isLoading}
      className={`${isPublished ? 'text-success hover:text-success/80' : 'text-warning hover:text-warning/80'} px-2`}
      title={`${isPublished ? 'Unpublish' : 'Publish'} ${type}`}
    >
      {isPublished ? (
        <Eye className={iconSize} />
      ) : (
        <EyeOff className={iconSize} />
      )}
      {showText && (
        <span className="ml-1 text-xs">
          {isPublished ? 'Published' : 'Draft'}
        </span>
      )}
    </Button>
  )
}
