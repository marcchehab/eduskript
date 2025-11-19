'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface SignInFormProps {
  accountType: 'teacher' | 'student'
  callbackUrl?: string
}

export function SignInForm({ accountType, callbackUrl = '/dashboard' }: SignInFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResendVerification, setShowResendVerification] = useState(false)
  const [resendSuccess, setResendSuccess] = useState('')
  const router = useRouter()

  const isTeacher = accountType === 'teacher'
  const isStudent = accountType === 'student'

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
    // First, set the account type on the server
    const accountSuffix = isTeacher ? 'teacher' : 'student'
    await fetch(`/api/auth/set-signup-type?type=${accountSuffix}`)

    // Then trigger the OAuth flow
    signIn(provider, { callbackUrl })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">
            {isTeacher ? 'Teacher Sign In' : 'Student Sign In'}
          </CardTitle>
          <CardDescription className="text-center">
            {isTeacher
              ? 'If you are a teacher, sign in here to access your account'
              : 'Sign in with your school account. Your privacy is protected - your email will not be stored.'}
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

            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOAuthSignIn('google')}
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </Button>
          </div>

          {/* Only show credentials login for teachers */}
          {isTeacher && (
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
                <Link href="/auth/signup?type=teacher" className="text-primary hover:underline">
                  Sign up
                </Link>
              </div>
            </>
          )}

          {/* Privacy message for students */}
          {isStudent && (
            <div className="text-xs text-center text-muted-foreground mt-4">
              Your privacy is our priority. We use a pseudonymous identifier instead of your real email address.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
