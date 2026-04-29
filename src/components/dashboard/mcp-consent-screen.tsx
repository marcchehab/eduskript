/**
 * MCP OAuth consent screen.
 *
 * Rendered by GET /api/mcp/oauth/authorize after a NextAuth-authenticated user
 * arrives with valid query params. The form POSTs back to the same route with
 * the original parameters as hidden inputs plus a `decision=allow|deny` field.
 *
 * Open-redirect note: the redirect_uri shown here is what the *user* approves.
 * The server still re-validates the URI against the registered client allowlist
 * before issuing the code.
 */

import { Button } from '@/components/ui/button'

interface ConsentScreenProps {
  clientName: string
  scopes: string[]
  userEmail: string | null
  hiddenParams: Record<string, string>
}

const SCOPE_LABELS: Record<string, string> = {
  'content:read': 'read your skripts and pages',
  'content:write': 'create and edit your skripts and pages',
}

export function McpConsentScreen({
  clientName,
  scopes,
  userEmail,
  hiddenParams,
}: ConsentScreenProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Allow access?
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            <strong className="text-gray-900 dark:text-gray-100">{clientName}</strong>
            {' wants to connect to your Eduskript account'}
            {userEmail ? ` (${userEmail})` : ''}.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            It will be able to:
          </p>
          <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-start gap-2">
                <span aria-hidden="true">•</span>
                <span>{SCOPE_LABELS[scope] ?? scope}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-4">
          You can revoke access at any time from <em>Settings → Connected Apps</em>.
        </div>

        <form
          method="POST"
          action="/api/mcp/oauth/authorize"
          className="flex gap-3 justify-end"
        >
          {Object.entries(hiddenParams).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Button type="submit" name="decision" value="deny" variant="outline">
            Deny
          </Button>
          <Button type="submit" name="decision" value="allow">
            Allow
          </Button>
        </form>
      </div>
    </div>
  )
}
