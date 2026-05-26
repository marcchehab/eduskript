import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// vitest 4 + jsdom 27: the `localStorage` getter returns an empty `{}` instead
// of a real Storage object, so any test calling `localStorage.clear()` etc.
// crashes with "not a function". Polyfill a Map-backed Storage once globally
// so all tests see a usable localStorage.
if (typeof window !== 'undefined') {
  const desc = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const broken = !window.localStorage || typeof window.localStorage.clear !== 'function'
  if (broken && desc?.configurable !== false) {
    const store = new Map<string, string>()
    const stub: Storage = {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size },
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: stub })
  }
}

// Clean up after each test
afterEach(() => {
  cleanup()
})

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

// Mock Next.js image
vi.mock('next/image', () => ({
  default: (props: any) => {

    return { ...props, $$typeof: Symbol.for('react.element') }
  },
}))

// Mock Next.js Google fonts. The real loader runs at build time and isn't
// available under vitest, so any module that calls `Inter(...)` etc. hangs
// trying to fetch font assets. Return a minimal shape matching
// `next/font/google` outputs (className, variable, style.fontFamily) for
// every font name we use. Inlined inside the factory because vi.mock is
// hoisted but auxiliary `const`s are not.
vi.mock('next/font/google', () => {
  const mockFont = () => ({
    className: 'mock-font',
    variable: '--mock-font',
    style: { fontFamily: 'mock-font' },
  })
  return {
    Inter: mockFont,
    Roboto_Slab: mockFont,
    EB_Garamond: mockFont,
    Barlow_Condensed: mockFont,
  }
})

// Mock NextAuth
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({
    data: null,
    status: 'unauthenticated',
  })),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock environment variables
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXTAUTH_SECRET = 'test-secret'
process.env.DATABASE_URL = 'file:./test.db'
