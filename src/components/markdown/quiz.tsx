"use client"

import { useState, useEffect, useRef, ReactNode, ReactElement, Children } from 'react'
import { useSyncedUserData } from '@/lib/userdata'
import type { QuizData } from '@/lib/userdata/types'
import { cn } from '@/lib/utils'
import { Check, X } from 'lucide-react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { QuizProgressBar } from './quiz-progress-bar'
import { useSurvey, type SurveyContextValue, type SurveyAnswerType } from './survey-provider'
import { useInSurveyRegion } from './survey'
import { useCoupledVideo, useGate, parseTimecode } from './coupled-video-context'
import { compareOutput, scoreFromRatio } from '@/lib/output-comparison'
import { useIsExamPage } from '@/contexts/exam-page-context'
import { useStageLocked } from './stage-flow'
import { useComponentReview } from '@/contexts/exam-review-context'
import { ScoreBadge } from '@/components/exam/score-badge'
import { postCheckpoint } from '@/lib/userdata/checkpoints'
import { TextAnswerHistory } from './text-answer-history'

interface QuestionProps {
  children: ReactNode
  type?: 'single' | 'multiple' | 'text' | 'number' | 'range'
  id: string
  pageId: string
  showFeedback?: boolean
  minValue?: number
  maxValue?: number
  step?: number
  // Optional labels for the two ends of a `number` slider. Rendered beneath
  // the track, left = min end, right = max end.
  minLabel?: string
  maxLabel?: string
  // Coupled-video gate timecode ("90" | "1:30" | "1:02:03"). When set and the
  // page has a coupled video, a correct answer resumes the paused video.
  // Only meaningful for single/multiple questions. Classroom mode only.
  gateAt?: string
  // Free-text auto-check (predict-the-output). When `expected` is set on a
  // `type="text"` question, the typed answer is graded against it: a similarity
  // ratio gives partial credit (× `points`, default 1, rounded to 0.1) and an
  // exact match counts as fully correct (green + gate). `ignoreCase` /
  // `ignoreWhitespace` relax the comparison.
  expected?: string
  points?: number
  ignoreCase?: boolean
  ignoreWhitespace?: boolean
  // Editor preview cursor-sync: original source lines of the <question> block.
  // Applied to the card root so clicking inside it maps to / highlights the
  // markdown. Threaded down via {...rest} to QuestionInner.
  sourceLineStart?: string
  sourceLineEnd?: string
}

interface OptionProps {
  children: ReactNode
  feedback?: string
  correct?: 'true' | 'false'
}

// Parse correct prop to boolean
const isCorrect = (value: 'true' | 'false' | undefined): boolean => value === 'true'

// Idle delay before an edited answer is autosaved. Text gets a longer window
// because it's typed continuously — for text the primary save is the textarea's
// blur (focus loss), and this idle value is just a safety net for a long pause
// without blurring. Choice/number/range are discrete (one click/drag), so a
// short delay keeps the "Saved" chip + live teacher view snappy.
const AUTOSAVE_TEXT_MS = 1500
const AUTOSAVE_DISCRETE_MS = 400

// Inner component that renders after data is loaded.
//
// There is no Submit button: every answer autosaves on change (debounced),
// like the code editor. `isSubmitted` now means "a non-empty answer has been
// saved" — it gates feedback and the "Saved" indicator and counts the question
// as answered. surveyMode still hides feedback; the page-level SurveyProvider's
// "Send" button remains the batch-submit path, fed by per-question autosaves.
function QuestionInner({
  children,
  type = 'multiple',
  showFeedback: showFeedbackProp,
  minValue = 0,
  maxValue = 100,
  step = 1,
  minLabel,
  maxLabel,
  expected,
  points,
  ignoreCase,
  ignoreWhitespace,
  initialData,
  updateData,
  surveyMode = false,
  componentId,
  reviewMode = false,
  onAutosaveCheckpoint,
  sourceLineStart,
  sourceLineEnd,
}: Omit<QuestionProps, 'id' | 'pageId'> & {
  initialData: QuizData | null
  updateData: (data: QuizData, options?: { immediate?: boolean }) => Promise<void>
  surveyMode?: boolean
  /** Runtime componentId, for the in-exam grade badge. */
  componentId?: string
  /** Read-only graded view (teacher grading or student reviewing a returned
   *  exam): reveal correctness, disable inputs, show the grade badge. */
  reviewMode?: boolean
  /** Called after a text answer autosaves so the parent can snapshot it as a
   *  checkpoint (exam answer-history timeline). Text questions only. */
  onAutosaveCheckpoint?: (data: QuizData) => void
}) {
  // Live attempts NEVER reveal correctness (correct/wrong highlight, auto-check
  // score, expected-output diff) to the student — not in exams, not in practice.
  // Since there's no Submit button, isSubmitted flips on the first autosave, so
  // any default-on feedback would leak the answer the instant the student types.
  // Authors can still opt in per question with showFeedback="true". Survey mode
  // always hides it. Review/grade mode always shows it (teacher grading, or the
  // student reviewing their RETURNED exam — revealing what's right is the point).
  const isExamPage = useIsExamPage()
  const showFeedback = surveyMode ? false : reviewMode ? true : (showFeedbackProp ?? false)
  // A question in a handed-in (past) exam stage is fully read-only, regardless
  // of submit state — folded into the gates + disabled props below.
  // Review mode (graded read-only view) locks the widget just like a handed-in
  // stage: no edits, no submit button.
  const stageLocked = useStageLocked() || reviewMode

  // Free-text auto-check: grade the typed output against `expected`. Off in
  // survey mode (surveys have no right/wrong).
  const autoCheck = !surveyMode && type === 'text' && expected != null
  const compareOpts = { ignoreCase, ignoreWhitespace }
  const maxPoints = points ?? 1
  // Initialize state from saved data
  const [selected, setSelected] = useState<number[]>(initialData?.selected ?? [])
  const [textAnswer, setTextAnswer] = useState(initialData?.textAnswer ?? '')
  const [numberAnswer, setNumberAnswer] = useState(initialData?.numberAnswer ?? minValue)
  const [rangeAnswer, setRangeAnswer] = useState<{ min: number; max: number }>(
    initialData?.rangeAnswer ?? { min: minValue, max: maxValue }
  )
  const [isSubmitted, setIsSubmitted] = useState(initialData?.isSubmitted ?? false)

  // Review mode swaps initialData to the reviewed student's answer *after* mount
  // (it arrives from an async fetch), so re-sync local state when it changes.
  // useState only reads its initializer once. Gated to reviewMode (read-only),
  // so it never fights live editing on a normal attempt.
  useEffect(() => {
    if (!reviewMode) return
    setSelected(initialData?.selected ?? [])
    setTextAnswer(initialData?.textAnswer ?? '')
    setNumberAnswer(initialData?.numberAnswer ?? minValue)
    setRangeAnswer(initialData?.rangeAnswer ?? { min: minValue, max: maxValue })
    setIsSubmitted(initialData?.isSubmitted ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, reviewMode])


  // Input handlers only mutate local state; persistence is the autosave effect
  // below. Edits are allowed any time the widget isn't frozen (handed-in stage
  // or graded review).
  const handleSelect = (index: number) => {
    if (stageLocked) return

    if (type === 'single') {
      setSelected([index])
    } else {
      setSelected(prev =>
        prev.includes(index)
          ? prev.filter(i => i !== index)
          : [...prev, index]
      )
    }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (stageLocked) return
    setTextAnswer(e.target.value)
  }

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (stageLocked) return
    setNumberAnswer(Number(e.target.value))
  }

  const handleRangeMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (stageLocked) return
    const newMin = Number(e.target.value)
    setRangeAnswer(prev => ({
      min: Math.min(newMin, prev.max),
      max: prev.max
    }))
  }

  const handleRangeMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (stageLocked) return
    const newMax = Number(e.target.value)
    setRangeAnswer(prev => ({
      min: prev.min,
      max: Math.max(newMax, prev.min)
    }))
  }

  const isEmptyAnswer =
    ((type === 'single' || type === 'multiple') && selected.length === 0) ||
    (type === 'text' && !textAnswer.trim()) ||
    (type === 'number' && numberAnswer === undefined) ||
    (type === 'range' && rangeAnswer === undefined)

  // Assemble a QuizData record from current widget state. Lifted out of the old
  // handleSubmit so autosave and the dedup baseline share one shape. The
  // text/choice auto-scores computed here are for LIVE teacher preview only —
  // authoritative grading re-derives them on the teacher's device (see
  // score-component.ts / exam-review-context). Choice indices are dense
  // element-only positions (0,1,2,…) — see extractOptionsInfo.
  const buildQuizData = (submitted: boolean): QuizData => {
    let textFields: Partial<QuizData> = {}
    if (type === 'text') {
      textFields = { textAnswer }
      if (autoCheck) {
        const r = compareOutput(textAnswer, expected as string, compareOpts)
        textFields.textRatio = r.ratio
        textFields.textScore = scoreFromRatio(r.ratio, maxPoints)
      }
    }

    let choiceFields: Partial<QuizData> = {}
    if ((type === 'single' || type === 'multiple') && !surveyMode) {
      const { correctIndices } = extractOptionsInfo(children, type)
      if (correctIndices.length > 0) {
        const sel = [...selected].sort((a, b) => a - b)
        const cor = [...correctIndices].sort((a, b) => a - b)
        const exact = sel.length === cor.length && sel.every((v, i) => v === cor[i])
        choiceFields.choiceScore = exact ? maxPoints : 0
      }
    }

    return {
      isSubmitted: submitted,
      ...(type === 'single' || type === 'multiple' ? { selected } : {}),
      ...choiceFields,
      ...textFields,
      ...(type === 'number' ? { numberAnswer } : {}),
      ...(type === 'range' ? { rangeAnswer } : {})
    }
  }

  // Autosave-on-change. Commits the current answer (deduped by content) to
  // IndexedDB and syncs it. The 400ms debounce below already coalesces typing
  // and slider drags into one commit, so we sync `immediate: true` (like the
  // old Submit did) — the sync engine's debounced path drops items when a sync
  // is already in flight, which would silently strand answers until hand-in.
  // Skipped while reviewing/locked or empty.
  const lastSavedSigRef = useRef<string | null>(null)
  const mountedRef = useRef(false)

  const commitAutosave = () => {
    if (reviewMode || stageLocked || isEmptyAnswer) return
    const data = buildQuizData(true)
    const sig = JSON.stringify(data)
    if (sig === lastSavedSigRef.current) return
    lastSavedSigRef.current = sig
    if (!isSubmitted) setIsSubmitted(true)
    void updateData(data, { immediate: true })
    // Snapshot text answers (exam pages only) so the teacher gets an answer
    // history. Deduped by the signature check above. Survey passes no callback.
    if (type === 'text' && isExamPage) onAutosaveCheckpoint?.(data)
  }

  useEffect(() => {
    // First run = mount: seed the dedup baseline from hydrated data (so an
    // unchanged returning answer doesn't re-save) and never save on mount.
    if (!mountedRef.current) {
      mountedRef.current = true
      lastSavedSigRef.current =
        reviewMode || stageLocked || isEmptyAnswer ? null : JSON.stringify(buildQuizData(true))
      return
    }
    const delay = type === 'text' ? AUTOSAVE_TEXT_MS : AUTOSAVE_DISCRETE_MS
    const t = setTimeout(commitAutosave, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, textAnswer, numberAnswer, rangeAnswer, reviewMode, stageLocked])

  // Live auto-check result for the text feedback panel (recomputed from the
  // current answer; matches the persisted score when the answer is unedited).
  const textResult = autoCheck ? compareOutput(textAnswer, expected as string, compareOpts) : null

  // For single/multiple choice, the inline prompt is the question's text
  // children (the answers are element children). Render it above the options in
  // the same muted style as the text-question prompt. Empty when the author put
  // the question text in surrounding markdown instead.
  const choicePrompt =
    type === 'single' || type === 'multiple'
      ? Children.toArray(children)
          .filter((c) => typeof c === 'string')
          .join('')
          .trim()
      : ''

  return (
    <div className="space-y-4 border rounded-lg p-4 shadow-sm bg-card my-4" data-source-line-start={sourceLineStart} data-source-line-end={sourceLineEnd}>
      {/* Single/Multiple Choice */}
      {(type === 'single' || type === 'multiple') && (
        <div className="space-y-2">
          {choicePrompt && (
            <div className="text-muted-foreground text-sm">{choicePrompt}</div>
          )}
          {/* Filter to element (answer) children first so `index` is the dense
              0..N-1 option position that matches extractOptionsInfo / stored
              `selected`. Skips the prompt text node and inter-answer whitespace. */}
          {Children.toArray(children)
            .filter((child): child is ReactElement<OptionProps> =>
              !!child && typeof child === 'object' && 'props' in child && !!(child as ReactElement<OptionProps>).props
            )
            .map((element, index) => {
            const optionProps = element.props
            const isSelected = selected.includes(index)
            const optionIsCorrect = isCorrect(optionProps.correct)
            const showResult = isSubmitted && showFeedback

            return (
              <div
                key={index}
                onClick={() => handleSelect(index)}
                className={cn(
                  'p-4 border rounded-lg transition-colors',
                  stageLocked ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50',
                  isSelected && !showResult && 'border-primary bg-primary/5',
                  showResult && isSelected && optionIsCorrect && 'border-green-600 dark:border-green-500 bg-green-500/10',
                  showResult && isSelected && !optionIsCorrect && 'border-red-600 dark:border-red-500 bg-red-500/10',
                  showResult && !isSelected && optionIsCorrect && 'border-green-600/50 dark:border-green-500/50'
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Radio/Checkbox indicator */}
                  <div className="mt-0.5">
                    {type === 'single' ? (
                      <div className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                        isSelected ? 'border-primary' : 'border-muted-foreground/40'
                      )}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                    ) : (
                      <div className={cn(
                        'w-4 h-4 rounded border-2 flex items-center justify-center',
                        isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                      )}>
                        {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                    )}
                  </div>

                  {/* Option content */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {optionProps.children}
                      {showResult && isSelected && (
                        optionIsCorrect
                          ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                          : <X className="w-4 h-4 text-red-600 dark:text-red-400" />
                      )}
                    </div>

                    {/* Feedback */}
                    {showResult && optionProps.feedback && isSelected && (
                      <div className="mt-2 p-2 rounded text-sm bg-muted/50">
                        <span className={optionIsCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                          {optionIsCorrect ? '✓ ' : '✗ '}
                        </span>
                        {optionProps.feedback}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Text Question */}
      {type === 'text' && (
        <div className="space-y-2">
          {/* Prompt above the textarea — reads as a question label */}
          <div className="text-muted-foreground text-sm">
            {children}
          </div>
          <textarea
            value={textAnswer}
            onChange={handleTextChange}
            onBlur={commitAutosave}
            disabled={stageLocked}
            className={cn(
              'w-full p-3 border rounded-lg min-h-[120px] bg-background resize-y',
              stageLocked && 'opacity-70 cursor-not-allowed'
            )}
            placeholder="Enter your answer..."
          />

          {/* Auto-check feedback: partial-credit score + a line diff showing
              where the prediction differs from the expected output. */}
          {autoCheck && isSubmitted && showFeedback && textResult && (
            <div
              className={cn(
                'rounded-lg border p-3 text-sm',
                textResult.exact
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-amber-500/40 bg-amber-500/10'
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {textResult.exact ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-green-600 dark:text-green-400">Correct</span>
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">Partially correct</span>
                  </>
                )}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {scoreFromRatio(textResult.ratio, maxPoints)} / {maxPoints} pts · {Math.round(textResult.ratio * 100)}%
                </span>
              </div>
              {!textResult.exact && (
                <div className="mt-2 overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs leading-relaxed whitespace-pre">
                  {textResult.diff.map((row, i) => (
                    <div
                      key={i}
                      className={cn(
                        row.type === 'expected' && 'bg-green-500/10 text-green-700 dark:text-green-400',
                        row.type === 'student' && 'bg-red-500/10 text-red-700 line-through dark:text-red-400',
                        row.type === 'equal' && 'text-muted-foreground'
                      )}
                    >
                      <span className="select-none opacity-60">
                        {row.type === 'expected' ? '+ ' : row.type === 'student' ? '− ' : '  '}
                      </span>
                      {row.value || ' '}
                    </div>
                  ))}
                  <div className="mt-1.5 select-none text-[10px] text-muted-foreground">
                    <span className="text-green-700 dark:text-green-400">+ expected</span>
                    {'   '}
                    <span className="text-red-700 dark:text-red-400">&minus; your answer</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Number/Slider Question */}
      {type === 'number' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{minValue}</span>
              <span className="font-semibold text-foreground">{numberAnswer}</span>
              <span>{maxValue}</span>
            </div>
            <input
              type="range"
              min={minValue}
              max={maxValue}
              step={step}
              value={numberAnswer}
              onChange={handleNumberChange}
              disabled={stageLocked}
              className={cn(
                'w-full',
                stageLocked && 'opacity-70 cursor-not-allowed'
              )}
            />
            {/* Optional end labels — sit directly under the track, one at
                each extreme. */}
            {(minLabel || maxLabel) && (
              <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                <span className="text-left">{minLabel}</span>
                <span className="text-right">{maxLabel}</span>
              </div>
            )}
          </div>
          <div className="text-muted-foreground text-sm">
            {children}
          </div>
        </div>
      )}

      {/* Range Slider Question */}
      {type === 'range' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{minValue}</span>
              <span className="font-semibold text-foreground">
                {rangeAnswer.min} – {rangeAnswer.max}
              </span>
              <span>{maxValue}</span>
            </div>
            {/* Dual range slider track - touch compatible via clip-path */}
            <div className="relative h-8 touch-none">
              {/* Background track */}
              <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 bg-muted rounded-full" />
              {/* Selected range highlight */}
              <div
                className="absolute top-1/2 h-2 -translate-y-1/2 bg-primary rounded-full pointer-events-none"
                style={{
                  left: `${((rangeAnswer.min - minValue) / (maxValue - minValue)) * 100}%`,
                  right: `${100 - ((rangeAnswer.max - minValue) / (maxValue - minValue)) * 100}%`
                }}
              />
              {/* Min slider - clipped to left half (up to midpoint between thumbs) */}
              <input
                type="range"
                min={minValue}
                max={maxValue}
                step={step}
                value={rangeAnswer.min}
                onChange={handleRangeMinChange}
                disabled={stageLocked}
                className={cn(
                  'absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer',
                  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
                  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary',
                  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background',
                  '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer',
                  '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5',
                  '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary',
                  '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background',
                  '[&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0',
                  '[&::-moz-range-track]:bg-transparent',
                  stageLocked && 'opacity-70 cursor-not-allowed'
                )}
                style={{
                  clipPath: `inset(0 ${100 - ((rangeAnswer.min + rangeAnswer.max) / 2 - minValue) / (maxValue - minValue) * 100}% 0 0)`
                }}
              />
              {/* Max slider - clipped to right half (from midpoint between thumbs) */}
              <input
                type="range"
                min={minValue}
                max={maxValue}
                step={step}
                value={rangeAnswer.max}
                onChange={handleRangeMaxChange}
                disabled={stageLocked}
                className={cn(
                  'absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer',
                  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
                  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary',
                  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background',
                  '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer',
                  '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5',
                  '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary',
                  '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background',
                  '[&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0',
                  '[&::-moz-range-track]:bg-transparent',
                  stageLocked && 'opacity-70 cursor-not-allowed'
                )}
                style={{
                  clipPath: `inset(0 0 0 ${((rangeAnswer.min + rangeAnswer.max) / 2 - minValue) / (maxValue - minValue) * 100}%)`
                }}
              />
            </div>
          </div>
          <div className="text-muted-foreground text-sm">
            {children}
          </div>
        </div>
      )}

      {/* Autosave indicator — answers persist on change; no explicit submit.
          Hidden in review (read-only), in survey mode (the page-level Send is
          the submit affordance there), and until the first non-empty answer. */}
      {isSubmitted && !reviewMode && !stageLocked && !surveyMode && (
        <div className="flex items-center justify-end pt-2">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Check className="w-4 h-4 text-green-500" />
            <span>Saved</span>
          </div>
        </div>
      )}

      {/* In-exam grade badge (teacher grading / student returned review). */}
      {componentId && <ScoreBadge componentId={componentId} />}
    </div>
  )
}

// Recursively walk a ReactNode and concatenate its text content. Needed
// because option content can be more than a bare string (e.g. inline HTML
// like <br>, or rehype-raw splitting "foo&amp;bar" into multiple nodes).
function extractTextFromChildren(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromChildren).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractTextFromChildren((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

// Build the option-label and correct-index arrays the teacher view consumes.
//
// Indices are DENSE element-only positions (0,1,2,…): we count only the
// `<answer>` element children, skipping the prompt text and any whitespace text
// nodes between answers. The rendering UI (the Children.toArray map below) and
// `handleSelect` must filter to element children the same way so stored
// `selected`, `correctIndices`, and `options[i]` in quiz-progress-bar all align.
function extractOptionsInfo(children: ReactNode, type: 'single' | 'multiple' | 'text' | 'number' | 'range') {
  const correctIndices: number[] = []
  const optionLabels: string[] = []

  if (type === 'single' || type === 'multiple') {
    let i = 0
    Children.forEach(children, (child) => {
      if (child && typeof child === 'object' && 'props' in child) {
        const element = child as ReactElement<OptionProps>
        if (element.props) {
          if (element.props.correct === 'true') {
            correctIndices.push(i)
          }
          const text = extractTextFromChildren(element.props.children).trim()
          optionLabels[i] = text || `Option ${i + 1}`
          i++
        }
      }
    })
  }

  return { correctIndices, optionLabels }
}

// Router: branch on whether we're inside a <Survey> region. Both predicates
// must hold — the page-level SurveyProvider is mounted whenever ANY <survey>
// tag exists on the page, so its presence alone would wrongly survey-mode a
// demo/info question that happens to live on a page with a survey but outside
// any <survey> block. useInSurveyRegion() comes from the <Survey> wrapper and
// is only true for actual descendants.
function Question(props: QuestionProps) {
  const survey = useSurvey()
  const inSurveyRegion = useInSurveyRegion()
  if (survey && inSurveyRegion) {
    return <SurveyQuestion {...props} survey={survey} />
  }
  return <SyncedQuestion {...props} />
}

// Survey-mode variant. Uses the same useSyncedUserData path as classroom
// questions (with localOnly:true so it never syncs to server) — refresh
// persists per-question Save state for both anonymous visitors (userId
// 'anonymous') and logged-in authors (their userId). The page-level
// SurveyProvider holds an in-memory mirror via registerAnswer so the Send
// button knows which answers exist and can POST them as one batch.
//
// When the viewer is the page author, the existing QuizProgressBar is
// rendered below using the implicit class id resolved by the provider —
// author sees per-question response visibility without picking a class
// from the toolbar (implicit classes are hidden from there).
function SurveyQuestion({
  children,
  id,
  pageId,
  type = 'multiple',
  survey,
  ...rest
}: QuestionProps & { survey: SurveyContextValue }) {
  const componentId = `quiz-${id}`
  const { correctIndices, optionLabels } = extractOptionsInfo(children, type)

  // Same hook path as classroom Question, just with localOnly so the
  // sync engine never pushes this record to the server. Per-question
  // refresh persistence is therefore handled by the shared IndexedDB
  // layer, not parallel localStorage.
  const { data, updateData, isLoading } = useSyncedUserData<QuizData>(
    pageId,
    componentId,
    null,
    { localOnly: true }
  )

  // Adapter: extract the answer value from a QuizData record so the provider
  // can compute the dirty/clean signature without caring about widget shape.
  const valueFromQuizData = (qd: QuizData): unknown => {
    if (type === 'single' || type === 'multiple') return qd.selected
    if (type === 'text') return qd.textAnswer
    if (type === 'number') return qd.numberAnswer
    if (type === 'range') return qd.rangeAnswer
    return null
  }

  // Wrap updateData so every per-question Save also notifies the provider's
  // in-memory mirror (Send button's counter + POST payload depends on it).
  const updateDataAndNotify = async (qd: QuizData, opts?: { immediate?: boolean }) => {
    await updateData(qd, opts)
    survey.registerAnswer(id, type as SurveyAnswerType, valueFromQuizData(qd))
  }

  // Hydration sync: when useSyncedUserData finishes loading, register the
  // restored value with the provider exactly once. Without this, the Send
  // button's counter and POST payload would be empty after refresh even
  // though the questions visibly show their persisted state.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (isLoading) return
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (data?.isSubmitted) {
      survey.registerAnswer(id, type as SurveyAnswerType, valueFromQuizData(data))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data])

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4 mb-4" />
        <div className="space-y-2">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    )
  }

  return (
    <>
      <QuestionInner
        {...rest}
        type={type}
        initialData={data}
        updateData={updateDataAndNotify}
        surveyMode={true}
      >
        {children}
      </QuestionInner>

      {survey.isAuthor && survey.implicitClassId && survey.responseCount > 0 && (
        <QuizProgressBar
          classId={survey.implicitClassId}
          className="Responses"
          pageId={pageId}
          componentId={componentId}
          questionType={type}
          correctIndices={correctIndices}
          options={optionLabels}
          minValue={rest.minValue}
          maxValue={rest.maxValue}
        />
      )}
    </>
  )
}

// Classroom-mode (default) variant. Syncs answers per-user via the existing
// userdata hook and renders the teacher's progress-bar view when applicable.
function SyncedQuestion({
  children,
  id,
  pageId,
  type = 'multiple',
  gateAt,
  ...rest
}: QuestionProps) {
  const componentId = `quiz-${id}`
  const { data, updateData, isLoading } = useSyncedUserData<QuizData>(
    pageId,
    componentId,
    null
  )

  // Get teacher class context for progress bar
  const { selectedClass, isTeacher } = useTeacherClass()

  // In-exam graded view: teacher grading this student (show their answer +
  // editable score) or student reviewing their returned exam (read-only).
  // Must run before the isLoading early return (rules of hooks).
  const { active: reviewActive, mode: reviewModeType, review, studentId: reviewStudentId, loadedStudentId: reviewLoadedStudentId, refreshGrades } =
    useComponentReview(componentId)

  // Extract correct indices and option labels for the progress bar
  const { correctIndices, optionLabels } = extractOptionsInfo(children, type)

  // Coupled-video gate: register this question's mark, and on a fully-correct
  // submission resume the paused video. No-op when there's no coupled video.
  const coupledVideo = useCoupledVideo()
  useGate(componentId, gateAt != null ? parseTimecode(gateAt) : undefined)

  const isAnswerCorrect = (qd: QuizData | null | undefined): boolean => {
    if (!qd?.isSubmitted) return false
    // Auto-checked text question: only a fully exact answer (ratio 1) counts as
    // correct for green/gate; partial credit does not open a coupled-video gate.
    if (type === 'text') return (qd.textRatio ?? -1) === 1
    if (type !== 'single' && type !== 'multiple') return false
    const sel = [...(qd.selected ?? [])].sort((a, b) => a - b)
    const correct = [...correctIndices].sort((a, b) => a - b)
    return correct.length > 0 && sel.length === correct.length && sel.every((v, i) => v === correct[i])
  }

  const updateDataAndGate = async (qd: QuizData, opts?: { immediate?: boolean }) => {
    await updateData(qd, opts)
    if (coupledVideo && isAnswerCorrect(qd)) coupledVideo.markPassed(componentId)
  }

  // Hydration: if the answer was already submitted correctly in a prior
  // session, re-mark the gate once on load so a coupled video that pauses at
  // this mark resumes (gate state is per-mount; persistence is per answer).
  const gateHydratedRef = useRef(false)
  useEffect(() => {
    if (isLoading || gateHydratedRef.current) return
    gateHydratedRef.current = true
    if (coupledVideo && isAnswerCorrect(data)) coupledVideo.markPassed(componentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data, coupledVideo])

  // Authoritative auto-grade, computed on the TEACHER's device (grade mode).
  // Re-derives this question's score from the student's RAW answer + this
  // question's answer key (rendered here = trusted) and persists it as the
  // component's check score (ComponentScore source="check") — the same authoritative store python checks use.
  // The client-stored choiceScore/textScore is never trusted for the grade.
  // Free text without an `expected` key and number/range yield no auto score
  // (teacher grades them manually via an override). Runs once per (student,
  // component); refreshGrades reloads the totals after.
  const autoGradedRef = useRef<string | null>(null)
  useEffect(() => {
    if (reviewModeType !== 'grade' || !reviewStudentId) return
    // Only act when the loaded review data is for THIS student. On a student
    // switch, reviewStudentId updates before the async /review reload lands, so
    // answerPayload briefly belongs to the previous student — grading it here
    // would write one student's correctness onto another's check-run.
    if (reviewLoadedStudentId !== reviewStudentId) return
    const payload = review?.answerPayload as QuizData | undefined
    if (!payload) return

    let earned: number | null = null
    if (type === 'single' || type === 'multiple') {
      if (correctIndices.length > 0) {
        const sel = [...(payload.selected ?? [])].sort((a, b) => a - b)
        const cor = [...correctIndices].sort((a, b) => a - b)
        const exact = sel.length === cor.length && sel.every((v, i) => v === cor[i])
        earned = exact ? (rest.points ?? 1) : 0
      }
    } else if (type === 'text' && rest.expected != null) {
      const r = compareOutput(payload.textAnswer ?? '', rest.expected, {
        ignoreCase: rest.ignoreCase,
        ignoreWhitespace: rest.ignoreWhitespace,
      })
      earned = scoreFromRatio(r.ratio, rest.points ?? 1)
    }
    if (earned == null) return

    const key = `${reviewStudentId}:${componentId}`
    if (autoGradedRef.current === key) return
    autoGradedRef.current = key
    fetch(`/api/exams/${pageId}/check-run`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: reviewStudentId,
        componentId,
        earned,
        max: rest.points ?? 1,
        passed: 0,
        total: 0,
      }),
    })
      .then((r) => { if (r.ok) refreshGrades() })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewModeType, reviewStudentId, reviewLoadedStudentId, componentId, review?.answerPayload, pageId])

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4 mb-4" />
        <div className="space-y-2">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    )
  }

  // Grade mode: the displayed answer MUST be the selected student's (from the
  // review context). While `review` is null — loading, or a just-switched student
  // whose data hasn't landed — show the skeleton; never fall back to `data` (the
  // teacher's own IndexedDB answer) or a stale student's payload.
  if (reviewActive && reviewModeType === 'grade' && !review) {
    return (
      <div className="border rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4 mb-4" />
        <div className="space-y-2">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    )
  }

  // Grade mode: ALWAYS the selected student's submitted answer — never the
  // teacher's own `data`. `review` is non-null here (the skeleton above guards the
  // loading gap). A null answerPayload means this student left the question blank,
  // so render EMPTY; previously it fell back to `data`, leaking the teacher's own
  // (or a stale) answer under a student who submitted nothing.
  const effectiveData =
    reviewActive && reviewModeType === 'grade'
      ? ((review?.answerPayload as QuizData | null) ?? null)
      : data

  return (
    <>
      <QuestionInner
        {...rest}
        type={type}
        initialData={effectiveData}
        updateData={updateDataAndGate}
        componentId={componentId}
        reviewMode={reviewActive}
        onAutosaveCheckpoint={(qd) => {
          void postCheckpoint({ pageId, componentId, kind: 'autosave', payload: qd })
        }}
      >
        {children}
      </QuestionInner>

      {/* Teacher answer-history timeline — grade mode + text only (the
          snapshots route is teacher-only, so never in student review mode). */}
      {reviewActive && reviewModeType === 'grade' && type === 'text' && reviewStudentId && (
        <TextAnswerHistory pageId={pageId} studentId={reviewStudentId} componentId={componentId} />
      )}

      {/* Teacher progress bar - only visible when teacher has selected a class */}
      {isTeacher && selectedClass && !reviewActive && (
        <QuizProgressBar
          classId={selectedClass.id}
          className={selectedClass.name}
          pageId={pageId}
          componentId={componentId}
          questionType={type}
          correctIndices={correctIndices}
          options={optionLabels}
          minValue={rest.minValue}
          maxValue={rest.maxValue}
          autoCheck={type === 'text' && rest.expected != null}
        />
      )}
    </>
  )
}

function Option({ children }: OptionProps) {
  // This component is just a container for props
  // The actual rendering happens in Question
  return <>{children}</>
}

// Attach Option as static property
Question.Option = Option

export { Question, Option }
