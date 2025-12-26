'use client'

import Link from 'next/link'
import { Globe, Settings, Users } from 'lucide-react'

export type OrgNavTab = 'settings' | 'members' | 'teacher-domains'

export function OrgNav({ orgId, active }: { orgId: string; active: OrgNavTab }) {
  return (
    <div className="flex gap-1 border-b mb-6">
      <Link
        href={`/dashboard/org/${orgId}/settings`}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          active === 'settings'
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Settings className="h-4 w-4" />
        Settings
      </Link>
      <Link
        href={`/dashboard/org/${orgId}/members`}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          active === 'members'
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Users className="h-4 w-4" />
        Members
      </Link>
      <Link
        href={`/dashboard/org/${orgId}/teacher-domains`}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          active === 'teacher-domains'
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Globe className="h-4 w-4" />
        Teacher Domains
      </Link>
    </div>
  )
}
