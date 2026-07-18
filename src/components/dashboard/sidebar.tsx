'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { BookOpen, Settings, Users, ChevronLeft, ChevronRight, Shield, GraduationCap, User, Camera, CornerUpLeft, Globe, BarChart3, CreditCard, Lock, Tag, Puzzle, ClipboardCheck, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Per-site authoring items (site-scoped URLs). A teacher normally has one
// site; superadmin-granted extra sites each get their own stacked block.
const siteNavItems = [
  { name: 'Page Builder', suffix: '/page-builder', icon: BookOpen },
  { name: 'Frontpage', suffix: '/frontpage', icon: FileText },
]

// Account-level items — user-wide, not tied to a single site.
const accountNavigation = [
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { name: 'Plugins', href: '/dashboard/plugins', icon: Puzzle },
  { name: 'Collaborate', href: '/dashboard/collaborate', icon: Users },
  { name: 'My Classes', href: '/dashboard/classes', icon: GraduationCap },
  { name: 'Billing', href: '/dashboard/billing', icon: CreditCard },
]

// Student navigation items
const studentNavigation = [
  { name: 'My Classes', href: '/dashboard/my-classes', icon: GraduationCap },
  { name: 'My Exams', href: '/dashboard/my-exams', icon: ClipboardCheck },
  { name: 'My Snaps', href: '/dashboard/my-snaps', icon: Camera },
  { name: 'Profile', href: '/dashboard/profile', icon: User },
]

// Organization navigation items (relative to org)
const orgNavigationItems = [
  { name: 'Page Builder', suffix: '/page-builder', icon: BookOpen },
  { name: 'Settings', suffix: '/settings', icon: Settings },
  { name: 'Members', suffix: '/members', icon: Users },
  { name: 'Domains', suffix: '/domains', icon: Globe },
]

interface OrgWithRole {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member'
}

interface UserSite {
  id: string
  slug: string
  pageName: string | null
  pageIcon: string | null
  order: number
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
  const [lastTeacherPage, setLastTeacherPage] = useState<{ slug: string; name: string; pageIcon?: string | null; href?: string } | null>(null)
  const [adminOrgs, setAdminOrgs] = useState<OrgWithRole[]>([])
  const [sites, setSites] = useState<UserSite[]>([])

  // Determine which navigation to show based on account type
  const isStudent = session?.user?.accountType === 'student'
  const isTeacher = session?.user?.accountType === 'teacher'
  const isFreePlan = !session?.user?.isAdmin && (session?.user?.billingPlan === 'free' || !session?.user?.billingPlan)

  // Read localStorage immediately on mount — don't wait for session.
  // The render condition still gates on isStudent, but this way the data
  // is ready as soon as the session confirms the user is a student.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('lastTeacherPage')
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLastTeacherPage(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

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

    // Allow other components to trigger a sidebar refresh
    const handler = () => fetchOrgs()
    window.addEventListener('sidebar:refresh', handler)
    return () => window.removeEventListener('sidebar:refresh', handler)
  }, [isTeacher, session?.user?.id])

  // Fetch the teacher's own sites (usually one; superadmin can grant more).
  useEffect(() => {
    if (!isTeacher || !session?.user?.id) return

    const fetchSites = async () => {
      try {
        const response = await fetch('/api/user/sites')
        if (response.ok) {
          const data = await response.json()
          setSites(data.sites ?? [])
        }
      } catch {
        // Silently fail — site nav is best-effort.
      }
    }

    fetchSites()
    const handler = () => fetchSites()
    window.addEventListener('sidebar:refresh', handler)
    return () => window.removeEventListener('sidebar:refresh', handler)
  }, [isTeacher, session?.user?.id])

  // Get user's display name
  const userName = session?.user?.name || 'My Account'

  return (
    <div className={cn(
      "bg-card border-r border-border h-full transition-all duration-300 flex flex-col",
      isCollapsed ? "w-16 min-w-16" : "w-64"
    )}>
      <div className="p-4 flex-1 flex flex-col">
        {/* Top bar: back link (students) + collapse toggle.
            Expanded: row with back link left, chevron right.
            Collapsed (with back link): column with chevron on top, back icon below. */}
        <div className={cn(
          "mb-4 flex items-center",
          isCollapsed && isStudent && lastTeacherPage
            ? "flex-col gap-2"
            : "justify-between"
        )}>
          {isStudent && lastTeacherPage ? (
            <Link
              href={lastTeacherPage.href || `/${lastTeacherPage.slug}`}
              className={cn(
                'flex items-center px-2 py-1 text-sm rounded-lg transition-colors',
                'text-muted-foreground hover:bg-muted hover:text-foreground',
                isCollapsed ? 'justify-center order-last' : 'gap-3'
              )}
              title={`Back to ${lastTeacherPage.name}`}
            >
              <CornerUpLeft className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span className="truncate max-w-36">Back to {lastTeacherPage.name}</span>}
            </Link>
          ) : (
            <div />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "p-2",
              isCollapsed && isStudent && lastTeacherPage ? "order-first" : ""
            )}
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

          {/* Teacher Navigation (hidden for eduadmin default account).
              Stacking order: one block per site → orgs → account → admin. */}
          {isTeacher && session?.user?.pageSlug !== 'eduadmin' && (
            <>
              {/* Per-site blocks. A teacher normally has exactly one; extra
                  sites are superadmin-granted and stack below it. Falls back to
                  a single legacy block if the sites fetch hasn't resolved. */}
              {sites.length > 0 ? (
                sites.map((site) => (
                  <div key={site.id} className="mb-2">
                    <SectionHeader title={site.pageName || site.slug} isCollapsed={isCollapsed} />
                    {siteNavItems.map((item) => {
                      const Icon = item.icon
                      const href = `/dashboard/site/${site.id}${item.suffix}`
                      const isActive = pathname === href ||
                        (item.suffix === '/page-builder' &&
                          site.order === 0 &&
                          (pathname === '/dashboard' || pathname === '/dashboard/page-builder'))

                      return (
                        <Link
                          key={`${site.id}-${item.name}`}
                          href={href}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            isCollapsed ? 'justify-center px-2' : ''
                          )}
                          title={isCollapsed ? `${site.pageName || site.slug} · ${item.name}` : undefined}
                        >
                          <Icon className="w-5 h-5" />
                          {!isCollapsed && <span>{item.name}</span>}
                        </Link>
                      )
                    })}
                  </div>
                ))
              ) : (
                <div className="mb-2">
                  <SectionHeader title={userName} isCollapsed={isCollapsed} />
                  <Link
                    href="/dashboard/page-builder"
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                      pathname === '/dashboard/page-builder' || pathname === '/dashboard'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed ? 'justify-center px-2' : ''
                    )}
                    title={isCollapsed ? 'Page Builder' : undefined}
                  >
                    <BookOpen className="w-5 h-5" />
                    {!isCollapsed && <span>Page Builder</span>}
                  </Link>
                </div>
              )}
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

          {/* Account Section (user-wide teacher items, hidden for eduadmin) */}
          {isTeacher && session?.user?.pageSlug !== 'eduadmin' && (
            <div className="mt-6">
              <SectionHeader title="Account" isCollapsed={isCollapsed} />
              {accountNavigation.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                // Classes (student management) is paid; everything else is free.
                const gatedPaths = ['/dashboard/classes']
                const isGated = isFreePlan && gatedPaths.includes(item.href)

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : isGated
                          ? 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed ? 'justify-center px-2' : ''
                    )}
                    title={isCollapsed ? item.name : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    {!isCollapsed && (
                      <span className="flex items-center gap-2">
                        {item.name}
                        {isGated && <Lock className="w-3 h-3" />}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}

          {/* Admin Section (only visible to admins) */}
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
              <Link
                href="/dashboard/admin/plans"
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                  pathname === '/dashboard/admin/plans'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isCollapsed ? 'justify-center px-2' : ''
                )}
                title={isCollapsed ? 'Subscription Plans' : undefined}
              >
                <Tag className="w-5 h-5" />
                {!isCollapsed && <span>Subscription Plans</span>}
              </Link>
              <Link
                href="/dashboard/admin/metrics"
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                  pathname === '/dashboard/admin/metrics'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isCollapsed ? 'justify-center px-2' : ''
                )}
                title={isCollapsed ? 'Metrics' : undefined}
              >
                <BarChart3 className="w-5 h-5" />
                {!isCollapsed && <span>Metrics</span>}
              </Link>
            </div>
          )}
        </nav>

        {/* Legal links - bottom of sidebar */}
        {!isCollapsed && (
          <div className="px-3 py-3 text-center text-[11px] text-muted-foreground/40">
            <Link href="/impressum" className="hover:text-muted-foreground">Legal</Link>
            <span className="mx-1.5">·</span>
            <Link href="/terms" className="hover:text-muted-foreground">Terms (Mar 2026)</Link>
          </div>
        )}
      </div>
    </div>
  )
}
