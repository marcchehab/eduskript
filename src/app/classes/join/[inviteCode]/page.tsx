'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Users, CheckCircle, AlertCircle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'

interface ClassInfo {
  name: string
  description: string | null
  teacherName: string | null
  memberCount: number
  allowAnonymous: boolean
}

export default function JoinClassPage() {
  const params = useParams()
  const inviteCode = params.inviteCode as string
  const router = useRouter()
  const { data: session } = useSession()

  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null)
  const [isPreAuthorized, setIsPreAuthorized] = useState(false)
  const [isAlreadyMember, setIsAlreadyMember] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [identityConsent, setIdentityConsent] = useState(false)

  const loadClassInfo = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/classes/join/${inviteCode}`)

      if (!response.ok) {
        if (response.status === 404) {
          setError('This invite link is invalid or has expired.')
        } else {
          setError('Failed to load class information.')
        }
        return
      }

      const data = await response.json()
      setClassInfo(data.class)
      setIsPreAuthorized(data.isPreAuthorized)
      setIsAlreadyMember(data.isAlreadyMember)

      // Auto-check consent if pre-authorized or class doesn't allow anonymous
      if (data.isPreAuthorized || !data.class.allowAnonymous) {
        setIdentityConsent(true)
      }
    } catch (err) {
      console.error('Error loading class info:', err)
      setError('Failed to load class information.')
    } finally {
      setLoading(false)
    }
  }, [inviteCode])

  useEffect(() => {
    loadClassInfo()
  }, [loadClassInfo])

  const handleJoinClass = async () => {
    if (!session) {
      // Redirect to student signin with callback to this page
      router.push(`/auth/signin/student?callbackUrl=${encodeURIComponent(window.location.pathname)}`)
      return
    }

    try {
      setJoining(true)
      setError('')

      const response = await fetch(`/api/classes/join/${inviteCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityConsent })
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.requiresPreAuthorization) {
          setError('This class requires your teacher to add your email before you can join.')
        } else if (data.requiresConsent) {
          setError('You must consent to reveal your identity to join this class.')
        } else {
          setError(data.error || 'Failed to join class')
        }
        return
      }

      if (data.alreadyMember) {
        setIsAlreadyMember(true)
      } else {
        setSuccess(true)
      }

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)
    } catch (err) {
      console.error('Error joining class:', err)
      setError('Failed to join class. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  // Determine if user can join
  const canJoin = classInfo && (
    classInfo.allowAnonymous || // Anyone can join anonymous classes
    isPreAuthorized // Pre-authorized students can always join
  )

  // Determine if identity consent is required
  const consentRequired = !!(classInfo && (
    !classInfo.allowAnonymous || // Non-anonymous classes require consent
    isPreAuthorized // Pre-authorized students must consent
  ))

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error && !classInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Invalid Invite Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error}</p>
            <Button
              className="w-full mt-4"
              onClick={() => router.push('/')}
            >
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              Successfully Joined!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You have successfully joined <span className="font-semibold">{classInfo?.name}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting to your dashboard...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isAlreadyMember) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              Already a Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You are already a member of <span className="font-semibold">{classInfo?.name}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting to your dashboard...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Join Class</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join a class
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {classInfo && (
            <div className="space-y-3 p-4 bg-muted rounded-lg">
              <div>
                <h3 className="font-semibold text-lg">{classInfo.name}</h3>
                {classInfo.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {classInfo.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {classInfo.teacherName && (
                  <div>Teacher: {classInfo.teacherName}</div>
                )}
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  <span>{classInfo.memberCount} student{classInfo.memberCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Case: Class doesn't allow anonymous AND student is NOT pre-authorized */}
          {session && classInfo && !classInfo.allowAnonymous && !isPreAuthorized && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-medium text-amber-900 dark:text-amber-100">
                    Teacher approval required
                  </h4>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                    This class requires your teacher to add your email address before you can join.
                  </p>
                </div>
              </div>
              {session.user?.oauthEmail && (
                <div className="pl-8">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Ask your teacher to add: <span className="font-mono font-medium">{session.user.oauthEmail}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Case: Student is pre-authorized */}
          {session && isPreAuthorized && (
            <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-medium text-green-900 dark:text-green-100">
                    Your teacher has added you
                  </h4>
                  <p className="text-sm text-green-800 dark:text-green-200 mt-1">
                    By joining, your teacher will be able to identify you.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Identity consent checkbox (for anonymous classes where consent is optional) */}
          {session && classInfo?.allowAnonymous && !isPreAuthorized && (
            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                id="identityConsent"
                checked={identityConsent}
                onCheckedChange={(checked) => setIdentityConsent(checked === true)}
              />
              <div className="space-y-1">
                <label
                  htmlFor="identityConsent"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Allow teacher to identify me
                </label>
                <p className="text-xs text-muted-foreground">
                  Optional: If checked, your teacher may identify you using your email address.
                </p>
              </div>
            </div>
          )}

          {!session ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You need to be signed in to join this class.
              </p>
              <Button
                className="w-full"
                onClick={handleJoinClass}
              >
                Sign In to Join
              </Button>
            </div>
          ) : canJoin ? (
            <Button
              className="w-full"
              onClick={handleJoinClass}
              disabled={joining || (consentRequired && !identityConsent)}
            >
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                'Join This Class'
              )}
            </Button>
          ) : null}

          {classInfo?.allowAnonymous && !isPreAuthorized && (
            <p className="text-xs text-center text-muted-foreground">
              Your email is never stored. Only a pseudonymous identifier is used to track your progress.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
