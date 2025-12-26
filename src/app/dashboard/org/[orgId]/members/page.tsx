'use client'

import { useState, useEffect, use } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserMinus, RotateCw, Search, Shield, ShieldCheck, User, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { OrgNav } from '@/components/dashboard/org-nav'

interface OrgMember {
  id: string
  organizationId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  createdAt: string
  user: {
    id: string
    email: string | null
    name: string | null
    pageSlug: string | null
    image: string | null
    accountType: string
    studentPseudonym: string | null
    createdAt: string
  }
}

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

const roleIcons = {
  owner: ShieldCheck,
  admin: Shield,
  member: User,
}

export default function OrgMembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false)
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'teachers' | 'students'>('teachers')
  // WORKAROUND: Using a refetch trigger instead of a proper data fetching library.
  // A better solution would be React Query or SWR which handle caching,
  // deduplication, and background refetching. This pattern works but requires
  // manually calling refetchMembers() after every mutation.
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  // Form states
  const [addFormData, setAddFormData] = useState({
    email: '',
    role: 'member' as 'owner' | 'admin' | 'member',
  })

  const [resetPasswordData, setResetPasswordData] = useState({
    newPassword: '',
    confirmPassword: '',
    requirePasswordReset: true,
  })

  // Fetch members from the API
  // Uses refetchTrigger to allow manual refetching after mutations
  useEffect(() => {
    if (!session) return

    const fetchMembers = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/organizations/${orgId}/members`)
        const data = await response.json()

        if (!response.ok) {
          if (response.status === 403) {
            router.push('/dashboard')
            return
          }
          throw new Error(data.error || 'Failed to fetch members')
        }

        setMembers(data.members)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchMembers()
  }, [session, orgId, router, refetchTrigger])

  // Helper to trigger a refetch
  const refetchMembers = () => setRefetchTrigger(prev => prev + 1)

  // Add member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addFormData.email,
          role: addFormData.role,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add member')
      }

      setSuccess('Member added successfully')
      setShowAddDialog(false)
      setAddFormData({ email: '', role: 'member' })
      refetchMembers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Update role
  const handleUpdateRole = async (userId: string, newRole: string) => {
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/organizations/${orgId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update role')
      }

      setSuccess('Role updated successfully')
      refetchMembers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Remove member
  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member from the organization?')) {
      return
    }

    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/organizations/${orgId}/members?userId=${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove member')
      }

      setSuccess('Member removed successfully')
      refetchMembers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Reset password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedMember) return

    setError('')
    setSuccess('')

    if (resetPasswordData.newPassword !== resetPasswordData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (resetPasswordData.newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/members/${selectedMember.userId}/reset-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newPassword: resetPasswordData.newPassword,
            requirePasswordReset: resetPasswordData.requirePasswordReset,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password')
      }

      setSuccess('Password reset successfully')
      setShowResetPasswordDialog(false)
      setSelectedMember(null)
      setResetPasswordData({
        newPassword: '',
        confirmPassword: '',
        requirePasswordReset: true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Filter members
  const filteredMembers = members.filter((member) => {
    // Filter by account type
    if (activeTab === 'teachers' && member.user.accountType !== 'teacher') return false
    if (activeTab === 'students' && member.user.accountType !== 'student') return false

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        member.user.name?.toLowerCase().includes(query) ||
        member.user.email?.toLowerCase().includes(query) ||
        member.user.pageSlug?.toLowerCase().includes(query) ||
        member.user.studentPseudonym?.toLowerCase().includes(query)
      )
    }

    return true
  })

  const teacherCount = members.filter((m) => m.user.accountType === 'teacher').length
  const studentCount = members.filter((m) => m.user.accountType === 'student').length

  // Check if current user can modify a member
  const currentUserMembership = members.find((m) => m.userId === session?.user?.id)
  const currentUserRole = currentUserMembership?.role || (session?.user?.isAdmin ? 'owner' : null)

  const canModifyMember = (member: OrgMember) => {
    if (session?.user?.isAdmin) return true
    if (!currentUserRole) return false
    if (member.userId === session?.user?.id) return false
    if (currentUserRole === 'owner') return true
    if (currentUserRole === 'admin' && member.role === 'member') return true
    return false
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading members...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold">Organization</h1>
        <div className="flex-1" />
        <Button onClick={() => setShowAddDialog(true)}>Add Member</Button>
      </div>

      <OrgNav orgId={orgId} active="members" />

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{success}</div>
      )}

      <Card className="p-6">
        <div className="mb-4 space-y-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Members</h2>
            <div className="flex-1 max-w-md relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or pseudonym..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'teachers' | 'students')}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="teachers">Teachers ({teacherCount})</TabsTrigger>
            <TabsTrigger value="students">Students ({studentCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="teachers" className="space-y-4">
            {filteredMembers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {searchQuery ? 'No teachers found matching your search' : 'No teachers yet'}
              </p>
            ) : (
              filteredMembers.map((member) => {
                const RoleIcon = roleIcons[member.role]
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between border-b pb-4 last:border-0"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{member.user.name || 'Unnamed'}</h3>
                        <Badge variant="outline" className="flex items-center gap-1">
                          <RoleIcon className="h-3 w-3" />
                          {roleLabels[member.role]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{member.user.email}</p>
                      {member.user.pageSlug && (
                        <p className="text-sm text-muted-foreground">
                          Page: /{member.user.pageSlug}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {canModifyMember(member) && (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleUpdateRole(member.userId, value)}
                            disabled={member.user.accountType === 'student'}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">Owner</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => {
                              setSelectedMember(member)
                              setShowResetPasswordDialog(true)
                            }}
                            variant="ghost"
                            size="icon"
                            title="Reset password"
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => handleRemoveMember(member.userId)}
                            variant="ghost"
                            size="icon"
                            title="Remove from organization"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </TabsContent>

          <TabsContent value="students" className="space-y-4">
            {filteredMembers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {searchQuery ? 'No students found matching your search' : 'No students yet'}
              </p>
            ) : (
              filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{member.user.name || 'Unnamed'}</h3>
                      <Badge variant="secondary">Student</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{member.user.email}</p>
                    <p className="text-sm text-muted-foreground font-mono">
                      Pseudonym: {member.user.studentPseudonym || 'Not set'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canModifyMember(member) && (
                      <Button
                        onClick={() => handleRemoveMember(member.userId)}
                        variant="ghost"
                        size="icon"
                        title="Remove from organization"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* Add Member Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <h2 className="mb-4 text-xl font-semibold">Add Member</h2>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div>
              <Label htmlFor="add-email">Email</Label>
              <Input
                id="add-email"
                type="email"
                value={addFormData.email}
                onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })}
                placeholder="Enter user's email address"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                User must already have an account
              </p>
            </div>
            <div>
              <Label htmlFor="add-role">Role</Label>
              <Select
                value={addFormData.role}
                onValueChange={(value: 'owner' | 'admin' | 'member') =>
                  setAddFormData({ ...addFormData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {currentUserRole === 'owner' && <SelectItem value="owner">Owner</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Member</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent className="max-w-md">
          <h2 className="mb-4 text-xl font-semibold">Reset Password</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Resetting password for: {selectedMember?.user.name || selectedMember?.user.email}
          </p>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <Label htmlFor="reset-newPassword">New Password</Label>
              <Input
                id="reset-newPassword"
                type="password"
                value={resetPasswordData.newPassword}
                onChange={(e) =>
                  setResetPasswordData({ ...resetPasswordData, newPassword: e.target.value })
                }
                required
                minLength={8}
              />
            </div>
            <div>
              <Label htmlFor="reset-confirmPassword">Confirm Password</Label>
              <Input
                id="reset-confirmPassword"
                type="password"
                value={resetPasswordData.confirmPassword}
                onChange={(e) =>
                  setResetPasswordData({ ...resetPasswordData, confirmPassword: e.target.value })
                }
                required
                minLength={8}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="reset-requirePasswordReset"
                checked={resetPasswordData.requirePasswordReset}
                onChange={(e) =>
                  setResetPasswordData({
                    ...resetPasswordData,
                    requirePasswordReset: e.target.checked,
                  })
                }
                className="h-4 w-4"
              />
              <Label htmlFor="reset-requirePasswordReset">
                Require user to change password on next login
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowResetPasswordDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Reset Password</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
