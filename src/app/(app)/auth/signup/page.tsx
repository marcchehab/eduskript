'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, X } from 'lucide-react'

const PAGE_LANGUAGES = [
  { value: 'de-CH', label: 'Deutsch (Schweiz)', flag: '/flags/de-ch.png' },
  { value: 'en-GB', label: 'English (UK)', flag: '/flags/en-gb.svg' },
]

export default function SignUpPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    pageSlug: '',
    pageLanguage: 'en-GB'
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorDetails, setErrorDetails] = useState<string[]>([])
  const [success, setSuccess] = useState('')
  const [showVerificationMessage, setShowVerificationMessage] = useState(false)
  const router = useRouter()

  // Coming from the anonymous skript import (/import): the preview's "Create
  // account" button set a cookie. Then the page speaks German (the import
  // funnel targets German-speaking teachers) and says the skript is waiting;
  // the dashboard claims it after the first login (ImportClaimer).
  const [pendingImport, setPendingImport] = useState<{ title: string; pages: number } | null>(null)
  useEffect(() => {
    fetch('/api/script-import/claim')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.pending) return
        setPendingImport(data.pending)
        setFormData((prev) => ({ ...prev, pageLanguage: 'de-CH' }))
      })
      .catch(() => {})
  }, [])
  const t = (en: string, de: string) => (pendingImport ? de : en)

  const handleOAuthSignUp = (provider: string) => {
    // Set explicit teacher-signup cookie so isStudentSignup() creates a teacher account.
    // Without this, the new safety default (no cookie → student) would create a student.
    document.cookie = 'eduskript-signup-context=teacher-signup; path=/; max-age=600; SameSite=Lax'
    // Use absolute callbackUrl on tunnel domains so the post-OAuth redirect
    // (including the complete-profile redirect) stays on the tunnel URL, not localhost.
    const hostname = window.location.hostname
    const isTunnel = hostname.endsWith('.ngrok-free.dev') || hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok.io')
    const callbackUrl = isTunnel ? `${window.location.origin}/dashboard` : '/dashboard'
    signIn(provider, { callbackUrl })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setErrorDetails([])
    setSuccess('')

    if (formData.password !== formData.confirmPassword) {
      setError(t('Passwords do not match', 'Die Passwörter stimmen nicht überein'))
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          pageSlug: formData.pageSlug,
          pageLanguage: formData.pageLanguage
        })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.requiresEmailVerification) {
          // The German verification text already says it; the API message is English.
          setSuccess(pendingImport ? '' : data.message)
          setShowVerificationMessage(true)
        } else {
          router.push('/auth/signin?message=Account created successfully')
        }
      } else {
        // Format rate-limit messages with human-readable time
        if (data.retryAfter) {
          const mins = Math.ceil(data.retryAfter / 60)
          setError(`Too many registration attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
        } else {
          setError(data.error || 'An error occurred')
        }
        // Show detailed password validation errors
        if (data.details) {
          setErrorDetails(data.details)
        }
      }
    } catch {
      setError(t('An error occurred. Please try again.', 'Etwas ist schiefgelaufen. Bitte nochmals versuchen.'))
    }

    setIsLoading(false)
  }

  const handleResendVerification = async () => {
    setIsLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email })
      })

      const data = await response.json()
      
      if (response.ok) {
        setSuccess(t('Verification email sent successfully!', 'Bestätigungs-Mail erneut gesendet.'))
      } else {
        setError(data.error || 'Failed to resend verification email')
      }
    } catch {
      setError('Failed to resend verification email. Please try again.')
    }

    setIsLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">{t('Create Teacher Account', 'Lehrer-Account erstellen')}</CardTitle>
          <CardDescription className="text-center">
            {pendingImport
              ? `Danach liegt Ihr Skript «${pendingImport.title}» (${pendingImport.pages} ${pendingImport.pages === 1 ? 'Seite' : 'Seiten'}) in Ihrem Account, bereit zum Bearbeiten.`
              : 'Create your teacher account to start building educational content.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showVerificationMessage ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">{t('Check Your Email', 'Bitte E-Mail bestätigen')}</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {pendingImport ? (
                  <>
                    Wir haben einen Bestätigungslink an <strong>{formData.email}</strong> geschickt. Klicken Sie darauf und melden Sie sich an – Ihr Skript «{pendingImport.title}» wird dann automatisch übernommen.
                  </>
                ) : (
                  <>
                    We&apos;ve sent a verification link to <strong>{formData.email}</strong>.
                    Please check your email and click the link to verify your account.
                  </>
                )}
              </p>
              
              {success && (
                <div className="text-green-600 text-sm mb-4">{success}</div>
              )}
              {error && (
                <div className="text-red-600 text-sm mb-4">{error}</div>
              )}
              
              <div className="space-y-2">
                <Button 
                  onClick={handleResendVerification}
                  variant="outline"
                  className="w-full" 
                  disabled={isLoading}
                >
                  {isLoading ? t('Sending...', 'Wird gesendet …') : t('Resend Verification Email', 'Bestätigungs-Mail erneut senden')}
                </Button>
                
                <Link
                  href="/auth/signin"
                  className="inline-flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  {t('Back to Sign In', 'Zur Anmeldung')}
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* OAuth Providers */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleOAuthSignUp('azure-ad')}
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 0h10.87v10.87H0z" fill="#f25022"/>
                    <path d="M12.13 0H23v10.87H12.13z" fill="#00a4ef"/>
                    <path d="M0 12.13h10.87V23H0z" fill="#7fba00"/>
                    <path d="M12.13 12.13H23V23H12.13z" fill="#ffb900"/>
                  </svg>
                  {t('Continue with Microsoft', 'Weiter mit Microsoft')}
                </Button>
              </div>

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    {t('Or sign up with email', 'Oder mit E-Mail registrieren')}
                  </span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('Full Name', 'Name')}</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder={t('Enter your full name', 'Vor- und Nachname')}
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('Email', 'E-Mail')}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder={t('Enter your email', 'name@schule.ch')}
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pageSlug">{t('Page URL', 'Adresse Ihrer Seite')}</Label>
                <Input
                  id="pageSlug"
                  name="pageSlug"
                  type="text"
                  placeholder={t('your-page-name', 'ihr-name')}
                  value={formData.pageSlug}
                  onChange={handleChange}
                />
                <p className="text-sm text-gray-500">
                  {t('Your page URL', 'Ihre Seite')}: eduskript.org/{formData.pageSlug || t('your-page-name', 'ihr-name')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pageLanguage">{t('Page Language', 'Sprache der Seite')}</Label>
                <Select
                  value={formData.pageLanguage}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, pageLanguage: value }))}
                >
                  <SelectTrigger id="pageLanguage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_LANGUAGES.map(lang => (
                      <SelectItem key={lang.value} value={lang.value}>
                        <span className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG/PNG flag icon; Next's image optimizer refuses local SVGs without dangerouslyAllowSVG */}
                          <img src={lang.flag} alt="" width={20} height={14} className="rounded-xs object-cover" />
                          {lang.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500">
                  {t('Language of your page and the example content you start with.', 'Sprache Ihrer Seite und der Beispielinhalte.')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('Password', 'Passwort')}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder={t('Enter your password', 'Passwort wählen')}
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
                {formData.password.length > 0 && (
                  <PasswordRequirements password={formData.password} german={Boolean(pendingImport)} />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('Confirm Password', 'Passwort bestätigen')}</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder={t('Confirm your password', 'Passwort wiederholen')}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
              {error && (
                <div className="text-red-600 text-sm text-center">
                  <p>{error}</p>
                  {errorDetails.length > 0 && (
                    <ul className="mt-2 text-left list-disc list-inside space-y-0.5">
                      {errorDetails.map((detail, i) => (
                        <li key={i}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? t('Creating Account...', 'Account wird erstellt …') : t('Create Account', 'Account erstellen & Skript übernehmen')}
              </Button>
              </form>
            </>
          )}
          
          <div className="mt-6 text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {t('Already have an account?', 'Schon einen Account?')}{' '}
            </span>
            <Link
              href="/auth/signin"
              className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              {t('Sign in', 'Anmelden')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PasswordRequirements({ password, german }: { password: string; german: boolean }) {
  const rules = [
    { label: german ? '8+ Zeichen' : '8+ characters', met: password.length >= 8 },
    { label: german ? 'Kleinbuchstabe' : 'Lowercase letter', met: /[a-z]/.test(password) },
    { label: german ? 'Grossbuchstabe' : 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: german ? 'Zahl' : 'Number', met: /[0-9]/.test(password) },
  ]

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rules.map((rule) => (
        <li key={rule.label} className="flex items-center gap-1.5">
          {rule.met ? (
            <Check className="w-3 h-3 text-green-500 shrink-0" />
          ) : (
            <X className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          )}
          <span className={rule.met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
            {rule.label}
          </span>
        </li>
      ))}
    </ul>
  )
}