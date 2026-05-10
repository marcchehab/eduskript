'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ThemeToggleProps {
  isCollapsed?: boolean
}

// Theme is a per-device preference. localStorage (via next-themes) is the
// source of truth on the client; PATCH /api/user/theme records it on the user
// row purely so it round-trips through /api/user/data-export. We deliberately
// do NOT fetch the server preference back on mount: that fetch was the cause
// of a post-paint setTheme flash whenever localStorage and the DB disagreed.
export function ThemeToggle({ isCollapsed = false }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme()
  const { data: session } = useSession()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

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
        <Sun className="w-5 h-5" />
        {!isCollapsed && <span className="ml-2">Theme</span>}
      </Button>
    )
  }

  const cycleTheme = () => {
    const currentTheme = resolvedTheme || 'light'
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark'

    // Temporarily disable transitions to prevent flicker
    document.documentElement.classList.add('theme-transitioning')
    setTheme(newTheme)
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning')
    }, 100)

    if (session?.user?.email) {
      saveThemePreference(newTheme)
    }
  }

  const getThemeIcon = () => {
    return resolvedTheme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />
  }

  const getThemeLabel = () => {
    return resolvedTheme === 'dark' ? 'Dark' : 'Light'
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycleTheme}
      className={`${isCollapsed ? 'w-10 h-10 p-0' : 'w-full justify-start'} transition-none`}
      title={isCollapsed ? `Theme: ${getThemeLabel()} (click to cycle)` : undefined}
    >
      {getThemeIcon()}
      {!isCollapsed && <span className="ml-2">Theme: {getThemeLabel()}</span>}
    </Button>
  )
}
