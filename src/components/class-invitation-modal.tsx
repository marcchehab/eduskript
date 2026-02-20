'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { usePendingInvitations } from '@/hooks/use-pending-invitations'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Invitation {
  classId: string
  className: string
  classDescription: string | null
  teacherName: string | null
  inviteCode: string
  allowAnonymous: boolean
  addedAt: string
}

export function ClassInvitationModal() {
  const { data: session, status } = useSession()
  const hasPendingInvitations = usePendingInvitations()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const isStudent = status === 'authenticated' && session?.user?.accountType === 'student'

  const fetchInvitations = useCallback(async () => {
    if (!isStudent) return
    setLoading(true)
    try {
      const res = await fetch('/api/classes/my-classes')
      if (!res.ok) return
      const data = await res.json()
      setInvitations(data.joinRequests || [])
      setCurrentIndex(0)
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [isStudent])

  useEffect(() => {
    if (hasPendingInvitations && isStudent) {
      fetchInvitations()
    }
  }, [hasPendingInvitations, isStudent, fetchInvitations])

  const current = invitations[currentIndex]
  const isOpen = isStudent && !loading && invitations.length > 0

  const dispatchStatusChange = useCallback((hasPending: boolean) => {
    window.dispatchEvent(
      new CustomEvent('invitationStatusChanged', { detail: { hasPending } })
    )
  }, [])

  const advance = useCallback(() => {
    const remaining = invitations.filter((_, i) => i !== currentIndex)
    setInvitations(remaining)
    setCurrentIndex(0)
    if (remaining.length === 0) {
      dispatchStatusChange(false)
    }
  }, [invitations, currentIndex, dispatchStatusChange])

  const handleJoin = async () => {
    if (!current) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/classes/join/${current.inviteCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityConsent: true }),
      })
      if (res.ok || (await res.json()).alreadyMember) {
        advance()
      }
    } catch {
      // Silently fail
    } finally {
      setActionLoading(false)
    }
  }

  const handleDecline = async () => {
    if (!current) return
    setActionLoading(true)
    try {
      await fetch(`/api/classes/invitations/${current.classId}/decline`, {
        method: 'POST',
      })
      advance()
    } catch {
      // Silently fail
    } finally {
      setActionLoading(false)
    }
  }

  if (!isOpen || !current) return null

  return (
    <Dialog open onOpenChange={() => { /* Prevent closing — must accept or decline */ }}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        // Hide the default close button
        className="[&>button:last-child]:hidden"
      >
        <DialogHeader>
          <DialogTitle>Class Invitation</DialogTitle>
          <DialogDescription>
            You have been invited to join a class.
            {invitations.length > 1 && ` (${currentIndex + 1} of ${invitations.length})`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <div className="font-semibold text-lg">{current.className}</div>
            {current.classDescription && (
              <p className="text-sm text-muted-foreground mt-1">{current.classDescription}</p>
            )}
          </div>

          {current.teacherName && (
            <div className="text-sm">
              <span className="text-muted-foreground">Teacher:</span>{' '}
              {current.teacherName}
            </div>
          )}

          {!current.allowAnonymous && (
            <div className="text-xs bg-muted rounded-md px-3 py-2 text-muted-foreground">
              This class requires identity verification. Your teacher will be able to identify you.
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Invited {new Date(current.addedAt).toLocaleDateString()}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={actionLoading}
          >
            Decline
          </Button>
          <Button
            onClick={handleJoin}
            disabled={actionLoading}
          >
            Join Class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
