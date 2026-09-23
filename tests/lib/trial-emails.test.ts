import { describe, it, expect } from 'vitest'
import { firstNameOf, renderTrialEmail } from '@/lib/trial-emails'

const ctx = {
  firstName: 'Anna',
  trialEnd: new Date('2026-10-05T10:00:00Z'),
  daysLeft: 5,
  trialDays: 15,
  prices: { yearly: 7900, monthly: 900 },
  baseUrl: 'https://eduskript.org',
}

describe('trial emails', () => {
  it('derives a first name, or none for titles', () => {
    expect(firstNameOf('Marc Chéhab')).toBe('Marc')
    expect(firstNameOf('Dr. Anna Muster')).toBeNull()
    expect(firstNameOf('  ')).toBeNull()
    expect(firstNameOf(null)).toBeNull()
  })

  it('renders the ending mail with days, date, prices and billing link', () => {
    const mail = renderTrialEmail('ending', ctx)
    expect(mail.subject).toBe('Dein Eduskript-Test läuft noch 5 Tage')
    expect(mail.textContent).toContain('Hallo Anna\n\nDein Test')
    expect(mail.textContent).toContain('bis am 5. Oktober')
    expect(mail.textContent).toContain('CHF 79 im Jahr (rund CHF 6.60 pro Monat) oder CHF 9 monatlich')
    expect(mail.htmlContent).toContain('https://eduskript.org/dashboard/billing')
    expect(mail.textContent).not.toContain('ß')
  })

  it('escapes the name in HTML', () => {
    const mail = renderTrialEmail('ending', { ...ctx, firstName: '<b>X</b>' })
    expect(mail.htmlContent).toContain('Hallo &lt;b&gt;X&lt;/b&gt;')
  })

  it('omits the price sentence gracefully without plans', () => {
    const mail = renderTrialEmail('ending', { ...ctx, prices: {} })
    expect(mail.textContent).toContain('Mit Classroom behältst du alles.')
  })
  it('renders the welcome mail with plan days, doubled days and a dashboard link', () => {
    const mail = renderTrialEmail('welcome', ctx)
    expect(mail.subject).toBe('Willkommen bei Eduskript')
    expect(mail.textContent).toContain('verdoppelt sich deine Testzeit auf 30 Tage')
    expect(mail.textContent).toContain('Du hast jetzt 15 Tage lang alle Funktionen')
    expect(mail.htmlContent).toContain('<a href="https://eduskript.org/dashboard"')
    expect(mail.textContent).toContain('Seiten-Effekte')
  })
  it('renders the tips mail with the classes link', () => {
    const mail = renderTrialEmail('tips', ctx)
    expect(mail.subject).toBe('Dein Skript für die Klasse')
    expect(mail.textContent).toContain('«View Page»')
    expect(mail.htmlContent).toContain('https://eduskript.org/dashboard/classes')
  })
})
