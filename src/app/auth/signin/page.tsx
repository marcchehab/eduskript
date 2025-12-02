'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { SignInForm } from '@/components/auth/signin-form'

function SignInContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  // If 'from' param is present, user is coming from a teacher's page
  const fromTeacherPage = searchParams.get('from') || undefined

  return <SignInForm fromTeacherPage={fromTeacherPage} callbackUrl={callbackUrl} />
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignInContent />
    </Suspense>
  )
}
