'use client'

import { useSearchParams } from 'next/navigation'
import { SignInForm } from '@/components/auth/signin-form'

export default function SignInPage() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  // Get account type from URL parameter, default to 'student' for subdomains
  const accountType = (searchParams.get('type') as 'teacher' | 'student') || 'student'

  return <SignInForm accountType={accountType} callbackUrl={callbackUrl} />
}
