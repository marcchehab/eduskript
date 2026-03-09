'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Plus,
  Users,
  Link as LinkIcon,
  Link2Off,
  Check,
  ChevronDown,
  ChevronRight,
  Upload,
  AlertCircle,
  CheckCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ShieldOff,
  ShieldUser,
  Pencil,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  saveEmailMappings,
  getEmailMappingsForClass,
  getRealEmail,
  addUnmappedEmails,
  getUnmappedEmailsForClass,
  removeUnmappedEmail,
  saveEmailMapping,
} from '@/lib/email-mapping-db'

interface Student {
  id: string
  displayName: string
  pseudonym: string
  email: string
  joinedAt: string
  lastSeenAt: string | null
}

interface EmailMapping {
  [email: string]: string // email -> pseudonym
}

interface Class {
  id: string
  name: string
  description: string | null
  inviteCode: string
  allowAnonymous: boolean
  memberCount: number
  preAuthorizedCount: number
  createdAt: string
  updatedAt: string
}

interface ClassWithDetails extends Class {
  students?: Student[]
  emailMapping?: EmailMapping
}

export default function ClassesPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [classes, setClasses] = useState<ClassWithDetails[]>([])
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [newClassDescription, setNewClassDescription] = useState('')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogType, setDialogType] = useState<'success' | 'error'>('success')
  const [dialogTitle, setDialogTitle] = useState('')
  const [dialogMessage, setDialogMessage] = useState('')

  // Per-class state for bulk import
  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState<Record<string, boolean>>({})

  // Sorting state per class
  const [sortConfig, setSortConfig] = useState<Record<string, { key: string; direction: 'asc' | 'desc' }>>({})

  // State for toggling allowAnonymous
  const [updatingAnonymous, setUpdatingAnonymous] = useState<Record<string, boolean>>({})

  // State for editing class details
  const [editingClassId, setEditingClassId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [savingClass, setSavingClass] = useState(false)


  // Check if user is a teacher
  useEffect(() => {
    if (status === 'loading') return

    if (!session) {
      router.push('/auth/signin')
      return
    }

    if (session.user?.accountType !== 'teacher') {
      router.push('/dashboard')
      return
    }

    loadClasses()
  }, [session, status, router])

  const loadClasses = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/classes')

      if (!response.ok) {
        throw new Error('Failed to load classes')
      }

      const data = await response.json()
      setClasses(data.classes)
    } catch (error) {
      console.error('Error loading classes:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadClassDetails = async (classId: string) => {
    try {
      // Load students
      const studentsResponse = await fetch(`/api/classes/${classId}/students`)
      if (!studentsResponse.ok) return

      const data = await studentsResponse.json()

      // Load email mapping from IndexedDB
      const emailMapping = await getEmailMappingsForClass(classId)

      // Update the class with details
      setClasses((prev) =>
        prev.map((c) =>
          c.id === classId
            ? { ...c, students: data.students, emailMapping }
            : c
        )
      )

      // Resolve unmapped emails to pseudonyms (for students who have consented)
      await resolveEmailsForClass(classId)
    } catch (error) {
      console.error('Error loading class details:', error)
    }
  }

  const toggleClass = async (classId: string) => {
    if (expandedClassId === classId) {
      setExpandedClassId(null)
    } else {
      setExpandedClassId(classId)
      const classData = classes.find((c) => c.id === classId)
      if (!classData?.students) {
        await loadClassDetails(classId)
      }
    }
  }

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!newClassName.trim()) return

    try {
      setCreating(true)

      const response = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClassName.trim(),
          description: newClassDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create class')
      }

      const data = await response.json()

      // Add new class to list
      setClasses([data.class, ...classes])

      // Reset form
      setNewClassName('')
      setNewClassDescription('')
      setShowCreateForm(false)
    } catch (error) {
      console.error('Error creating class:', error)
      setDialogType('error')
      setDialogTitle('Failed to Create Class')
      setDialogMessage('An error occurred while creating the class. Please try again.')
      setDialogOpen(true)
    } finally {
      setCreating(false)
    }
  }

  const copyInviteLink = (inviteCode: string) => {
    const inviteUrl = `${window.location.origin}/classes/join/${inviteCode}`
    navigator.clipboard.writeText(inviteUrl)
    setCopiedCode(inviteCode)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const handleAddStudents = async (classId: string) => {
    const emailInput = emailInputs[classId] || ''
    if (!emailInput.trim()) return

    try {
      setImporting({ ...importing, [classId]: true })

      // Extract emails: find all @-containing patterns via RFC 5322 local-part + domain regex
      const emails = (emailInput.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g) ?? [])

      if (emails.length === 0) {
        setDialogType('error')
        setDialogTitle('No Valid Emails')
        setDialogMessage('Please enter at least one valid email address.')
        setDialogOpen(true)
        return
      }

      const response = await fetch(`/api/classes/${classId}/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Bulk import failed:', errorData)
        throw new Error(errorData.error || 'Failed to add students')
      }

      const data = await response.json()

      // Save emails to local unmapped list for later resolution
      addUnmappedEmails(classId, emails)

      // Clear the input and reload to show new students/invitations
      setEmailInputs({ ...emailInputs, [classId]: '' })
      await loadClassDetails(classId)

      // Resolve emails to pseudonyms for students who have consented
      await resolveEmailsForClass(classId)
    } catch (error) {
      console.error('Error adding students:', error)
      setDialogType('error')
      setDialogTitle('Failed to Add Students')
      setDialogMessage(error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.')
      setDialogOpen(true)
    } finally {
      setImporting({ ...importing, [classId]: false })
    }
  }

  const resolveEmailsForClass = async (classId: string) => {
    try {
      const unmappedEmails = getUnmappedEmailsForClass(classId)

      if (unmappedEmails.length === 0) {
        return // No emails to resolve
      }

      const response = await fetch(`/api/classes/${classId}/resolve-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: unmappedEmails }),
      })

      if (!response.ok) {
        throw new Error('Failed to resolve emails')
      }

      const data = await response.json()

      // Update mappings for resolved emails
      let hasNewMappings = false
      for (const item of data.resolved) {
        if (item.resolved && item.pseudonym) {
          // Save mapping: realEmail -> pseudonymEmail
          await saveEmailMapping(classId, item.email, item.pseudonym)
          // Remove from unmapped list
          removeUnmappedEmail(classId, item.email)
          hasNewMappings = true
        }
      }

      // Update local state with new mappings (don't call loadClassDetails to avoid infinite loop)
      if (hasNewMappings) {
        const updatedMapping = await getEmailMappingsForClass(classId)
        setClasses((prev) =>
          prev.map((c) =>
            c.id === classId
              ? { ...c, emailMapping: updatedMapping }
              : c
          )
        )
      }
    } catch (error) {
      console.error('[Resolve] Error resolving emails:', error)
    }
  }

  const handleUnenrollStudent = async (classId: string, studentId: string, studentName: string) => {
    if (!confirm(`Are you sure you want to unenroll ${studentName} from this class?`)) {
      return
    }

    try {
      const response = await fetch(`/api/classes/${classId}/students/${studentId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to unenroll student')
      }

      // Reload class details
      await loadClassDetails(classId)

      setDialogType('success')
      setDialogTitle('Student Unenrolled')
      setDialogMessage(`${studentName} has been removed from the class.`)
      setDialogOpen(true)
    } catch (error) {
      console.error('Error unenrolling student:', error)
      setDialogType('error')
      setDialogTitle('Failed to Unenroll')
      setDialogMessage(error instanceof Error ? error.message : 'An unexpected error occurred.')
      setDialogOpen(true)
    }
  }

  const handleDeleteUnmappedEmail = async (classId: string, email: string) => {
    try {
      // Delete from database
      const response = await fetch(`/api/classes/${classId}/bulk-import`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || 'Failed to delete')
      }

      // Also remove from local cache
      removeUnmappedEmail(classId, email)
      // Force re-render by reloading class details
      loadClassDetails(classId)
    } catch (error) {
      console.error('Error deleting pre-authorization:', error)
      setDialogType('error')
      setDialogTitle('Failed to Delete')
      setDialogMessage(error instanceof Error ? error.message : 'An unexpected error occurred.')
      setDialogOpen(true)
    }
  }

  const getEmailForPseudonym = (classId: string, pseudonymEmail: string): string | null => {
    const classData = classes.find((c) => c.id === classId)
    const emailMapping = classData?.emailMapping || {}

    for (const [realEmail, pseudo] of Object.entries(emailMapping)) {
      if (pseudo === pseudonymEmail) {
        return realEmail
      }
    }
    return null
  }

  const handleSort = (classId: string, key: string) => {
    const currentSort = sortConfig[classId]
    const direction = currentSort?.key === key && currentSort?.direction === 'asc' ? 'desc' : 'asc'
    setSortConfig({ ...sortConfig, [classId]: { key, direction } })
  }

  const startEditingClass = (classItem: ClassWithDetails) => {
    setEditingClassId(classItem.id)
    setEditName(classItem.name)
    setEditDescription(classItem.description || '')
  }

  const cancelEditingClass = () => {
    setEditingClassId(null)
    setEditName('')
    setEditDescription('')
  }

  const saveClassDetails = async (classId: string) => {
    if (!editName.trim()) return

    try {
      setSavingClass(true)

      const response = await fetch(`/api/classes/${classId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update class')
      }

      // Update local state
      setClasses((prev) =>
        prev.map((c) =>
          c.id === classId
            ? { ...c, name: editName.trim(), description: editDescription.trim() || null }
            : c
        )
      )

      setEditingClassId(null)
    } catch (error) {
      console.error('Error updating class:', error)
      setDialogType('error')
      setDialogTitle('Failed to Update')
      setDialogMessage('Could not update the class details. Please try again.')
      setDialogOpen(true)
    } finally {
      setSavingClass(false)
    }
  }

  const handleToggleAnonymous = async (classId: string, allowAnonymous: boolean) => {
    try {
      setUpdatingAnonymous({ ...updatingAnonymous, [classId]: true })

      const response = await fetch(`/api/classes/${classId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAnonymous }),
      })

      if (!response.ok) {
        throw new Error('Failed to update class')
      }

      // Update local state
      setClasses((prev) =>
        prev.map((c) =>
          c.id === classId ? { ...c, allowAnonymous } : c
        )
      )
    } catch (error) {
      console.error('Error updating class:', error)
      setDialogType('error')
      setDialogTitle('Failed to Update')
      setDialogMessage('Could not update the anonymous students setting. Please try again.')
      setDialogOpen(true)
    } finally {
      setUpdatingAnonymous({ ...updatingAnonymous, [classId]: false })
    }
  }

  const getSortedStudents = (classId: string, students: Student[]) => {
    const sort = sortConfig[classId]
    if (!sort) return students

    return [...students].sort((a, b) => {
      let aValue: string | number = ''
      let bValue: string | number = ''

      if (sort.key === 'name') {
        aValue = a.displayName.toLowerCase()
        bValue = b.displayName.toLowerCase()
      } else if (sort.key === 'email') {
        const aEmail = getEmailForPseudonym(classId, a.email)
        const bEmail = getEmailForPseudonym(classId, b.email)
        aValue = aEmail?.toLowerCase() || a.pseudonym.toLowerCase()
        bValue = bEmail?.toLowerCase() || b.pseudonym.toLowerCase()
      } else if (sort.key === 'joined') {
        aValue = new Date(a.joinedAt).getTime()
        bValue = new Date(b.joinedAt).getTime()
      }

      if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1
      return 0
    })
  }

  const getSortIcon = (classId: string, columnKey: string) => {
    const sort = sortConfig[classId]
    if (sort?.key !== columnKey) {
      return <ArrowUpDown className="w-3 h-3 opacity-50" />
    }
    return sort.direction === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <p>Loading classes...</p>
        </div>
      </div>
    )
  }

  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="class management" />
  }

  return (
    <TooltipProvider>
      <>
        {/* Result Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <div className="flex items-center gap-3">
                {dialogType === 'success' ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                    <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
                    <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                )}
                <DialogTitle>{dialogTitle}</DialogTitle>
              </div>
              <DialogDescription className="whitespace-pre-line pt-2">
                {dialogMessage}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setDialogOpen(false)}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold">My Classes</h1>
              <p className="text-muted-foreground mt-1">
                Manage your classes and student enrollments
              </p>
            </div>
            <Button onClick={() => setShowCreateForm(!showCreateForm)}>
              <Plus className="w-4 h-4 mr-2" />
              New Class
            </Button>
          </div>

          {showCreateForm && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Create New Class</CardTitle>
                <CardDescription>
                  Create a class to organize students and share content
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateClass} className="space-y-4">
                  <div>
                    <Label htmlFor="className">Class Name</Label>
                    <Input
                      id="className"
                      value={newClassName}
                      onChange={(e) => setNewClassName(e.target.value)}
                      placeholder="e.g., Algebra 101"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="classDescription">Description (Optional)</Label>
                    <Textarea
                      id="classDescription"
                      value={newClassDescription}
                      onChange={(e) => setNewClassDescription(e.target.value)}
                      placeholder="Brief description of the class"
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creating}>
                      {creating ? 'Creating...' : 'Create Class'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCreateForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {classes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No classes yet</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Create your first class to start organizing students
                </p>
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Class
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {classes.map((classItem) => {
                const isExpanded = expandedClassId === classItem.id
                const students = classItem.students || []
                const emailMapping = classItem.emailMapping || {}

                return (
                  <div key={classItem.id} className="border rounded-lg">
                    {/* Class Header - Always Visible */}
                    <button
                      onClick={() => toggleClass(classItem.id)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      )}
                      <div className="flex-1 text-left">
                        <h3 className="font-semibold text-lg">{classItem.name}</h3>
                        {classItem.description && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {classItem.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="w-4 h-4" />
                          <span>{classItem.memberCount}</span>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="text-muted-foreground">
                              {classItem.allowAnonymous ? (
                                <ShieldOff className="w-4 h-4" />
                              ) : (
                                <ShieldUser className="w-4 h-4" />
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {classItem.allowAnonymous
                              ? 'Anonymous joins allowed'
                              : 'Identity required to join'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t p-4 space-y-6 bg-muted/20">
                        {/* Class Name/Description Edit Section */}
                        {editingClassId === classItem.id ? (
                          <div className="space-y-3 p-3 border rounded-lg bg-background">
                            <div>
                              <Label htmlFor={`edit-name-${classItem.id}`}>Class Name</Label>
                              <Input
                                id={`edit-name-${classItem.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Class name"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-desc-${classItem.id}`}>Description (optional)</Label>
                              <Input
                                id={`edit-desc-${classItem.id}`}
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="Brief description"
                                className="mt-1"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => saveClassDetails(classItem.id)}
                                disabled={savingClass || !editName.trim()}
                              >
                                {savingClass ? 'Saving...' : 'Save'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={cancelEditingClass}
                                disabled={savingClass}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-semibold">{classItem.name}</h4>
                              {classItem.description && (
                                <p className="text-sm text-muted-foreground">{classItem.description}</p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditingClass(classItem)}
                              className="h-8 w-8"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </div>
                        )}

                        {/* Add Students Section */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold flex items-center gap-2">
                              <Upload className="w-4 h-4" />
                              Add Students
                            </Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (classItem.allowAnonymous) {
                                        copyInviteLink(classItem.inviteCode)
                                      }
                                    }}
                                    disabled={!classItem.allowAnonymous}
                                    className={!classItem.allowAnonymous ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
                                  >
                                    {copiedCode === classItem.inviteCode ? (
                                      <Check className="w-4 h-4 text-green-600" />
                                    ) : classItem.allowAnonymous ? (
                                      <LinkIcon className="w-4 h-4" />
                                    ) : (
                                      <Link2Off className="w-4 h-4" />
                                    )}
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {classItem.allowAnonymous
                                  ? 'Copy invite link'
                                  : 'Invite links are disabled for classes that require identity'}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Textarea
                            value={emailInputs[classItem.id] || ''}
                            onChange={(e) =>
                              setEmailInputs({
                                ...emailInputs,
                                [classItem.id]: e.target.value,
                              })
                            }
                            placeholder="Paste text containing student emails (formatting doesn't matter much, we usually find them)"
                            rows={4}
                            className="font-mono text-sm"
                          />
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              Students will receive a class invitation when they sign in. Already enrolled students who have shared their identity will be highlighted below.
                            </p>
                            <Button
                              onClick={() => handleAddStudents(classItem.id)}
                              disabled={
                                importing[classItem.id] || !emailInputs[classItem.id]?.trim()
                              }
                              size="sm"
                            >
                              {importing[classItem.id] ? 'Adding...' : 'Add Students'}
                            </Button>
                          </div>
                        </div>

                        {/* Enrolled Students */}
                        <div className="space-y-3">
                          <Label className="text-base font-semibold flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Enrolled Students ({students.length})
                          </Label>

                          {students.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              No students enrolled yet. Add student emails above or share the invite link.
                            </p>
                          ) : (
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full">
                                <thead className="bg-muted/50 border-b">
                                  <tr>
                                    <th className="text-left p-3 font-medium text-sm">
                                      <button
                                        onClick={() => handleSort(classItem.id, 'name')}
                                        className="flex items-center gap-2 hover:text-foreground"
                                      >
                                        Nickname
                                        {getSortIcon(classItem.id, 'name')}
                                      </button>
                                    </th>
                                    <th className="text-left p-3 font-medium text-sm">
                                      <button
                                        onClick={() => handleSort(classItem.id, 'email')}
                                        className="flex items-center gap-2 hover:text-foreground"
                                      >
                                        Email / Pseudonym
                                        {getSortIcon(classItem.id, 'email')}
                                      </button>
                                    </th>
                                    <th className="text-left p-3 font-medium text-sm">
                                      <button
                                        onClick={() => handleSort(classItem.id, 'joined')}
                                        className="flex items-center gap-2 hover:text-foreground"
                                      >
                                        Joined
                                        {getSortIcon(classItem.id, 'joined')}
                                      </button>
                                    </th>
                                    <th className="text-right p-3 font-medium text-sm">
                                      Actions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {getSortedStudents(classItem.id, students).map((student, index) => {
                                    // Look up real email using the student's pseudonym
                                    const realEmail = getEmailForPseudonym(classItem.id, student.pseudonym)
                                    const isIdentified = !!realEmail
                                    // Shorten pseudonym display
                                    const shortPseudonym = student.pseudonym?.substring(0, 8) + '...' || 'unknown'

                                    return (
                                      <tr
                                        key={student.id}
                                        className={`border-b last:border-b-0 ${
                                          index % 2 === 0 ? 'bg-background' : 'bg-muted/30'
                                        }`}
                                      >
                                        <td className="p-3 w-1/3">
                                          <div className="font-medium text-sm">{student.displayName}</div>
                                        </td>
                                        <td className="p-3">
                                          {isIdentified ? (
                                            <div className="text-sm text-green-700 dark:text-green-400 font-medium">
                                              {realEmail}
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-muted-foreground font-mono">
                                                {shortPseudonym}
                                              </span>
                                              <span className="text-xs text-muted-foreground">
                                                • anonymous
                                              </span>
                                            </div>
                                          )}
                                        </td>
                                        <td className="p-3 text-sm text-muted-foreground">
                                          {new Date(student.joinedAt).toLocaleDateString()}
                                        </td>
                                        <td className="p-3 text-right">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleUnenrollStudent(classItem.id, student.id, student.displayName)}
                                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                                          >
                                            Unenroll
                                          </Button>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Unmapped Emails (Pending Invitations) */}
                          {(() => {
                            const unmappedEmails = getUnmappedEmailsForClass(classItem.id)
                            if (unmappedEmails.length === 0) return null

                            return (
                              <div className="mt-6 space-y-3">
                                <Label className="text-base font-semibold">
                                  Pending Invitations ({unmappedEmails.length})
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Students who haven&apos;t joined yet or haven&apos;t consented to reveal their identity
                                </p>
                                <div className="space-y-2">
                                  {unmappedEmails.map((email) => (
                                    <div
                                      key={email}
                                      className="flex items-center justify-between p-3 bg-muted/30 rounded-md border"
                                    >
                                      <span className="text-sm font-mono">{email}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteUnmappedEmail(classItem.id, email)}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}
                        </div>

                        {/* Class Settings - subtle at bottom */}
                        <div className="pt-4 border-t">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {classItem.allowAnonymous ? (
                                <ShieldOff className="w-4 h-4" />
                              ) : (
                                <ShieldUser className="w-4 h-4" />
                              )}
                              <span>
                                {classItem.allowAnonymous
                                  ? 'Anonymous joins allowed'
                                  : 'Identity required to join'}
                              </span>
                            </div>
                            <Switch
                              id={`anonymous-${classItem.id}`}
                              checked={classItem.allowAnonymous}
                              onCheckedChange={(checked) => handleToggleAnonymous(classItem.id, checked)}
                              disabled={updatingAnonymous[classItem.id]}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      </>
    </TooltipProvider>
  )
}
