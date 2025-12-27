'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { BookOpen, Settings, Users, ChevronLeft, ChevronRight, Shield, GraduationCap, User, Camera, ExternalLink, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePendingInvitations } from '@/hooks/use-pending-invitations'

// Personal navigation items for teachers
const personalNavigation = [
  { name: 'Page Builder', href: '/dashboard/page-builder', icon: BookOpen },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { name: 'Collaborate', href: '/dashboard/collaborate', icon: Users },
  { name: 'My Classes', href: '/dashboard/classes', icon: GraduationCap },
]

// Student navigation items
const studentNavigation = [
  { name: 'My Classes', href: '/dashboard/my-classes', icon: GraduationCap },
  { name: 'My Snaps', href: '/dashboard/my-snaps', icon: Camera },
  { name: 'Profile', href: '/dashboard/profile', icon: User },
]

// Organization navigation items (relative to org)
const orgNavigationItems = [
  { name: 'Settings', suffix: '/settings', icon: Settings },
  { name: 'Page Builder', suffix: '/page-builder', icon: BookOpen },
  { name: 'Members', suffix: '/members', icon: Users },
  { name: 'Domains', suffix: '/domains', icon: Globe },
]

interface OrgWithRole {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member'
}

// Section header component
function SectionHeader({ title, isCollapsed }: { title: string; isCollapsed: boolean }) {
  if (isCollapsed) return null
  return (
    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {title}
    </div>
  )
}

export function DashboardSidebar() {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { data: session } = useSession()
  const hasPendingInvitations = usePendingInvitations()
  const [lastTeacherPage, setLastTeacherPage] = useState<{ slug: string; name: string } | null>(null)
  const [adminOrgs, setAdminOrgs] = useState<OrgWithRole[]>([])

  // Determine which navigation to show based on account type
  const isStudent = session?.user?.accountType === 'student'
  const isTeacher = session?.user?.accountType === 'teacher'

  // Load last visited teacher page from localStorage (students only)
  useEffect(() => {
    if (!isStudent) return

    try {
      const stored = localStorage.getItem('lastTeacherPage')
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLastTeacherPage(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors
    }
  }, [isStudent])

  // Fetch organizations where user is admin/owner (teachers only)
  useEffect(() => {
    if (!isTeacher || !session?.user?.id) return

    const fetchOrgs = async () => {
      try {
        const response = await fetch('/api/user/organizations')
        if (response.ok) {
          const data = await response.json()
          // Filter to only show orgs where user is admin or owner
          const adminOrgsFiltered = data.organizations.filter(
            (org: OrgWithRole) => org.role === 'admin' || org.role === 'owner'
          )
          setAdminOrgs(adminOrgsFiltered)
        }
      } catch {
        // Silently fail - org nav is optional
      }
    }

    fetchOrgs()
  }, [isTeacher, session?.user?.id])

  // Get user's display name
  const userName = session?.user?.name || 'My Account'

  return (
    <div className={cn(
      "bg-card border-r border-border min-h-screen transition-all duration-300 flex flex-col",
      isCollapsed ? "w-16 min-w-16" : "w-64"
    )}>
      <div className="p-4 flex-1 flex flex-col">
        {/* Toggle Button */}
        <div className="flex justify-end mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2"
          >
            {isCollapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <ChevronLeft className="w-5 h-5" />
            )}
          </Button>
        </div>

        <nav className="space-y-1 flex-1">
          {/* Student Navigation */}
          {isStudent && (
            <>
              <SectionHeader title="My Dashboard" isCollapsed={isCollapsed} />
              {studentNavigation.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href

                // Show red dot on My Classes if there are pending invitations
                const showDot = hasPendingInvitations && item.href === '/dashboard/my-classes'

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors relative',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed ? 'justify-center px-2' : ''
                    )}
                    title={isCollapsed ? item.name : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    {!isCollapsed && <span>{item.name}</span>}
                    {showDot && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                    )}
                  </Link>
                )
              })}
            </>
          )}

          {/* Teacher Navigation - Personal Section */}
          {isTeacher && (
            <>
              <SectionHeader title={userName} isCollapsed={isCollapsed} />
              {personalNavigation.map((item) => {
                const Icon = item.icon
                // Highlight page-builder for both /dashboard and /dashboard/page-builder
                const isActive = pathname === item.href ||
                               (item.href === '/dashboard/page-builder' && pathname === '/dashboard')

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed ? 'justify-center px-2' : ''
                    )}
                    title={isCollapsed ? item.name : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    {!isCollapsed && <span>{item.name}</span>}
                  </Link>
                )
              })}
            </>
          )}

          {/* Organization Sections (for org admins/owners) */}
          {adminOrgs.map((org) => (
            <div key={org.id} className="mt-6">
              <SectionHeader title={org.name} isCollapsed={isCollapsed} />
              {orgNavigationItems.map((item) => {
                const Icon = item.icon
                const href = `/dashboard/org/${org.id}${item.suffix}`
                const isActive = pathname === href

                return (
                  <Link
                    key={`${org.id}-${item.name}`}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed ? 'justify-center px-2' : ''
                    )}
                    title={isCollapsed ? `${org.name} ${item.name}` : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    {!isCollapsed && <span>{item.name}</span>}
                  </Link>
                )
              })}
            </div>
          ))}

          {/* Admin Panel Link (only visible to admins) */}
          {session?.user?.isAdmin && (
            <div className="mt-6">
              <SectionHeader title="Admin" isCollapsed={isCollapsed} />
              <Link
                href="/dashboard/admin"
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                  pathname === '/dashboard/admin'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isCollapsed ? 'justify-center px-2' : ''
                )}
                title={isCollapsed ? 'Admin Panel' : undefined}
              >
                <Shield className="w-5 h-5" />
                {!isCollapsed && <span>Admin Panel</span>}
              </Link>
            </div>
          )}
        </nav>

        {/* Back to Teacher Page link (students only) */}
        {isStudent && (lastTeacherPage || session?.user?.signedUpFromPageSlug) && (
          <div className="mt-4 pt-4 border-t border-border">
            <Link
              href={`/${lastTeacherPage?.slug || session?.user?.signedUpFromPageSlug}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                'text-muted-foreground hover:bg-muted hover:text-foreground',
                isCollapsed ? 'justify-center px-2' : ''
              )}
              title={isCollapsed ? `Back to ${lastTeacherPage?.name || session?.user?.signedUpFromPageSlug}` : undefined}
            >
              <ExternalLink className="w-5 h-5" />
              {!isCollapsed && <span>Back to {lastTeacherPage?.name || session?.user?.signedUpFromPageSlug}</span>}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
