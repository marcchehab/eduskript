'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus,
  Users,
  Link as LinkIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Upload,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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

      // Load email mapping from localStorage
      const stored = localStorage.getItem(`class_email_mapping_${classId}`)
      const emailMapping = stored ? JSON.parse(stored) : {}

      // Update the class with details
      setClasses((prev) =>
        prev.map((c) =>
          c.id === classId
            ? { ...c, students: data.students, emailMapping }
            : c
        )
      )
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

      // Parse emails
      const emails = emailInput
        .split(/[\n,\s]+/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0 && e.includes('@'))

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
      console.log('Bulk import response:', data)

      // Save the email-to-pseudonym mapping to localStorage
      const stored = localStorage.getItem(`class_email_mapping_${classId}`)
      const existingMapping = stored ? JSON.parse(stored) : {}
      const newMapping = { ...existingMapping, ...data.mappings }
      localStorage.setItem(`class_email_mapping_${classId}`, JSON.stringify(newMapping))

      setDialogType('success')
      setDialogTitle('Students Added Successfully')
      setDialogMessage(
        `${data.imported} new pre-authorization${data.imported !== 1 ? 's' : ''} added\n` +
        `${data.alreadyMembers} already enrolled\n` +
        `${data.alreadyPreAuthorized} already pre-authorized`
      )
      setDialogOpen(true)

      setEmailInputs({ ...emailInputs, [classId]: '' })
      await loadClassDetails(classId)
      await loadClasses()
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

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <p>Loading classes...</p>
        </div>
      </div>
    )
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
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation()
                                copyInviteLink(classItem.inviteCode)
                              }}
                            >
                              {copiedCode === classItem.inviteCode ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <LinkIcon className="w-4 h-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Copy invite link</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t p-4 space-y-6 bg-muted/20">
                        {/* Add Students Section */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold flex items-center gap-2">
                              <Upload className="w-4 h-4" />
                              Add Students
                            </Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    copyInviteLink(classItem.inviteCode)
                                  }}
                                >
                                  {copiedCode === classItem.inviteCode ? (
                                    <Check className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <LinkIcon className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Copy invite link</p>
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
                            placeholder="Paste student email addresses (one per line, or comma-separated)"
                            rows={4}
                            className="font-mono text-sm"
                          />
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              Students will be pre-authorized. Already enrolled students will be highlighted below.
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
                            <div className="space-y-2">
                              {students.map((student) => {
                                const realEmail = getEmailForPseudonym(classItem.id, student.email)
                                const isIdentified = !!realEmail

                                return (
                                  <div
                                    key={student.id}
                                    className={`flex items-center justify-between p-3 border rounded ${
                                      isIdentified
                                        ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                                        : 'bg-background'
                                    }`}
                                  >
                                    <div className="flex-1">
                                      <div className="font-medium text-sm">{student.displayName}</div>
                                      {isIdentified ? (
                                        <div className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                                          {realEmail}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                          {student.pseudonym} • joined via invite link
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-right text-xs text-muted-foreground">
                                      Joined {new Date(student.joinedAt).toLocaleDateString()}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
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
