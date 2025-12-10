/**
 * Real-Time Event System Types
 *
 * Server-Sent Events (SSE) architecture for real-time updates.
 * Supports class invitations, teacher broadcasts, quiz submissions, etc.
 */

/**
 * All supported event types in the system
 */
export type AppEvent =
  | ClassInvitationEvent
  | TeacherAnnotationsUpdateEvent
  | TeacherFeedbackEvent
  | QuizSubmissionEvent
  | CollaborationRequestEvent

/**
 * Fired when a student is invited to a class (via bulk import or direct invite)
 */
export interface ClassInvitationEvent {
  type: 'class-invitation'
  classId: string
  className: string
}

/**
 * Fired when a teacher updates annotations in broadcast mode (class-wide)
 * Clients should refetch from API to get the actual data
 */
export interface TeacherAnnotationsUpdateEvent {
  type: 'teacher-annotations-update'
  classId: string
  pageId: string
  timestamp: number
}

/**
 * Fired when a teacher provides feedback to an individual student
 * Clients should refetch from API to get the actual data
 */
export interface TeacherFeedbackEvent {
  type: 'teacher-feedback'
  studentId: string
  pageId: string
  adapter: string  // 'annotations', etc.
  timestamp: number
}

/**
 * Fired when a student submits a quiz answer
 */
export interface QuizSubmissionEvent {
  type: 'quiz-submission'
  classId: string
  pageId: string
  questionId: string
  studentPseudonym: string
  timestamp: number
}

/**
 * Fired when a teacher receives a collaboration request
 */
export interface CollaborationRequestEvent {
  type: 'collaboration-request'
  fromUserId: string
  fromName: string
}

/**
 * EventBus interface - pluggable implementation
 *
 * Phase 1: In-memory (single server)
 * Phase 2: PostgreSQL LISTEN/NOTIFY (multi-server)
 */
export interface EventBus {
  /**
   * Publish an event to a channel
   * @param channel - Channel name (e.g., 'user:123', 'class:abc')
   * @param event - The event payload
   */
  publish(channel: string, event: AppEvent): Promise<void>

  /**
   * Subscribe to a channel
   * @param channel - Channel name to subscribe to
   * @param handler - Callback for received events
   * @returns Unsubscribe function
   */
  subscribe(channel: string, handler: (event: AppEvent) => void): () => void
}

/**
 * Channel naming conventions:
 *
 * User-specific (targeted notifications):
 *   `user:${visitorId}`           - visitor-specific events (anonymous)
 *   `user:${session.user.id}`     - logged-in user events
 *
 * Class-wide (broadcasts):
 *   `class:${classId}`            - all members see this
 *   `class:${classId}:students`   - students only
 *   `class:${classId}:teacher`    - teacher only
 *
 * Resource-specific:
 *   `quiz:${quizId}`              - quiz submissions/state changes
 *   `page:${pageId}`              - page annotations/updates
 */
