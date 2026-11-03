'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { LayoutProvider } from '@/contexts/layout-context'
import { UserDataProvider } from '@/lib/userdata/provider'
import { ClassInvitationModal } from '@/components/class-invitation-modal'
import { NicknameModalGate } from '@/components/onboarding/nickname-modal-gate'
import { OnboardingQuestGate } from '@/components/onboarding/quest-gate'
import { HelpVideoWidget } from '@/components/help-video/help-video-widget'
import { SignupAttribution } from '@/components/signup-attribution'
import { usePrintMode } from '@/lib/print/print-mode'

export function Providers({ children }: { children: React.ReactNode }) {
  // The print view is always light (paper), whatever the stored theme. next-themes
  // does not change resolvedTheme for a forced theme; theme-dependent components
  // read `forcedTheme ?? resolvedTheme`.
  const printing = usePrintMode()
  return (
    <SessionProvider refetchOnWindowFocus={true}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange={false}
        storageKey="eduskript-theme"
        themes={['light', 'dark', 'system']}
        forcedTheme={printing ? 'light' : undefined}
      >
        <UserDataProvider>
          <LayoutProvider>
            <ClassInvitationModal />
            <NicknameModalGate />
            <OnboardingQuestGate />
            <HelpVideoWidget />
            <SignupAttribution />
            {children}
          </LayoutProvider>
        </UserDataProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
