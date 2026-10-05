// Shared constants for custom-domain setup. Imported by both server code
// (verification, diagnostics) and client components (DNS instructions), so it
// must stay free of Node-only imports.

// Every custom domain of this deployment is routed through one CNAME target,
// `sites.eduskript.org` — an A/AAAA record we control that points at the
// server, so moving servers never needs a DNS change on the customer's side.
// Overridable via NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET (inlined at build time).
export const CUSTOM_DOMAIN_TARGET =
  process.env.NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET || 'sites.eduskript.org'

// Fallback for root domains at providers without CNAME flattening/ALIAS: the
// server's addresses. Customers using these must update them if the server
// moves (unlike the CNAME), so the UI offers them only as a fallback.
export const CUSTOM_DOMAIN_IPV4 = '179.237.126.129'
export const CUSTOM_DOMAIN_IPV6 = '2001:1600:18:20b::31a'

// Subdomain the ownership TXT record lives on.
export const VERIFICATION_HOST_PREFIX = '_eduskript-verify'
