'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronRight, NotebookPen, ShieldCheck } from 'lucide-react'

interface SignInFormProps {
  context: {
    type: 'teacher-page' | 'org-page'
    slug: string
    name: string
    icon?: string | null
  }
  callbackUrl?: string
}

function MicrosoftIcon() {
  return (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h10.87v10.87H0z" fill="#f25022"/>
      <path d="M12.13 0H23v10.87H12.13z" fill="#00a4ef"/>
      <path d="M0 12.13h10.87V23H0z" fill="#7fba00"/>
      <path d="M12.13 12.13H23V23H12.13z" fill="#ffb900"/>
    </svg>
  )
}

function BrandingHeader({ context }: { context: SignInFormProps['context'] }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-2">
      {context.icon && context.icon !== 'default' ? (
        <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-background">
          <Image src={context.icon} alt="" fill className="object-cover" />
        </div>
      ) : (
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <NotebookPen className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <span className="text-xl font-bold text-foreground truncate">{context.name}</span>
    </div>
  )
}

/**
 * Credentials form for teacher email/password login.
 * Used in both layouts (collapsed on teacher pages, inline on org pages).
 */
function CredentialsForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResendVerification, setShowResendVerification] = useState(false)
  const [resendSuccess, setResendSuccess] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setResendSuccess('')
    setShowResendVerification(false)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        if (result.error.includes('verify your email')) {
          setError('You need to verify your email before you can log in.')
          setShowResendVerification(true)
        } else if (result.error.includes('Invalid credentials')) {
          setError('Invalid email or password. Please try again.')
        } else {
          setError(result.error || 'An error occurred. Please try again.')
        }
      } else if (result?.ok) {
        router.push(callbackUrl)
      } else {
        setError('Authentication failed. Please try again.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    }

    setIsLoading(false)
  }

  const handleResendVerification = async () => {
    setIsLoading(true)
    setResendSuccess('')
    setError('')

    try {
      const response = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const data = await response.json()

      if (response.ok) {
        setResendSuccess('Verification email sent successfully! Please check your inbox.')
      } else {
        setError(data.error || 'Failed to resend verification email')
      }
    } catch {
      setError('Failed to resend verification email. Please try again.')
    }

    setIsLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="teacher@school.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isLoading}
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {showResendVerification && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleResendVerification}
          disabled={isLoading}
        >
          Resend Verification Email
        </Button>
      )}

      {resendSuccess && (
        <div className="text-sm text-green-600 dark:text-green-400">{resendSuccess}</div>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Signing in...' : 'Sign In'}
      </Button>
    </form>
  )
}

export function SignInForm({ context, callbackUrl = '/dashboard' }: SignInFormProps) {
  const [showCredentialsForm, setShowCredentialsForm] = useState(false)

  const setCookie = (value: string) => {
    document.cookie = `eduskript-signup-context=${encodeURIComponent(value)}; path=/; max-age=600; SameSite=Lax`
  }

  /**
   * Teacher page layout: student-focused sign-in.
   * OAuth always creates student accounts. Collapsed credentials form for teachers.
   */
  if (context.type === 'teacher-page') {
    const handleStudentOAuth = (provider: string) => {
      setCookie(`student:${context.slug}`)
      signIn(provider, { callbackUrl })
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-3">
            <BrandingHeader context={context} />
            <CardTitle className="text-2xl text-center">Sign In</CardTitle>
            <CardDescription className="text-center">
              Sign in to access this content
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Primary: Student OAuth sign-in */}
            <div className="space-y-3 mb-6">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleStudentOAuth('azure-ad')}
              >
                <MicrosoftIcon />
                Sign in with Microsoft
              </Button>
            </div>

            {/* Privacy note */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground mb-4">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Your privacy is our priority. Student accounts use pseudonymous identifiers.</span>
            </div>

            {/* Collapsed: Teacher credentials login */}
            {!showCredentialsForm ? (
              <button
                type="button"
                onClick={() => setShowCredentialsForm(true)}
                className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-2"
              >
                Sign in with email (page editors)
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Email sign in (page editors)
                    </span>
                  </div>
                </div>
                <CredentialsForm callbackUrl={callbackUrl} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  /**
   * Org page layout: two columns — "For Teachers" and "For Students".
   * Teachers get OAuth + credentials + signup link.
   * Students get OAuth only.
   */
  const handleTeacherOAuth = (provider: string) => {
    setCookie(`teacher-org:${context.slug}`)
    signIn(provider, { callbackUrl })
  }

  const handleStudentOAuth = (provider: string) => {
    setCookie(`student-org:${context.slug}`)
    signIn(provider, { callbackUrl })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl">
        {/* Branding header */}
        <div className="text-center mb-8">
          <BrandingHeader context={context} />
          <p className="text-muted-foreground mt-2">Sign in to continue</p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: For Teachers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-center">For Teachers</CardTitle>
              <CardDescription className="text-center">
                Create and manage educational content
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleTeacherOAuth('azure-ad')}
              >
                <MicrosoftIcon />
                Sign in with Microsoft
              </Button>

              {/* Expandable credentials form */}
              {!showCredentialsForm ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCredentialsForm(true)}
                    className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1"
                  >
                    Sign in with email
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or with email</span>
                    </div>
                  </div>
                  <CredentialsForm callbackUrl={callbackUrl} />
                </>
              )}

              <div className="text-center text-sm">
                <span className="text-muted-foreground">New teacher? </span>
                <Link href="/auth/signup" className="text-primary hover:underline">
                  Create account
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Right: For Students */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-center">For Students</CardTitle>
              <CardDescription className="text-center">
                Access learning materials
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleStudentOAuth('azure-ad')}
              >
                <MicrosoftIcon />
                Sign in with Microsoft
              </Button>

              <div className="flex items-start gap-2 text-xs text-muted-foreground mt-4">
                <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Student accounts use pseudonymous identifiers to protect your privacy.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
