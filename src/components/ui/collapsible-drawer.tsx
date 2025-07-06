'use client'

import { useState, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleDrawerProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

export function CollapsibleDrawer({ 
  title, 
  icon, 
  children, 
  defaultOpen = false, 
  className = '' 
}: CollapsibleDrawerProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className={`border border-border rounded-lg ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted transition-colors"
      >
        <div className="flex items-center space-x-2">
          {icon}
          <h3 className="text-lg font-semibold text-foreground">
            {title}
          </h3>
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        )}
      </button>
      
      {isOpen && (
        <div className="border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}
