/**
 * MCP OAuth metadata helpers.
 *
 * Computes the canonical `issuer` URL for the authorization server and the
 * resource URL the protected-resource metadata document points back to. Both
 * must agree byte-for-byte with what we put in tokens (RFC 8414 §2 / RFC 9728).
 */

export const SUPPORTED_SCOPES = ['content:read', 'content:write'] as const

export function getIssuer(): string {
  const raw = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  // Strip trailing slash — issuer comparisons are exact.
  return raw.replace(/\/+$/, '')
}

export function getMcpResource(): string {
  // The MCP transport endpoint is the protected resource clients need a token for.
  return `${getIssuer()}/api/mcp/mcp`
}

export function buildAuthorizationServerMetadata() {
  const issuer = getIssuer()
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...SUPPORTED_SCOPES],
  }
}

export function buildProtectedResourceMetadata() {
  const issuer = getIssuer()
  return {
    resource: getMcpResource(),
    authorization_servers: [issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ['header'],
  }
}
