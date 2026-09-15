/**
 * Plan marketing copy + price helpers, shared by the dashboard billing page
 * (/dashboard/billing, English) and the public `<pricing>` markdown component
 * (components/markdown/pricing-table.tsx, `lang="de"` for German pages).
 *
 * Prices are NOT here: they live in the Plan table and reach the UI via
 * /api/subscriptions (logged in) or /api/plans (public). Only the School
 * licence is a fixed quote, because it's sold by invoice, not through Payrexx.
 *
 * Every "no traps" claim must stay true to the code it describes:
 *   - trial without card / falls back to free: src/lib/trial.ts (no Payrexx
 *     involvement until the user converts; expiry resets billingPlan to free)
 *   - cancel keeps access until period end: /api/subscriptions/cancel
 *   - students never pay: src/lib/billing.ts isPaidUser
 *   - export as Markdown + attachments (ZIP), paid only: /api/export
 */

export type PlanCopyLang = 'en' | 'de'

export interface PublicPlan {
  slug: string
  name: string
  priceChf: number
  interval: string
  trialDays: number | null
  isDefaultTrial: boolean
}

export const SCHOOL_PRICE_PER_TEACHER_CHF = 59
export const SCHOOL_MIN_TEACHERS = 5
const SCHOOL_CONTACT_EMAIL = 'marc@informatikgarten.ch'
/** Fallback when no plan carries trialDays (mirrors src/lib/trial.ts). */
export const DEFAULT_TRIAL_DAYS = 14

export const PLAN_COPY = {
  en: {
    free: {
      name: 'Free',
      period: 'forever',
      tagline: 'Write and publish without limits.',
      features: [
        'Unlimited skripts & pages',
        'Full markdown editor, math & code editors',
        'File & media uploads',
        'Your public teacher page',
      ],
    },
    classroom: {
      name: 'Classroom',
      badge: 'Recommended',
      features: [
        'AI editing',
        'Classes with live student progress',
        'Exams with Safe Exam Browser (SEB)',
        'SEB-Lockdown mode in class',
        'AI-assisted grading with rubrics',
        'Broadcast your annotations to students',
        'Create your own plugins with AI',
      ],
    },
    supporter: {
      name: 'Supporter',
      tagline: 'For teachers who want Eduskript to exist.',
      features: ['Everything in Classroom', 'Supporter badge on your public page'],
    },
    school: {
      name: 'School',
      price: `CHF ${SCHOOL_PRICE_PER_TEACHER_CHF} per teacher / year, from ${SCHOOL_MIN_TEACHERS} teachers`,
      features: [
        'Classroom for your whole team',
        'Billing by invoice — no credit card',
        'Admin overview',
        'Priority support',
      ],
      contact: 'Contact us',
      mailto: `mailto:${SCHOOL_CONTACT_EMAIL}?subject=${encodeURIComponent('Eduskript School licence')}`,
    },
    perYear: 'year',
    perMonth: 'per month',
    orMonthly: (price: string) => `or ${price} monthly`,
    guaranteesTitle: 'No traps, no lock-in',
    guarantees: (trialDays: number) => [
      `${trialDays} days of every feature to try — no credit card`,
      'When the trial ends you drop to Free automatically — nothing is charged',
      'Cancel any time; you keep access until the end of the period you paid for',
      'Your skripts and public page stay online on the Free plan',
      'Export all your skripts as Markdown files with attachments (ZIP, with Classroom)',
      'Students never pay',
    ],
  },
  de: {
    free: {
      name: 'Gratis',
      period: 'für immer',
      tagline: 'Schreiben und veröffentlichen ohne Limit.',
      features: [
        'Unbegrenzt Skripts und Seiten',
        'Voller Editor mit Formeln, Code und Plots',
        'Uploads von Dateien und Medien',
        'Deine eigene öffentliche Seite',
      ],
    },
    classroom: {
      name: 'Classroom',
      badge: 'Empfohlen',
      features: [
        'Bearbeiten mit KI',
        'Klassen mit Live-Fortschritt der Schülerinnen und Schüler',
        'Prüfungen im Safe Exam Browser (SEB)',
        'SEB-Sperrmodus im Unterricht',
        'KI-gestützte Korrektur mit Bewertungsraster',
        'Deine Annotationen live an die Klasse senden',
        'Eigene Plugins mit KI erstellen',
      ],
    },
    supporter: {
      name: 'Supporter',
      tagline: 'Für Lehrpersonen, die wollen, dass es Eduskript gibt.',
      features: ['Alles aus Classroom', 'Supporter-Abzeichen auf deiner öffentlichen Seite'],
    },
    school: {
      name: 'Schule',
      price: `CHF ${SCHOOL_PRICE_PER_TEACHER_CHF} pro Lehrperson und Jahr, ab ${SCHOOL_MIN_TEACHERS} Lehrpersonen`,
      features: [
        'Classroom für das ganze Team',
        'Bezahlung per Rechnung, ohne Kreditkarte',
        'Admin-Übersicht',
        'Bevorzugter Support',
      ],
      contact: 'Kontakt aufnehmen',
      mailto: `mailto:${SCHOOL_CONTACT_EMAIL}?subject=${encodeURIComponent('Eduskript Schullizenz')}`,
    },
    perYear: 'Jahr',
    perMonth: 'pro Monat',
    orMonthly: (price: string) => `oder ${price} monatlich`,
    guaranteesTitle: 'Keine Fallen, kein Lock-in',
    guarantees: (trialDays: number) => [
      `${trialDays} Tage alle Funktionen testen – ohne Kreditkarte`,
      'Nach dem Test läufst du automatisch im Gratis-Plan weiter, es wird nichts abgebucht',
      'Jederzeit kündbar; der Zugang bleibt bis zum Ende der bezahlten Periode',
      'Deine Skripts und deine öffentliche Seite bleiben auch im Gratis-Plan online',
      'Alle Skripts als Markdown-Dateien samt Anhängen exportieren (ZIP, mit Classroom)',
      'Schülerinnen und Schüler zahlen nie',
    ],
  },
} as const

/** Rappen → "CHF 79" / "CHF 6.60". */
export function formatChf(rappen: number): string {
  const chf = rappen / 100
  return Number.isInteger(chf) ? `CHF ${chf}` : `CHF ${chf.toFixed(2)}`
}

/** Yearly price per month, rounded to 10 Rappen (7900 → 660). */
export function monthlyEquivalent(yearlyRappen: number): number {
  return Math.round(yearlyRappen / 12 / 10) * 10
}

/**
 * Picks the plans the pricing UI knows by slug. Anything else (legacy plans)
 * is ignored here; the billing page still renders those as generic cards.
 */
export function pickPlans(plans: PublicPlan[]) {
  const trialPlan = plans.find((p) => p.isDefaultTrial)
  return {
    classroomYearly: plans.find((p) => p.slug === 'classroom-yearly'),
    classroomMonthly: plans.find((p) => p.slug === 'classroom-monthly'),
    supporter: plans.find((p) => p.slug.startsWith('supporter')),
    trialDays: trialPlan?.trialDays ?? DEFAULT_TRIAL_DAYS,
  }
}
