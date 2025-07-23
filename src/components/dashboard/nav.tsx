'use client'

import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from './theme-toggle'

export function DashboardNav() {
  const { data: session } = useSession()

  return (
    <nav className="border-b border-border bg-card px-6 py-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            Eduskript
          </Link>
          <div className="text-sm text-muted-foreground">
            Welcome back, {session?.user?.name}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() => signOut()}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </nav>
  )
}
