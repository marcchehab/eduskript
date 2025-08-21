'use client'

import { useState } from 'react'
import { MessageCircle, Send, User } from 'lucide-react'

interface Comment {
  id: string
  author: string
  content: string
  timestamp: string
}

interface CommentsProps {
  pageId: string
  pageTitle: string
}

// Mock comments data - in a real app, this would come from a database
const mockComments: Comment[] = [
  {
    id: '1',
    author: 'Sarah M.',
    content: 'This explanation really helped me understand variables! The examples are clear.',
    timestamp: '2 hours ago'
  },
  {
    id: '2',
    author: 'Mike T.',
    content: 'Could you add more practice problems for this collection?',
    timestamp: '1 day ago'
  }
]

export function Comments({}: CommentsProps) {
  const [comments, setComments] = useState<Comment[]>(mockComments)
  const [newComment, setNewComment] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !authorName.trim()) return

    setIsSubmitting(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))

    const comment: Comment = {
      id: Date.now().toString(),
      author: authorName,
      content: newComment,
      timestamp: 'Just now'
    }

    setComments(prev => [comment, ...prev])
    setNewComment('')
    setIsSubmitting(false)
  }

  return (
    <div className="mt-12 border-t pt-8">
      <div className="flex items-center gap-2 mb-6">
        <MessageCircle className="w-5 h-5" />
        <h3 className="text-xl font-semibold">Discussion</h3>
        <span className="text-sm text-muted-foreground">({comments.length} comments)</span>
      </div>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="mb-8 p-4 bg-muted rounded-lg">
        <h4 className="font-medium mb-3 text-foreground">Join the discussion</h4>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Your name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            className="w-full p-3 border border-border rounded-lg bg-card text-foreground"
            required
          />
          <textarea
            placeholder="Share your thoughts or ask a question..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            className="w-full p-3 border border-border rounded-lg bg-card text-foreground"
            required
          />
          <button
            type="submit"
            disabled={isSubmitting || !newComment.trim() || !authorName.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Post Comment
              </>
            )}
          </button>
        </div>
      </form>

      {/* Comments List */}
      <div className="space-y-4">
        {comments.length > 0 ? (
          comments.map((comment) => (
            <div key={comment.id} className="p-4 bg-card rounded-lg shadow-sm border border-border">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground">
                      {comment.author}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {comment.timestamp}
                    </span>
                  </div>
                  <p className="text-foreground">
                    {comment.content}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No comments yet. Be the first to start the discussion!</p>
          </div>
        )}
      </div>
    </div>
  )
}
