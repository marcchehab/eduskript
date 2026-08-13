'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { LayoutProvider } from '@/contexts/layout-context'
import { UserDataProvider } from '@/lib/userdata/provider'
import { ClassInvitationModal } from '@/components/class-invitation-modal'
import { NicknameModalGate } from '@/components/onboarding/nickname-modal-gate'
import { OnboardingQuestGate } from '@/components/onboarding/quest-gate'

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
            <NicknameModalGate />
            <OnboardingQuestGate />
            {children}
          </LayoutProvider>
        </UserDataProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
