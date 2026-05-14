'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { Users, BookOpen, ShieldCheck, LogOut } from 'lucide-react'

interface JoinRequest {
  classId: string
  className: string
  classDescription: string | null
  teacherName: string | null
  inviteCode: string
  allowAnonymous: boolean
  addedAt: string
}

interface StudentClass {
  id: string
  name: string
  description: string | null
  teacherName: string | null
  memberCount: number
  joinedAt: string
}

export default function MyClassesPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [classes, setClasses] = useState<StudentClass[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const alert = useAlertDialog()

  const loadClasses = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/classes/my-classes')

      if (!response.ok) {
        throw new Error('Failed to load classes')
      }

      const data = await response.json()
      setClasses(data.classes)
      const requests = data.joinRequests || []
      setJoinRequests(requests)

      // Update sessionStorage with current invitation status
      const hasPending = requests.length > 0
      sessionStorage.setItem('hasPendingInvitations', String(hasPending))
      // Dispatch event so other components (auth-button, nav, sidebar) update immediately
      window.dispatchEvent(new CustomEvent('invitationStatusChanged', { detail: { hasPending } }))
    } catch (error) {
      console.error('Error loading classes:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'loading') return

    if (!session) {
      router.push('/auth/signin')
      return
    }

    if (session.user?.accountType !== 'student') {
      router.push('/dashboard')
      return
    }

    loadClasses()
  }, [session, status, router, loadClasses])

  // Subscribe to real-time class invitation events
  useRealtimeEvents(
    ['class-invitation'],
    () => {
      // Reload the class list when a new invitation arrives
      loadClasses()
    },
    { enabled: status === 'authenticated' && session?.user?.accountType === 'student' }
  )

  const handleJoinClass = async (inviteCode: string) => {
    try {
      setJoining(inviteCode)

      // Join the class directly with identity consent
      const response = await fetch(`/api/classes/join/${inviteCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityConsent: true })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || 'Failed to join class')
      }

      // Reload classes to show the newly joined class
      await loadClasses()
    } catch (error) {
      console.error('Error joining class:', error)
      alert.showError(error instanceof Error ? error.message : 'Failed to join class')
    } finally {
      setJoining(null)
    }
  }

  const handleLeaveClass = async (classId: string, className: string) => {
    alert.showConfirm(
      `Are you sure you want to leave "${className}"? You may need to be re-invited to rejoin.`,
      async () => {
        try {
          setLeaving(classId)
          const response = await fetch(`/api/classes/${classId}/leave`, {
            method: 'DELETE'
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(errorData.error || 'Failed to leave class')
          }

          // Reload classes to reflect the change
          await loadClasses()
        } catch (error) {
          console.error('Error leaving class:', error)
          alert.showError(error instanceof Error ? error.message : 'Failed to leave class')
        } finally {
          setLeaving(null)
        }
      },
      { destructive: true, title: 'Leave class', confirmText: 'Leave' }
    )
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <p>Loading your classes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">My Classes</h1>
          <p className="text-muted-foreground mt-1">
            Classes you&apos;re enrolled in
          </p>
        </div>

        {/* Join Requests Section */}
        {joinRequests.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-3">Class Invitations</h2>
            <div className="space-y-3">
              {joinRequests.map((request) => (
                <Card key={request.inviteCode} className="border-blue-200 dark:border-blue-900">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-lg mb-1">{request.className}</h3>
                          {request.classDescription && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {request.classDescription}
                            </p>
                          )}
                        </div>
                        {!request.allowAnonymous && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded-md">
                            <ShieldCheck className="w-3 h-3" />
                            Identity required
                          </span>
                        )}
                      </div>
                      <div className="rounded-md p-3 border bg-blue-500/10 border-blue-500/20">
                        <p className="text-sm">
                          Teacher <strong>{request.teacherName}</strong> has asked you to join this class.
                          They will be able to identify you if you join.
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Invited {new Date(request.addedAt).toLocaleDateString()}
                        </p>
                        <Button
                          onClick={() => handleJoinClass(request.inviteCode)}
                          disabled={joining === request.inviteCode}
                        >
                          {joining === request.inviteCode ? 'Joining...' : 'Join Class'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {classes.length === 0 && joinRequests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No classes yet</h3>
              <p className="text-muted-foreground text-center">
                You haven&apos;t joined any classes. Ask your teacher for an invite link to get started.
              </p>
            </CardContent>
          </Card>
        ) : classes.length > 0 && (
          <div className="space-y-4">
            {classes.map((classItem) => (
              <Card key={classItem.id}>
                <CardHeader>
                  <CardTitle>{classItem.name}</CardTitle>
                  {classItem.description && (
                    <CardDescription>{classItem.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {classItem.teacherName && (
                        <div>Teacher: {classItem.teacherName}</div>
                      )}
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>{classItem.memberCount} student{classItem.memberCount !== 1 ? 's' : ''}</span>
                      </div>
                      <div>
                        Joined {new Date(classItem.joinedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLeaveClass(classItem.id, classItem.name)}
                      disabled={leaving === classItem.id}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <LogOut className="w-4 h-4 mr-1" />
                      {leaving === classItem.id ? 'Leaving...' : 'Leave'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <AlertDialogModal
          open={alert.open}
          onOpenChange={alert.setOpen}
          type={alert.type}
          title={alert.title}
          message={alert.message}
          onConfirm={alert.onConfirm}
          showCancel={alert.showCancel}
          confirmText={alert.confirmText}
          cancelText={alert.cancelText}
          destructive={alert.destructive}
        />
      </div>
    </div>
  )
}
