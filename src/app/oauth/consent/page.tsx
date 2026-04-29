/**
 * Consent screen for MCP OAuth (RFC 6749 §4.1).
 *
 * GET /api/mcp/oauth/authorize validates client + redirect_uri + PKCE params,
 * then redirects here with all those params hoisted into the URL. This page is
 * a Server Component because the API-route layer is forbidden from importing
 * `react-dom/server`. The form on this page POSTs back to /api/mcp/oauth/authorize.
 *
 * We re-validate the session here (defense in depth) but do NOT re-validate
 * client_id or redirect_uri — the API route already did that and will do it
 * again on POST.
 */

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { McpConsentScreen } from '@/components/dashboard/mcp-consent-screen'

interface ConsentPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function McpConsentPage({ searchParams }: ConsentPageProps) {
  const params = await searchParams

  const clientId = asString(params.client_id)
  const clientName = asString(params.client_name)
  const redirectUri = asString(params.redirect_uri)
  const responseType = asString(params.response_type)
  const scope = asString(params.scope)
  const state = asString(params.state)
  const codeChallenge = asString(params.code_challenge)
  const codeChallengeMethod = asString(params.code_challenge_method)

  if (!clientId || !redirectUri || !codeChallenge) {
    // Missing required params — somebody hit /oauth/consent directly.
    redirect('/dashboard')
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    // Bounce back through the API route so the caller's full URL is preserved.
    const callbackUrl = new URL('/api/mcp/oauth/authorize', 'http://placeholder')
    callbackUrl.searchParams.set('client_id', clientId)
    callbackUrl.searchParams.set('redirect_uri', redirectUri)
    callbackUrl.searchParams.set('response_type', responseType)
    callbackUrl.searchParams.set('scope', scope)
    callbackUrl.searchParams.set('state', state)
    callbackUrl.searchParams.set('code_challenge', codeChallenge)
    callbackUrl.searchParams.set('code_challenge_method', codeChallengeMethod)
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl.pathname + callbackUrl.search)}`
    )
  }

  return (
    <McpConsentScreen
      clientName={clientName || clientId}
      scopes={scope.split(/\s+/).filter(Boolean)}
      userEmail={session.user.email ?? null}
      hiddenParams={{
        response_type: responseType,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      }}
    />
  )
}
