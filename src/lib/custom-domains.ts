// Shared constants for custom-domain setup. Imported by both server code
// (verification, diagnostics) and client components (DNS instructions), so it
// must stay free of Node-only imports.

// Every custom domain of this deployment is routed through one CNAME target.
// The Kamal build (config/deploy.yml) sets it to `sites.eduskript.org`, a
// record we control, so moving servers never needs a DNS change on the
// customer's side. Without the env var (the Koyeb build) it stays the Koyeb
// target `<koyeb-org-id>.cname.koyeb.app`. Public DNS data, not a secret.
export const CUSTOM_DOMAIN_TARGET =
  process.env.NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET ||
  '8a66568e-8d54-485a-9c56-328d2a5adca4.cname.koyeb.app'

// Subdomain the ownership TXT record lives on.
export const VERIFICATION_HOST_PREFIX = '_eduskript-verify'
