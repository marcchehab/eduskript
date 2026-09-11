'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

export default function ConsentPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [hasConsented, setHasConsented] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Only students need to give consent
    if (session?.user?.accountType === 'teacher') {
      router.push('/dashboard')
      return
    }

    // If student already gave consent, redirect to dashboard
    if (session?.user?.accountType === 'student' && session?.user?.studentPseudonym) {
      // Check if they already gave consent by checking the database
      fetch('/api/user/consent-status')
        .then(res => res.json())
        .then(data => {
          if (data.hasConsented) {
            router.push('/dashboard')
          }
        })
        .catch(() => {
          // Ignore errors, show consent page
        })
    }
  }, [session, router])

  const handleConsent = async () => {
    if (!hasConsented) {
      setError('Please check the box to continue')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/user/give-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to record consent')
      }

      // Update session to reflect consent
      await update()

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Privacy & Data Protection</CardTitle>
          <CardDescription>
            Welcome! Before you continue, please read and accept our data handling practices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-base mb-2">What data we collect:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Your progress through learning materials (which pages you&apos;ve viewed and completed)</li>
                <li>Your submissions for assignments and quizzes</li>
                <li>Timestamps of when you access the platform</li>
                <li>Your pseudonymous identifier (not your real email or name)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-base mb-2">What we DO NOT store:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Your real email address or full name</li>
                <li>Your profile picture or any identifying information</li>
                <li>Your browsing history outside this platform</li>
                <li>Any personal information beyond what&apos;s necessary for learning</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-base mb-2">Your rights:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li><strong>Right to Access:</strong> You can download all your data at any time</li>
                <li><strong>Right to Deletion:</strong> You can delete your account and all associated data</li>
                <li><strong>Right to Portability:</strong> Your data is exportable in standard JSON format</li>
                <li><strong>Right to Withdraw Consent:</strong> You can delete your account at any time</li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
              <h3 className="font-semibold text-base mb-2">How we protect your privacy:</h3>
              <p className="text-muted-foreground">
                Your account uses a <strong>pseudonymous identifier</strong> instead of your real email.
                This means even if someone gained access to our database, they could not identify you
                without additional information. Your teacher can verify your identity by providing your
                email, but your email is never stored or visible to anyone on the platform.
              </p>
            </div>
          </div>

          <div className="border-t pt-6">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="consent"
                checked={hasConsented}
                onCheckedChange={(checked) => setHasConsented(checked as boolean)}
              />
              <div className="flex-1">
                <Label htmlFor="consent" className="text-sm font-medium cursor-pointer">
                  I understand and consent to the collection and processing of my data as described above.
                  I acknowledge that I am using this platform for educational purposes and that my progress
                  and submissions will be tracked to support my learning.
                </Label>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          <div className="flex gap-4">
            <Button
              onClick={handleConsent}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? 'Processing...' : 'I Consent - Continue to Dashboard'}
            </Button>
          </div>

          <div className="text-xs text-center text-muted-foreground">
            By continuing, you agree to our{' '}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
