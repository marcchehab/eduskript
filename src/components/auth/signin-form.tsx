'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronRight } from 'lucide-react'

interface SignInFormProps {
  fromTeacherPage?: string
  callbackUrl?: string
}

export function SignInForm({ fromTeacherPage, callbackUrl = '/dashboard' }: SignInFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResendVerification, setShowResendVerification] = useState(false)
  const [resendSuccess, setResendSuccess] = useState('')
  const [showCredentialsForm, setShowCredentialsForm] = useState(false)
  const router = useRouter()

  // If fromTeacherPage is set, user is coming from a teacher's page (could be student or teacher)
  // If not set, user is coming from main site (teacher-only)
  const isFromTeacherPage = !!fromTeacherPage

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

  const handleOAuthSignIn = async (provider: string) => {
    // Set cookie to track if this is a student signup (from teacher page)
    // This cookie is read by auth.ts to determine account type for new OAuth users
    if (fromTeacherPage) {
      document.cookie = `oauth_from_teacher_page=${encodeURIComponent(fromTeacherPage)}; path=/; max-age=600; samesite=lax`
    } else {
      // Clear cookie if signing in from main site
      document.cookie = 'oauth_from_teacher_page=; path=/; max-age=0'
    }

    signIn(provider, { callbackUrl })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">
            {isFromTeacherPage ? 'Sign In' : 'Sign into your teacher account'}
          </CardTitle>
          <CardDescription className="text-center">
            {isFromTeacherPage
              ? 'Sign in to access this content'
              : 'Sign in to manage your educational content'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* OAuth Providers */}
          <div className="space-y-3 mb-6">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOAuthSignIn('azure-ad')}
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0h10.87v10.87H0z" fill="#f25022"/>
                <path d="M12.13 0H23v10.87H12.13z" fill="#00a4ef"/>
                <path d="M0 12.13h10.87V23H0z" fill="#7fba00"/>
                <path d="M12.13 12.13H23V23H12.13z" fill="#ffb900"/>
              </svg>
              Continue with Microsoft
            </Button>
          </div>

          {/* Main site: show credentials form directly */}
          {!isFromTeacherPage && (
            <>
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or continue with email
                  </span>
                </div>
              </div>

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
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </div>
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
                  <div className="text-sm text-green-600 dark:text-green-400">
                    {resendSuccess}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              <div className="mt-4 text-center text-sm">
                <span className="text-muted-foreground">Don&apos;t have an account? </span>
                <Link href="/auth/signup" className="text-primary hover:underline">
                  Sign up
                </Link>
              </div>
            </>
          )}

          {/* Teacher page: collapsed credentials form */}
          {isFromTeacherPage && (
            <>
              {!showCredentialsForm ? (
                <button
                  type="button"
                  onClick={() => setShowCredentialsForm(true)}
                  className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-2"
                >
                  Sign in with email (teachers only)
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
                        Email sign in (teachers only)
                      </span>
                    </div>
                  </div>

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
                      <div className="text-sm text-red-600 dark:text-red-400">
                        {error}
                      </div>
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
                      <div className="text-sm text-green-600 dark:text-green-400">
                        {resendSuccess}
                      </div>
                    )}

                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? 'Signing in...' : 'Sign In'}
                    </Button>
                  </form>
                </>
              )}

              {/* Privacy message for students */}
              <div className="text-xs text-center text-muted-foreground mt-4">
                Your privacy is our priority. Student accounts use pseudonymous identifiers.
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
