/**
 * MCP OAuth client registry — RFC 7591 Dynamic Client Registration.
 *
 * Clients (claude.ai, Claude Code, Cursor, etc.) register themselves at
 * /api/mcp/oauth/register and receive a client_id. Public PKCE-only clients
 * have no client_secret — that's the v1 model. The redirect_uris field is the
 * allowlist the /authorize endpoint enforces (open-redirect mitigation).
 */

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

const DEFAULT_GRANT_TYPES = ['authorization_code', 'refresh_token']
const DEFAULT_SCOPES = ['content:read', 'content:write']

export interface RegisterClientInput {
  name: string
  redirectUris: string[]
  /**
   * Optional. If true, we issue a client_secret and store its hash. v1 default
   * is public PKCE-only (false).
   */
  confidential?: boolean
  registeredByUserId?: string
}

export interface RegisteredClient {
  clientId: string
  clientSecret: string | null
  name: string
  redirectUris: string[]
  scopes: string[]
  grantTypes: string[]
  createdAt: Date
}

function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri)
    if (url.hash) return false // RFC 6749 §3.1.2: no fragment
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return true
  } catch {
    return false
  }
}

export async function registerClient(
  input: RegisterClientInput
): Promise<RegisteredClient> {
  if (!input.name?.trim()) {
    throw new Error('client_name is required')
  }
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    throw new Error('redirect_uris must be a non-empty array')
  }
  for (const uri of input.redirectUris) {
    if (!isValidRedirectUri(uri)) {
      throw new Error(`Invalid redirect_uri: ${uri}`)
    }
  }

  const clientId = `mcp_${randomBytes(16).toString('hex')}`
  let clientSecret: string | null = null
  let clientSecretHash: string | null = null

  if (input.confidential) {
    clientSecret = randomBytes(32).toString('hex')
    clientSecretHash = createHash('sha256').update(clientSecret).digest('hex')
  }

  const row = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash,
      name: input.name.trim(),
      redirectUris: input.redirectUris,
      grantTypes: DEFAULT_GRANT_TYPES,
      scopes: DEFAULT_SCOPES,
      registeredByUserId: input.registeredByUserId ?? null,
    },
  })

  return {
    clientId: row.clientId,
    clientSecret,
    name: row.name,
    redirectUris: row.redirectUris,
    scopes: row.scopes,
    grantTypes: row.grantTypes,
    createdAt: row.createdAt,
  }
}

export async function lookupClient(clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { clientId } })
}

export function isRedirectUriAllowed(
  client: { redirectUris: string[] },
  candidate: string
): boolean {
  // Strict equality match — no path/query suffix tricks. RFC 6749 §3.1.2.2.
  return client.redirectUris.includes(candidate)
}

export function verifyClientSecret(
  client: { clientSecretHash: string | null },
  presentedSecret: string | null
): boolean {
  if (!client.clientSecretHash) return true // public client
  if (!presentedSecret) return false
  const presentedHash = createHash('sha256').update(presentedSecret).digest('hex')
  return presentedHash === client.clientSecretHash
}

export const __test = { isValidRedirectUri }
