import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const useSession = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSession() }))

import { NewsletterBox, newsletterVariant } from '@/components/markdown/newsletter-box'

describe('newsletterVariant', () => {
  it('hides while the session loads', () => {
    expect(newsletterVariant({ status: 'loading', enabled: null })).toBe('hidden')
  })
  it('shows the email form to visitors without a session', () => {
    expect(newsletterVariant({ status: 'unauthenticated', enabled: null })).toBe('guest')
  })
  it('hides for students', () => {
    expect(newsletterVariant({ status: 'authenticated', accountType: 'student', enabled: false })).toBe('hidden')
  })
  it('offers the enable button to teachers who have not opted in', () => {
    expect(newsletterVariant({ status: 'authenticated', accountType: 'teacher', enabled: false })).toBe('enable')
  })
  it('hides for opted-in teachers and while their flag is unknown', () => {
    expect(newsletterVariant({ status: 'authenticated', accountType: 'teacher', enabled: true })).toBe('hidden')
    expect(newsletterVariant({ status: 'authenticated', accountType: 'teacher', enabled: null })).toBe('hidden')
  })
})

describe('<NewsletterBox>', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSession.mockReset()
  })

  it('renders a German email form for guests on a German site', () => {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(<NewsletterBox lang="de-CH" />)
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeInTheDocument()
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeInTheDocument()
  })

  it('renders nothing for students', () => {
    useSession.mockReturnValue({ data: { user: { accountType: 'student' } }, status: 'authenticated' })
    const { container } = render(<NewsletterBox />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the enable button to a teacher who has not opted in', async () => {
    useSession.mockReturnValue({ data: { user: { accountType: 'teacher' } }, status: 'authenticated' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ enabled: false })))
    render(<NewsletterBox />)
    expect(await screen.findByRole('button', { name: 'Enable product updates' })).toBeInTheDocument()
  })

  it('renders nothing for a teacher who already opted in', async () => {
    useSession.mockReturnValue({ data: { user: { accountType: 'teacher' } }, status: 'authenticated' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ enabled: true })))
    const { container } = render(<NewsletterBox />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/product-updates'))
    expect(container).toBeEmptyDOMElement()
  })
})
