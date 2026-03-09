'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Search, UserPlus, Users, Clock, Check, X, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProfileSettings } from '@/components/dashboard/profile-settings'
import { UpgradePrompt } from '@/components/dashboard/upgrade-prompt'

interface User {
  id: string
  name: string | null
  email: string
  image: string | null
  title: string | null
  bio: string | null
  relationshipStatus: 'collaborator' | 'pending' | 'none'
}

interface CollaborationRequest {
  id: string
  message: string | null
  createdAt: string
  requester?: User
  receiver?: User
}

interface Collaboration {
  id: string
  createdAt: string
  requester: User
  receiver: User
}

export default function CollaboratePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [sentRequests, setSentRequests] = useState<CollaborationRequest[]>([])
  const [receivedRequests, setReceivedRequests] = useState<CollaborationRequest[]>([])
  const [collaborations, setCollaborations] = useState<Collaboration[]>([])

  // Modal state
  const [showSendRequestModal, setShowSendRequestModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  // Redirect students to their dashboard
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.accountType === 'student') {
      router.push('/dashboard/my-classes')
    }
  }, [session, status, router])

  const searchUsers = useCallback(async () => {
    setIsSearching(true)
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`)
      const data = await response.json()
      
      if (data.success) {
        setSearchResults(data.data)
      }
    } catch (error) {
      console.error('Error searching users:', error)
    }
    setIsSearching(false)
  }, [searchQuery])

  const loadCollaborationData = async () => {
    try {
      const response = await fetch('/api/collaboration-requests')
      const data = await response.json()

      if (data.success) {
        setSentRequests(data.data.sentRequests)
        setReceivedRequests(data.data.receivedRequests)
        setCollaborations(data.data.collaborations)
      }
    } catch (error) {
      console.error('Error loading collaboration data:', error)
    }
  }

  // Load collaboration data on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCollaborationData()
  }, [])

  // Search users with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([])
      return
    }

    const timeoutId = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        await searchUsers()
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, searchUsers])

  const handleSendRequest = (user: User) => {
    setSelectedUser(user)
    setRequestMessage('')
    setShowSendRequestModal(true)
  }

  const sendCollaborationRequest = async () => {
    if (!selectedUser) return
    
    setIsSending(true)
    try {
      const response = await fetch('/api/collaboration-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receiverId: selectedUser.id,
          message: requestMessage.trim() || null
        })
      })
      
      if (response.ok) {
        setShowSendRequestModal(false)
        setRequestMessage('')
        await loadCollaborationData() // Reload data
        await searchUsers() // Update search results
      }
    } catch (error) {
      console.error('Error sending collaboration request:', error)
    }
    setIsSending(false)
  }

  const respondToRequest = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      const response = await fetch(`/api/collaboration-requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action })
      })
      
      if (response.ok) {
        await loadCollaborationData() // Reload data
      }
    } catch (error) {
      console.error('Error responding to collaboration request:', error)
    }
  }

  const cancelRequest = async (requestId: string) => {
    try {
      const response = await fetch(`/api/collaboration-requests/${requestId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        await loadCollaborationData() // Reload data
        await searchUsers() // Update search results
      }
    } catch (error) {
      console.error('Error cancelling collaboration request:', error)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'collaborator':
        return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Collaborator</span>
      case 'pending':
        return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Pending</span>
      default:
        return null
    }
  }

  const billingPlan = session?.user?.billingPlan || 'free'
  if (billingPlan === 'free' && !session?.user?.isAdmin) {
    return <UpgradePrompt feature="collaboration features" />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Collaborate</h1>
        <p className="text-gray-600">Connect with other teachers and collaborate on content.</p>
      </div>

      {/* Profile Settings - Your public profile shown to collaborators */}
      <ProfileSettings />

      {/* Search Section */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Search className="w-5 h-5" />
          Search Teachers
        </h2>
        <div className="relative">
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
          {isSearching && (
            <div className="absolute right-3 top-2.5">
              <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            </div>
          )}
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mt-4 space-y-3">
            {searchResults.map((user) => (
              <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    {user.image ? (
                      <Image src={user.image} alt={user.name || ''} width={40} height={40} className="w-10 h-10 rounded-full" />
                    ) : (
                      <User className="w-5 h-5 text-gray-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">{user.name || 'No name'}</div>
                    <div className="text-sm text-gray-600">{user.email}</div>
                    {user.title && <div className="text-sm text-gray-500">{user.title}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(user.relationshipStatus)}
                  {user.relationshipStatus === 'none' && (
                    <Button
                      size="sm"
                      onClick={() => handleSendRequest(user)}
                      className="flex items-center gap-1"
                    >
                      <UserPlus className="w-4 h-4" />
                      Send Request
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Collaboration Sections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Received Requests */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Received Requests ({receivedRequests.length})
          </h2>
          <div className="space-y-3">
            {receivedRequests.map((request) => (
              <div key={request.id} className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                    {request.requester?.image ? (
                      <Image src={request.requester.image} alt={request.requester.name || ''} width={32} height={32} className="w-8 h-8 rounded-full" />
                    ) : (
                      <User className="w-4 h-4 text-gray-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{request.requester?.name}</div>
                    <div className="text-xs text-gray-600">{request.requester?.email}</div>
                  </div>
                </div>
                {request.message && (
                  <p className="text-sm text-gray-700 mb-2 italic">&quot;{request.message}&quot;</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => respondToRequest(request.id, 'accept')}
                    className="flex items-center gap-1 text-green-600 hover:bg-green-50"
                  >
                    <Check className="w-3 h-3" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => respondToRequest(request.id, 'reject')}
                    className="flex items-center gap-1 text-red-600 hover:bg-red-50"
                  >
                    <X className="w-3 h-3" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
            {receivedRequests.length === 0 && (
              <p className="text-sm text-gray-500">No pending requests</p>
            )}
          </div>
        </Card>

        {/* Sent Requests */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">
            Sent Requests ({sentRequests.length})
          </h2>
          <div className="space-y-3">
            {sentRequests.map((request) => (
              <div key={request.id} className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                    {request.receiver?.image ? (
                      <Image src={request.receiver.image} alt={request.receiver.name || ''} width={32} height={32} className="w-8 h-8 rounded-full" />
                    ) : (
                      <User className="w-4 h-4 text-gray-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{request.receiver?.name}</div>
                    <div className="text-xs text-gray-600">{request.receiver?.email}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cancelRequest(request.id)}
                  className="w-full text-red-600 hover:bg-red-50"
                >
                  Cancel Request
                </Button>
              </div>
            ))}
            {sentRequests.length === 0 && (
              <p className="text-sm text-gray-500">No pending requests</p>
            )}
          </div>
        </Card>

        {/* Collaborators */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Collaborators ({collaborations.length})
          </h2>
          <div className="space-y-3">
            {collaborations.map((collaboration) => {
              // Determine which user is the other person in the collaboration
              const otherUser = collaboration.requester.id === collaboration.receiver.id 
                ? collaboration.receiver 
                : collaboration.requester
              return (
                <div key={collaboration.id} className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                      {otherUser.image ? (
                        <Image src={otherUser.image} alt={otherUser.name || ''} width={32} height={32} className="w-8 h-8 rounded-full" />
                      ) : (
                        <User className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{otherUser.name}</div>
                      <div className="text-xs text-gray-600">{otherUser.email}</div>
                      {otherUser.title && <div className="text-xs text-gray-500">{otherUser.title}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
            {collaborations.length === 0 && (
              <p className="text-sm text-gray-500">No collaborators yet</p>
            )}
          </div>
        </Card>
      </div>

      {/* Send Request Modal */}
      <Dialog open={showSendRequestModal} onOpenChange={setShowSendRequestModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Collaboration Request</DialogTitle>
            <DialogDescription>
              Send a collaboration request to {selectedUser?.name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Add a personal message (optional)..."
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowSendRequestModal(false)}>
                Cancel
              </Button>
              <Button onClick={sendCollaborationRequest} disabled={isSending}>
                {isSending ? 'Sending...' : 'Send Request'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}