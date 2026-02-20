'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { LayoutProvider } from '@/contexts/layout-context'
import { UserDataProvider } from '@/lib/userdata/provider'
import { ClassInvitationModal } from '@/components/class-invitation-modal'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={true}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange={false}
        storageKey="eduskript-theme"
        themes={['light', 'dark', 'system']}
      >
        <UserDataProvider>
          <LayoutProvider>
            <ClassInvitationModal />
            {children}
          </LayoutProvider>
        </UserDataProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
