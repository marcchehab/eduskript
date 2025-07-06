'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ThemeToggleProps {
  isCollapsed?: boolean
}

export function ThemeToggle({ isCollapsed = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()
  const { data: session } = useSession()
  const [mounted, setMounted] = useState(false)

  // Only render after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // Load user's theme preference when session is available
  useEffect(() => {
    if (session?.user?.email && mounted) {
      loadThemePreference()
    }
  }, [session, mounted])

  const loadThemePreference = async () => {
    try {
      const response = await fetch('/api/user/theme')
      if (response.ok) {
        const data = await response.json()
        if (data.themePreference && data.themePreference !== theme) {
          setTheme(data.themePreference)
        }
      }
    } catch (error) {
      console.error('Failed to load theme preference:', error)
    }
  }

  const saveThemePreference = async (newTheme: string) => {
    if (!session?.user?.email) return
    
    try {
      await fetch('/api/user/theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme })
      })
    } catch (error) {
      console.error('Failed to save theme preference:', error)
    }
  }

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={`${isCollapsed ? 'w-10 h-10 p-0' : 'w-full justify-start'}`}
        disabled
      >
        <Sun className="w-4 h-4" />
        {!isCollapsed && <span className="ml-2">Theme</span>}
      </Button>
    )
  }

  const cycleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    saveThemePreference(newTheme)
  }

  const getThemeIcon = () => {
    return theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />
  }

  const getThemeLabel = () => {
    return theme === 'dark' ? 'Dark' : 'Light'
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycleTheme}
      className={`${isCollapsed ? 'w-10 h-10 p-0' : 'w-full justify-start'} transition-colors`}
      title={isCollapsed ? `Theme: ${getThemeLabel()} (click to cycle)` : undefined}
    >
      {getThemeIcon()}
      {!isCollapsed && <span className="ml-2">Theme: {getThemeLabel()}</span>}
    </Button>
  )
}
