'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from './theme-toggle'

interface TeacherPageInfo {
  slug: string
  name: string
  pageIcon?: string | null
}

export function DashboardNav() {
  const { data: session } = useSession()
  const isStudent = session?.user?.accountType === 'student'
  const [teacherPage, setTeacherPage] = useState<TeacherPageInfo | null>(null)

  // For students, load teacher page info from localStorage (set when visiting a teacher's public site)
  useEffect(() => {
    if (!isStudent) return

    try {
      const stored = localStorage.getItem('lastTeacherPage')
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTeacherPage(JSON.parse(stored))
        return
      }
    } catch {
      // Ignore parse errors
    }

    // Fallback: session has the slug they signed up from but no icon/name
    if (session?.user?.signedUpFromPageSlug) {
       
      setTeacherPage({ slug: session.user.signedUpFromPageSlug, name: session.user.signedUpFromPageSlug })
    }
  }, [isStudent, session?.user?.signedUpFromPageSlug])

  const getSignOutUrl = () => {
    if (!isStudent) return '/'
    return teacherPage ? `/${teacherPage.slug}` : '/'
  }

  return (
    <nav className="border-b border-border bg-card px-6 py-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-6">
          {/* For students: show teacher's logo + page name, linking to their root page */}
          {isStudent && teacherPage ? (
            <Link href={`/${teacherPage.slug}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {teacherPage.pageIcon === 'default' ? (
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <NotebookPen className="w-5 h-5 text-muted-foreground" />
                </div>
              ) : teacherPage.pageIcon ? (
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={teacherPage.pageIcon} alt="Page icon" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <span className="text-muted-foreground font-bold text-sm">
                    {(teacherPage.name || 'P').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-xl font-bold text-foreground font-heading">
                {teacherPage.name}
              </span>
            </Link>
          ) : (
            <Link href="/dashboard" className="text-xl font-bold text-foreground">
              Eduskript
            </Link>
          )}
          <div className="text-sm text-muted-foreground">
            Welcome back, {session?.user?.name}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={() => signOut({ callbackUrl: getSignOutUrl() })}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </nav>
  )
}
