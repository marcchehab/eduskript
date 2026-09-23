'use client'

/**
 * Full-page paywall card for paid-only dashboard routes. Bilingual (German
 * default, flag switcher) like the other paywall hints — see
 * src/lib/i18n/locale.ts and PAYWALL_COPY below.
 */
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'
import { UiLocaleSwitcher, useUiLocale } from '@/lib/i18n/client'
import type { UiLocale } from '@/lib/i18n/locale'

export type PaidFeature = 'frontpage' | 'classes'

const FEATURE_NAMES: Record<UiLocale, Record<PaidFeature, string>> = {
  de: { frontpage: 'das Bearbeiten der Titelseite', classes: 'die Klassenverwaltung' },
  en: { frontpage: 'front page editing', classes: 'class management' },
}

// Shared by the inline paywall hints (plugins, Excalidraw, AI Edit button).
export const PAYWALL_COPY = {
  de: {
    title: 'Mit Classroom freischalten',
    body: (feature: string) =>
      `Dein aktueller Plan enthält ${feature} nicht. Mit Classroom ist das dabei.`,
    cta: 'Pläne ansehen',
    aiPlugins: 'Plugins mit KI erstellen gehört zu Classroom.',
    upgrade: 'Freischalten',
    aiDiagramTitle: 'Diagramme mit KI erstellen gehört zu Classroom. Freischalten unter Billing.',
    aiDiagramLabel: 'Mit KI erstellen (Classroom)',
    aiEditTitle: 'AI Edit gehört zu Classroom. Klicken zum Freischalten.',
  },
  en: {
    title: 'Upgrade Required',
    body: (feature: string) => `Your current plan doesn't include ${feature}. Upgrade to continue.`,
    cta: 'View Plans',
    aiPlugins: 'AI plugin generation is a paid feature.',
    upgrade: 'Upgrade',
    aiDiagramTitle: 'AI generation is a paid feature. Upgrade in Billing.',
    aiDiagramLabel: 'Generate with AI (paid)',
    aiEditTitle: 'AI Edit is a paid feature — click to upgrade',
  },
} as const

export function UpgradePrompt({ feature }: { feature: PaidFeature }) {
  const locale = useUiLocale()
  const t = PAYWALL_COPY[locale]
  return (
    <Card className="max-w-lg mx-auto mt-12 relative">
      <UiLocaleSwitcher className="absolute top-2 right-2" />
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <Lock className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{t.title}</h2>
        <p className="text-muted-foreground">{t.body(FEATURE_NAMES[locale][feature])}</p>
        <Button asChild>
          <Link href="/dashboard/billing">{t.cta}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
