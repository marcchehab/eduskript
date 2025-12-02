'use client'

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorModal, ErrorDetails } from '@/components/ui/error-modal'
import { setGlobalErrorHandler, clearGlobalErrorHandler } from '@/lib/api-error-handler'
import { getSignInUrl, getTeacherPageSlug } from '@/lib/auth-redirect'

interface ErrorContextType {
  showError: (error: ErrorDetails, options?: ErrorOptions) => void
  hideError: () => void
  isVisible: boolean
}

interface ErrorOptions {
  variant?: 'error' | 'warning' | 'info'
  showRetry?: boolean
  showDontShowAgain?: boolean
  onRetry?: () => void
  autoRedirectOn401?: boolean
}

interface ErrorState {
  error: ErrorDetails | null
  options: ErrorOptions
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined)

export function ErrorProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [errorState, setErrorState] = useState<ErrorState>({
    error: null,
    options: {}
  })
  
  // Track suppressed errors per session to avoid spam
  const [suppressedErrors, setSuppressedErrors] = useState<Set<string>>(new Set())

  const showError = useCallback((error: ErrorDetails, options: ErrorOptions = {}) => {
    // Create a unique key for this error type to handle "don't show again"
    const errorKey = `${error.status}-${error.endpoint || 'unknown'}`
    
    // Check if this error type has been suppressed this session
    if (suppressedErrors.has(errorKey)) {
      return
    }

    // Set default options
    const finalOptions: ErrorOptions = {
      variant: error.status >= 400 && error.status < 500 ? 'warning' : 'error',
      showRetry: error.status !== 401 && error.status !== 403, // Don't show retry for auth errors
      showDontShowAgain: true,
      autoRedirectOn401: true,
      ...options
    }

    setErrorState({
      error,
      options: finalOptions
    })
  }, [suppressedErrors])

  // Register this error handler as the global handler
  useEffect(() => {
    setGlobalErrorHandler(showError)
    
    return () => {
      clearGlobalErrorHandler()
    }
  }, [showError])

  const hideError = useCallback(() => {
    setErrorState({
      error: null,
      options: {}
    })
  }, [])

  const handleRetry = useCallback(() => {
    if (errorState.options.onRetry) {
      errorState.options.onRetry()
    }
    hideError()
  }, [errorState.options, hideError])

  const handleDontShowAgain = useCallback(() => {
    if (errorState.error) {
      const errorKey = `${errorState.error.status}-${errorState.error.endpoint || 'unknown'}`
      setSuppressedErrors(prev => new Set(prev).add(errorKey))
    }
    hideError()
  }, [errorState.error, hideError])

  const handleClose = useCallback(() => {
    // Handle 401 auto-redirect
    if (errorState.error?.status === 401 && errorState.options.autoRedirectOn401) {
      // Determine sign-in context from current pathname
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
      const pageSlug = getTeacherPageSlug(pathname)
      const signInUrl = getSignInUrl(pathname, pageSlug)
      router.push(signInUrl)
      return
    }

    hideError()
  }, [errorState.error, errorState.options, router, hideError])

  return (
    <ErrorContext.Provider value={{ showError, hideError, isVisible: !!errorState.error }}>
      {children}
      
      {errorState.error && (
        <ErrorModal
          isOpen={true}
          onClose={handleClose}
          error={errorState.error}
          variant={errorState.options.variant}
          showRetry={errorState.options.showRetry}
          showDontShowAgain={errorState.options.showDontShowAgain}
          onRetry={errorState.options.onRetry ? handleRetry : undefined}
          onDontShowAgain={handleDontShowAgain}
        />
      )}
    </ErrorContext.Provider>
  )
}

export function useErrorHandler() {
  const context = useContext(ErrorContext)
  if (context === undefined) {
    throw new Error('useErrorHandler must be used within an ErrorProvider')
  }
  return context
}