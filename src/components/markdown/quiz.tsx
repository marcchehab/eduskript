"use client"

import { useState, ReactNode, ReactElement, Children } from 'react'
import { useSyncedUserData } from '@/lib/userdata'
import type { QuizData } from '@/lib/userdata/types'
import { cn } from '@/lib/utils'
import { Check, X } from 'lucide-react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { QuizProgressBar } from './quiz-progress-bar'

interface QuestionProps {
  children: ReactNode
  type?: 'single' | 'multiple' | 'text' | 'number' | 'range'
  id: string
  pageId: string
  showFeedback?: boolean
  allowUpdate?: boolean
  minValue?: number
  maxValue?: number
  step?: number
}

interface OptionProps {
  children: ReactNode
  feedback?: string
  is?: 'true' | 'false'
}

// Parse is prop to boolean
const isCorrect = (value: 'true' | 'false' | undefined): boolean => value === 'true'

// Inner component that renders after data is loaded
function QuestionInner({
  children,
  type = 'multiple',
  showFeedback = true,
  allowUpdate = false,
  minValue = 0,
  maxValue = 100,
  step = 1,
  initialData,
  updateData
}: Omit<QuestionProps, 'id' | 'pageId'> & {
  initialData: QuizData | null
  updateData: (data: QuizData, options?: { immediate?: boolean }) => Promise<void>
}) {
  // Initialize state from saved data
  const [selected, setSelected] = useState<number[]>(initialData?.selected ?? [])
  const [textAnswer, setTextAnswer] = useState(initialData?.textAnswer ?? '')
  const [numberAnswer, setNumberAnswer] = useState(initialData?.numberAnswer ?? minValue)
  const [rangeAnswer, setRangeAnswer] = useState<{ min: number; max: number }>(
    initialData?.rangeAnswer ?? { min: minValue, max: maxValue }
  )
  const [isSubmitted, setIsSubmitted] = useState(initialData?.isSubmitted ?? false)

  // Handle selection for choice questions
  const handleSelect = (index: number) => {
    if (!allowUpdate && isSubmitted) return

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

  // Handle text input
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!allowUpdate && isSubmitted) return
    setTextAnswer(e.target.value)
  }

  // Handle number input
  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!allowUpdate && isSubmitted) return
    setNumberAnswer(Number(e.target.value))
  }

  // Handle range input
  const handleRangeMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!allowUpdate && isSubmitted) return
    const newMin = Number(e.target.value)
    setRangeAnswer(prev => ({
      min: Math.min(newMin, prev.max),
      max: prev.max
    }))
  }

  const handleRangeMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!allowUpdate && isSubmitted) return
    const newMax = Number(e.target.value)
    setRangeAnswer(prev => ({
      min: prev.min,
      max: Math.max(newMax, prev.min)
    }))
  }

  // Submit answer
  const handleSubmit = async () => {
    if (
      ((type === 'single' || type === 'multiple') && selected.length === 0) ||
      (type === 'text' && !textAnswer.trim()) ||
      (type === 'number' && numberAnswer === undefined) ||
      (type === 'range' && rangeAnswer === undefined)
    ) return

    setIsSubmitted(true)

    const quizData: QuizData = {
      isSubmitted: true,
      ...(type === 'single' || type === 'multiple' ? { selected } : {}),
      ...(type === 'text' ? { textAnswer } : {}),
      ...(type === 'number' ? { numberAnswer } : {}),
      ...(type === 'range' ? { rangeAnswer } : {})
    }

    await updateData(quizData, { immediate: true })
  }

  const isButtonDisabled =
    ((type === 'single' || type === 'multiple') && selected.length === 0) ||
    (type === 'text' && !textAnswer.trim()) ||
    (type === 'number' && numberAnswer === undefined) ||
    (type === 'range' && rangeAnswer === undefined)

  return (
    <div className="space-y-4 border rounded-lg p-4 shadow-sm bg-card">
      {/* Single/Multiple Choice */}
      {(type === 'single' || type === 'multiple') && (
        <div className="space-y-2">
          {Array.isArray(children) ? children.map((child, index) => {
            if (!child || typeof child !== 'object') return null
            const element = child as ReactElement<OptionProps>
            if (!element.props) return null

            const optionProps = element.props
            const isSelected = selected.includes(index)
            const optionIsCorrect = isCorrect(optionProps.is)
            const showResult = isSubmitted && showFeedback

            return (
              <div
                key={index}
                onClick={() => handleSelect(index)}
                className={cn(
                  'p-4 border rounded-lg transition-colors',
                  allowUpdate || !isSubmitted ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default',
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
          }) : children}
        </div>
      )}

      {/* Text Question */}
      {type === 'text' && (
        <div className="space-y-2">
          <textarea
            value={textAnswer}
            onChange={handleTextChange}
            disabled={isSubmitted && !allowUpdate}
            className={cn(
              'w-full p-3 border rounded-lg min-h-[120px] bg-background resize-y',
              isSubmitted && !allowUpdate && 'opacity-70 cursor-not-allowed'
            )}
            placeholder="Enter your answer..."
          />
          <div className="text-muted-foreground text-sm">
            {children}
          </div>
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
              disabled={isSubmitted && !allowUpdate}
              className={cn(
                'w-full',
                isSubmitted && !allowUpdate && 'opacity-70 cursor-not-allowed'
              )}
            />
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
                disabled={isSubmitted && !allowUpdate}
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
                  isSubmitted && !allowUpdate && 'opacity-70 cursor-not-allowed'
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
                disabled={isSubmitted && !allowUpdate}
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
                  isSubmitted && !allowUpdate && 'opacity-70 cursor-not-allowed'
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

      {/* Submit Button */}
      <div className="flex items-center justify-between pt-2">
        {(!isSubmitted || allowUpdate) && (
          <button
            onClick={handleSubmit}
            disabled={isButtonDisabled}
            className={cn(
              'px-4 py-2 rounded-lg font-medium transition-colors',
              'bg-primary text-primary-foreground',
              isButtonDisabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-primary/90'
            )}
          >
            {isSubmitted && allowUpdate ? 'Update' : 'Submit'}
          </button>
        )}

        {/* Status indicator */}
        {isSubmitted && (
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Check className="w-4 h-4 text-green-500" />
            <span>Saved</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper to extract correct indices and option labels from children
function extractOptionsInfo(children: ReactNode, type: 'single' | 'multiple' | 'text' | 'number' | 'range') {
  const correctIndices: number[] = []
  const optionLabels: string[] = []

  if (type === 'single' || type === 'multiple') {
    Children.forEach(children, (child, index) => {
      if (child && typeof child === 'object' && 'props' in child) {
        const element = child as ReactElement<OptionProps>
        if (element.props) {
          // Check if this option is marked as correct
          if (element.props.is === 'true') {
            correctIndices.push(index)
          }
          // Extract text content for option label
          const label = typeof element.props.children === 'string'
            ? element.props.children
            : `Option ${index + 1}`
          optionLabels.push(label)
        }
      }
    })
  }

  return { correctIndices, optionLabels }
}

// Wrapper component that handles data loading
function Question({
  children,
  id,
  pageId,
  type = 'multiple',
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

  // Extract correct indices and option labels for the progress bar
  const { correctIndices, optionLabels } = extractOptionsInfo(children, type)

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
        updateData={updateData}
      >
        {children}
      </QuestionInner>

      {/* Teacher progress bar - only visible when teacher has selected a class */}
      {isTeacher && selectedClass && (
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
