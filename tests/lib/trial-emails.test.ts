import { describe, it, expect } from 'vitest'
import { firstNameOf, renderTrialEmail } from '@/lib/trial-emails'

const ctx = {
  firstName: 'Anna',
  trialEnd: new Date('2026-10-05T10:00:00Z'),
  daysLeft: 5,
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
    expect(mail.textContent).toContain('Hallo Anna,')
    expect(mail.textContent).toContain('bis am 5. Oktober')
    expect(mail.textContent).toContain('CHF 79 im Jahr (rund CHF 6.60 pro Monat) oder CHF 9 monatlich')
    expect(mail.htmlContent).toContain('https://eduskript.org/dashboard/billing')
    expect(mail.textContent).not.toContain('ß')
  })

  it('renders the ended mail and escapes the name in HTML', () => {
    const mail = renderTrialEmail('ended', { ...ctx, firstName: '<b>X</b>' })
    expect(mail.htmlContent).toContain('Hallo &lt;b&gt;X&lt;/b&gt;,')
    expect(mail.subject).toContain('deine Seiten bleiben online')
  })

  it('omits the price sentence gracefully without plans', () => {
    const mail = renderTrialEmail('ending', { ...ctx, prices: {} })
    expect(mail.textContent).toContain('Mit Classroom behältst du alles.')
  })
})
