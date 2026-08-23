/** crypto.randomUUID() is missing on older WebKit (iPad Safari) and in non-secure contexts. */
export function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}
