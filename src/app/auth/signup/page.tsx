'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignUpPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    pageSlug: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showVerificationMessage, setShowVerificationMessage] = useState(false)
  const router = useRouter()

  const handleOAuthSignUp = (provider: string) => {
    // Clear the student cookie to ensure this is a teacher signup
    document.cookie = 'oauth_from_teacher_page=; path=/; max-age=0'
    signIn(provider, { callbackUrl: '/dashboard' })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          pageSlug: formData.pageSlug
        })
      })

      const data = await response.json()
      
      if (response.ok) {
        if (data.requiresEmailVerification) {
          setSuccess(data.message)
          setShowVerificationMessage(true)
        } else {
          router.push('/auth/signin?message=Account created successfully')
        }
      } else {
        setError(data.error || 'An error occurred')
      }
    } catch {
      setError('An error occurred. Please try again.')
    }

    setIsLoading(false)
  }

  const handleResendVerification = async () => {
    setIsLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email })
      })

      const data = await response.json()
      
      if (response.ok) {
        setSuccess('Verification email sent successfully!')
      } else {
        setError(data.error || 'Failed to resend verification email')
      }
    } catch {
      setError('Failed to resend verification email. Please try again.')
    }

    setIsLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">Create Teacher Account</CardTitle>
          <CardDescription className="text-center">
            Create your teacher account to start building educational content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showVerificationMessage ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Check Your Email</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                We&apos;ve sent a verification link to <strong>{formData.email}</strong>. 
                Please check your email and click the link to verify your account.
              </p>
              
              {success && (
                <div className="text-green-600 text-sm mb-4">{success}</div>
              )}
              {error && (
                <div className="text-red-600 text-sm mb-4">{error}</div>
              )}
              
              <div className="space-y-2">
                <Button 
                  onClick={handleResendVerification}
                  variant="outline"
                  className="w-full" 
                  disabled={isLoading}
                >
                  {isLoading ? 'Sending...' : 'Resend Verification Email'}
                </Button>
                
                <Link
                  href="/auth/signin"
                  className="inline-flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* OAuth Providers */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleOAuthSignUp('azure-ad')}
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

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or sign up with email
                  </span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Enter your full name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pageSlug">Page URL</Label>
                <Input
                  id="pageSlug"
                  name="pageSlug"
                  type="text"
                  placeholder="your-page-name"
                  value={formData.pageSlug}
                  onChange={handleChange}
                />
                <p className="text-sm text-gray-500">
                  Your page URL: eduskript.org/{formData.pageSlug || 'your-page-name'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
              {error && (
                <div className="text-red-600 text-sm text-center">{error}</div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </Button>
              </form>
            </>
          )}
          
          <div className="mt-6 text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Already have an account?{' '}
            </span>
            <Link
              href="/auth/signin"
              className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}