import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Logged-out student on a class invite link: "Sign In to Join" must lead to an
// existing sign-in route and come back to the invite page afterwards.
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useParams: () => ({ inviteCode: 'abc123' }),
  usePathname: () => '/classes/join/abc123',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

import JoinClassPage from '@/app/(app)/classes/join/[inviteCode]/page'

beforeEach(() => {
  push.mockReset()
  window.history.pushState({}, '', '/classes/join/abc123')
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      class: { name: '3b', description: null, teacherName: 'T', memberCount: 0, allowAnonymous: true },
      isPreAuthorized: false,
      isAlreadyMember: false,
    }),
  }) as unknown as typeof fetch
})

describe('JoinClassPage sign-in redirect', () => {
  it('sends logged-out users to /auth/signin with a callback to the invite page', async () => {
    render(<JoinClassPage />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in to join/i }))
    expect(push).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fclasses%2Fjoin%2Fabc123')
  })
})
