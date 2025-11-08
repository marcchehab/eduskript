'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Tabs } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

interface User {
  id: string
  email: string
  name: string
  subdomain: string
  title: string | null
  isAdmin: boolean
  requirePasswordReset: boolean
  emailVerified: Date | null
  createdAt: Date
  updatedAt: Date
}

export default function AdminPanelPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [seeding, setSeeding] = useState(false)

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    subdomain: '',
    title: '',
    password: '',
    isAdmin: false,
    requirePasswordReset: true,
  })

  const [resetPasswordData, setResetPasswordData] = useState({
    newPassword: '',
    confirmPassword: '',
    requirePasswordReset: true,
  })

  // Check if user is admin
  useEffect(() => {
    if (session && !session.user.isAdmin) {
      router.push('/dashboard')
    }
  }, [session, router])

  // Fetch users
  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/users')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch users')
      }

      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session?.user.isAdmin) {
      fetchUsers()
    }
  }, [session])

  // Create user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user')
      }

      setSuccess('User created successfully')
      setShowCreateDialog(false)
      setFormData({
        email: '',
        name: '',
        subdomain: '',
        title: '',
        password: '',
        isAdmin: false,
        requirePasswordReset: true,
      })
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Update user
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
          subdomain: formData.subdomain,
          title: formData.title || null,
          isAdmin: formData.isAdmin,
          requirePasswordReset: formData.requirePasswordReset,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update user')
      }

      setSuccess('User updated successfully')
      setShowEditDialog(false)
      setSelectedUser(null)
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Delete user
  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return
    }

    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete user')
      }

      setSuccess('User deleted successfully')
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Reset password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

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
      const response = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: resetPasswordData.newPassword,
          requirePasswordReset: resetPasswordData.requirePasswordReset,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password')
      }

      setSuccess('Password reset successfully')
      setShowResetPasswordDialog(false)
      setSelectedUser(null)
      setResetPasswordData({
        newPassword: '',
        confirmPassword: '',
        requirePasswordReset: true,
      })
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  // Seed example data
  const handleSeedData = async () => {
    if (!confirm('This will create example users, collections, and content. Continue?')) {
      return
    }

    setSeeding(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/admin/seed-example-data', {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to seed data')
      }

      setSuccess(`Example data seeded successfully! Created ${data.data.skripts} skripts with ${data.data.pages} pages.`)
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSeeding(false)
    }
  }

  // Open edit dialog
  const openEditDialog = (user: User) => {
    setSelectedUser(user)
    setFormData({
      email: user.email,
      name: user.name,
      subdomain: user.subdomain,
      title: user.title || '',
      password: '',
      isAdmin: user.isAdmin,
      requirePasswordReset: user.requirePasswordReset,
    })
    setShowEditDialog(true)
  }

  // Open reset password dialog
  const openResetPasswordDialog = (user: User) => {
    setSelectedUser(user)
    setResetPasswordData({
      newPassword: '',
      confirmPassword: '',
      requirePasswordReset: true,
    })
    setShowResetPasswordDialog(true)
  }

  if (!session?.user.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Access denied. Admin privileges required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <div className="flex gap-2">
          <Button onClick={handleSeedData} disabled={seeding} variant="outline">
            {seeding ? 'Seeding...' : 'Insert Example Data'}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            Create User
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">
          {success}
        </div>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-xl font-semibold">Users</h2>
        {loading ? (
          <p>Loading users...</p>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between border-b pb-4 last:border-0"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{user.name}</h3>
                    {user.isAdmin && <Badge variant="outline">Admin</Badge>}
                    {user.requirePasswordReset && <Badge variant="outline">Password Reset Required</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Subdomain: {user.subdomain}
                    {user.title && ` • ${user.title}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => openEditDialog(user)}
                    variant="outline"
                    size="sm"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => openResetPasswordDialog(user)}
                    variant="outline"
                    size="sm"
                  >
                    Reset Password
                  </Button>
                  <Button
                    onClick={() => handleDeleteUser(user.id)}
                    variant="outline"
                    size="sm"
                    disabled={user.id === session?.user.id}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-background p-6">
            <h2 className="mb-4 text-xl font-semibold">Create User</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="create-name">Name</Label>
                <Input
                  id="create-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="create-subdomain">Subdomain</Label>
                <Input
                  id="create-subdomain"
                  value={formData.subdomain}
                  onChange={(e) => setFormData({ ...formData, subdomain: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="create-title">Title (optional)</Label>
                <Input
                  id="create-title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="create-password">Password</Label>
                <Input
                  id="create-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="create-isAdmin"
                  checked={formData.isAdmin}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isAdmin: checked as boolean })
                  }
                />
                <Label htmlFor="create-isAdmin">Admin user</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="create-requirePasswordReset"
                  checked={formData.requirePasswordReset}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, requirePasswordReset: checked as boolean })
                  }
                />
                <Label htmlFor="create-requirePasswordReset">Require password reset on first login</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create User</Button>
              </div>
            </form>
          </div>
        </div>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-background p-6">
            <h2 className="mb-4 text-xl font-semibold">Edit User</h2>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-subdomain">Subdomain</Label>
                <Input
                  id="edit-subdomain"
                  value={formData.subdomain}
                  onChange={(e) => setFormData({ ...formData, subdomain: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-title">Title (optional)</Label>
                <Input
                  id="edit-title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-isAdmin"
                  checked={formData.isAdmin}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isAdmin: checked as boolean })
                  }
                />
                <Label htmlFor="edit-isAdmin">Admin user</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-requirePasswordReset"
                  checked={formData.requirePasswordReset}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, requirePasswordReset: checked as boolean })
                  }
                />
                <Label htmlFor="edit-requirePasswordReset">Require password reset on next login</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">Update User</Button>
              </div>
            </form>
          </div>
        </div>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-background p-6">
            <h2 className="mb-4 text-xl font-semibold">Reset Password</h2>
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
                <Checkbox
                  id="reset-requirePasswordReset"
                  checked={resetPasswordData.requirePasswordReset}
                  onCheckedChange={(checked) =>
                    setResetPasswordData({
                      ...resetPasswordData,
                      requirePasswordReset: checked as boolean,
                    })
                  }
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
          </div>
        </div>
      </Dialog>
    </div>
  )
}
