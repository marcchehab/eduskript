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
  | ExamStateChangeEvent
  | ExamStudentStatusEvent
  | ExamReopenedEvent
  | ExamReturnedEvent
  | StudentWorkUpdateEvent
  | LockdownChangeEvent

/**
 * Fired when a student is invited to a class (via bulk import or direct invite)
 */
export interface ClassInvitationEvent {
  type: 'class-invitation'
  classId: string
  className: string
  directAdd?: boolean  // True if user was directly added (existing account), false/undefined for pre-auth invite
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
 * Fired when exam state changes (hidden/closed/lobby/open).
 * Used for waiting room real-time updates. `studentId` is set when the change is
 * a per-student override (else null = class-level change).
 */
export interface ExamStateChangeEvent {
  type: 'exam-state-change'
  pageId: string
  classId: string
  studentId?: string | null
  state: 'hidden' | 'closed' | 'lobby' | 'open'
  timestamp: number
}

/**
 * Fired when a student's exam status changes (started/submitted)
 * Used for teacher dashboard real-time updates
 */
export interface ExamStudentStatusEvent {
  type: 'exam-student-status'
  pageId: string
  classId: string
  studentId: string
  status: 'taking' | 'submitted'
  timestamp: number
}

/**
 * Fired when a teacher reopens an exam for a specific student
 * Sent to the student so they can refresh and re-enter
 */
export interface ExamReopenedEvent {
  type: 'exam-reopened'
  pageId: string
  timestamp: number
}

/**
 * Fired when a teacher returns a graded exam to a student.
 * Sent to the student (user channel) so the My Exams list refreshes / toasts.
 */
export interface ExamReturnedEvent {
  type: 'exam-returned'
  pageId: string
  studentId: string
  timestamp: number
}

/**
 * Fired when a student updates their work (annotations, code, etc.)
 * Sent to class teacher so they can see real-time student progress
 */
export interface StudentWorkUpdateEvent {
  type: 'student-work-update'
  studentId: string
  classId: string
  pageId: string
  timestamp: number
}

/**
 * Fired when a teacher toggles a class's lockdown mode (anti-distraction SEB gate).
 * Sent on the `lockdown:${classId}` channel to every member's open tab so it can
 * reload — a reload re-hits the middleware gate (locked → SEB-required screen;
 * unlocked → normal content). NOT a security signal; see Class.lockdownMode.
 */
export interface LockdownChangeEvent {
  type: 'lockdown-change'
  classId: string
  locked: boolean
  timestamp: number
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
