/**
 * Payrexx API Client
 *
 * Handles communication with the Payrexx payment gateway for subscription management.
 * Uses the X-API-KEY header for authentication (recommended by Payrexx docs).
 * All amounts are in Rappen (CHF cents).
 *
 * API docs: https://developers.payrexx.com/reference/rest-api
 */

import crypto from 'crypto'

const BASE_URL = 'https://api.payrexx.com/v1.0'

function getInstance(): string {
  const instance = process.env.PAYREXX_INSTANCE
  if (!instance) throw new Error('PAYREXX_INSTANCE env var is required')
  // Accept both "luzmedia" and "luzmedia.payrexx.com" formats
  return instance.replace(/\.payrexx\.com$/, '')
}

function getApiSecret(): string {
  const secret = process.env.PAYREXX_API_SECRET
  if (!secret) throw new Error('PAYREXX_API_SECRET env var is required')
  return secret
}

/**
 * Build a URL-encoded query string from params.
 */
function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
}

async function payrexxRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const instance = getInstance()
  const query = buildQuery(params)

  const url = method === 'GET' || method === 'DELETE'
    ? `${BASE_URL}/${endpoint}/?${query ? query + '&' : ''}instance=${instance}`
    : `${BASE_URL}/${endpoint}/?instance=${instance}`

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-API-KEY': getApiSecret(),
    },
  }

  if (method === 'POST' || method === 'PUT') {
    options.body = query
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Payrexx API error ${response.status}: ${text}`)
  }

  const json = await response.json()
  if (json.status === 'error') {
    throw new Error(`Payrexx error: ${json.message || JSON.stringify(json)}`)
  }

  // Payrexx wraps responses in an array
  return (Array.isArray(json.data) ? json.data[0] : json.data) as T
}

// --- Gateway (Checkout) ---

export interface CreateGatewayParams {
  amount: number // in Rappen (cents)
  currency?: string
  successRedirectUrl: string
  failedRedirectUrl: string
  cancelRedirectUrl: string
  referenceId: string // our internal subscription or user ID
  purpose?: string
  subscriptionInterval?: string // "P1M" (monthly) or "P1Y" (yearly) — ISO 8601 duration
  subscriptionPeriod?: string // "P1Y" (1 year) or "P100Y" (indefinite) — renewal period
  subscriptionCancellationInterval?: string // "P0D" = cancel anytime
  contactEmail?: string
  contactForename?: string
  contactSurname?: string
}

export interface PayrexxGateway {
  id: number
  hash: string
  link: string
  status: string
  invoices?: PayrexxInvoice[]
}

export interface PayrexxInvoice {
  id: number
  status: string
  referenceId: string
  subscriptionId?: number
}

/**
 * Create a Payrexx Gateway (checkout page) for a subscription.
 */
export async function createGateway(params: CreateGatewayParams): Promise<PayrexxGateway> {
  const apiParams: Record<string, string | number | boolean | undefined> = {
    amount: params.amount,
    currency: params.currency ?? 'CHF',
    successRedirectUrl: params.successRedirectUrl,
    failedRedirectUrl: params.failedRedirectUrl,
    cancelRedirectUrl: params.cancelRedirectUrl,
    referenceId: params.referenceId,
    purpose: params.purpose,
    'fields[email][value]': params.contactEmail,
    'fields[forename][value]': params.contactForename,
    'fields[surname][value]': params.contactSurname,
  }

  // Add subscription params if this is a recurring payment
  if (params.subscriptionInterval) {
    apiParams.subscriptionState = true
    apiParams.subscriptionInterval = params.subscriptionInterval
    apiParams.subscriptionPeriod = params.subscriptionPeriod ?? 'P100Y'
    apiParams.subscriptionCancellationInterval = params.subscriptionCancellationInterval ?? 'P0D'
  }

  return payrexxRequest<PayrexxGateway>('POST', 'Gateway', apiParams)
}

/**
 * Retrieve a gateway by ID to check its status.
 */
export async function getGateway(gatewayId: number): Promise<PayrexxGateway> {
  return payrexxRequest<PayrexxGateway>('GET', `Gateway/${gatewayId}`)
}

/**
 * Delete (cancel) a gateway.
 */
export async function deleteGateway(gatewayId: number): Promise<void> {
  await payrexxRequest('DELETE', `Gateway/${gatewayId}`)
}

// --- Subscriptions ---

export interface PayrexxSubscription {
  id: number
  status: string // "active", "cancelled", etc.
  start: string
  end?: string
  psp: string
  amount: number
  currency: string
}

/**
 * Get a subscription from Payrexx.
 */
export async function getSubscription(subscriptionId: string): Promise<PayrexxSubscription> {
  return payrexxRequest<PayrexxSubscription>('GET', `Subscription/${subscriptionId}`)
}

/**
 * Cancel a subscription in Payrexx.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await payrexxRequest('DELETE', `Subscription/${subscriptionId}`)
}

// --- Webhook Signature Verification ---

/**
 * Verify that a webhook request came from Payrexx.
 * Payrexx sends a POST with form-encoded body; the signature is an HMAC of the
 * transaction data.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const webhookSecret = process.env.PAYREXX_WEBHOOK_SECRET
  if (!webhookSecret) throw new Error('PAYREXX_WEBHOOK_SECRET env var is required')
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('base64')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

// --- Helpers ---

/**
 * Convert a plan interval to Payrexx ISO 8601 duration.
 */
export function intervalToDuration(interval: string): string {
  switch (interval) {
    case 'monthly': return 'P1M'
    case 'yearly': return 'P1Y'
    default: throw new Error(`Unknown interval: ${interval}`)
  }
}
