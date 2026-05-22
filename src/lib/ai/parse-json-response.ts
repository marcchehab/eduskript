/**
 * Robust JSON parser for AI responses that may have malformed output.
 *
 * AI models sometimes output text before/after JSON objects, markdown code fences,
 * or other formatting that breaks standard JSON.parse(). This utility:
 * 1. Strips markdown code fences (```json ... ```)
 * 2. Finds JSON objects using balanced brace matching
 * 3. Captures any "overflow" text before/after the JSON
 * 4. Returns parsed result with overflow info for debugging
 */

export interface ParsedJsonResult<T> {
  success: true
  data: T
  overflowBefore: string | null
  overflowAfter: string | null
  fullResponse: string
}

export interface ParsedJsonError {
  success: false
  error: string
  fullResponse: string
}

export type ParseJsonResponse<T> = ParsedJsonResult<T> | ParsedJsonError

/**
 * Find balanced JSON objects in a string, starting from a given offset.
 * Returns the start index, end index (exclusive), and the extracted JSON string.
 */
function findBalancedJson(text: string, fromIndex = 0): { start: number; end: number; json: string } | null {
  let braceCount = 0
  let startIndex = -1
  let inString = false
  let escapeNext = false

  for (let i = fromIndex; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\' && inString) {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      if (braceCount === 0) {
        startIndex = i
      }
      braceCount++
    } else if (char === '}') {
      braceCount--
      if (braceCount === 0 && startIndex !== -1) {
        return {
          start: startIndex,
          end: i + 1,
          json: text.slice(startIndex, i + 1)
        }
      }
    }
  }

  return null
}

/**
 * Parse a JSON response from an AI model, handling common formatting issues.
 *
 * @param response - The raw text response from the AI
 * @param validator - Optional function to validate the parsed data structure
 * @returns ParseJsonResponse with either the parsed data or an error
 */
export function parseJsonResponse<T>(
  response: string,
  validator?: (data: unknown) => data is T
): ParseJsonResponse<T> {
  const fullResponse = response

  // Step 1: Strip a surrounding markdown code fence if present.
  // Trim FIRST: models routinely emit a trailing newline after the closing
  // ```, which left `/\s*```$/` (no `m` flag → `$` is end-of-input) unable to
  // match the fence. The fast path then fell through to Step 3, which reports
  // overflow from the *raw* response — surfacing the literal ```json / ```
  // markers to the user. The leading `[a-z0-9]*` swallows the language tag
  // (```json, ```JSON, bare ```) in one pass.
  let cleanedResponse = response
    .trim()
    .replace(/^```[a-z0-9]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Step 2: Try direct parse first (fast path for well-formed responses)
  if (cleanedResponse.startsWith('{')) {
    try {
      const data = JSON.parse(cleanedResponse)
      if (!validator || validator(data)) {
        return {
          success: true,
          data: data as T,
          overflowBefore: null,
          overflowAfter: null,
          fullResponse
        }
      }
    } catch {
      // Fall through to balanced brace extraction
    }
  }

  // Step 3: Find balanced JSON objects and try each until one validates
  let searchFrom = 0
  let lastError = 'No valid JSON object found in response'

  while (searchFrom < response.length) {
    const found = findBalancedJson(response, searchFrom)

    if (!found) {
      // No more JSON objects found
      break
    }

    // Try to parse this candidate
    try {
      const data = JSON.parse(found.json)

      // If we have a validator, check if this JSON matches expected structure
      if (validator && !validator(data)) {
        // This JSON doesn't match - continue searching after this object
        searchFrom = found.end
        lastError = 'Parsed JSON does not match expected structure'
        continue
      }

      // Success! Extract overflow text. Code-fence markers are benign
      // formatting, never genuine overflow, so strip any ``` / ```lang that
      // sits next to the JSON before deciding whether to warn the user.
      const stripFences = (s: string) => s.replace(/```[a-z0-9]*/gi, '').trim() || null
      const overflowBefore = stripFences(response.slice(0, found.start))
      const overflowAfter = stripFences(response.slice(found.end))

      return {
        success: true,
        data: data as T,
        overflowBefore,
        overflowAfter,
        fullResponse
      }
    } catch {
      // JSON parse failed - continue searching after this position
      searchFrom = found.end
      lastError = 'Failed to parse JSON'
    }
  }

  // No valid JSON found
  return {
    success: false,
    error: lastError,
    fullResponse
  }
}

/**
 * Type guard to check if a plan response has the expected structure.
 */
export function isValidEditPlan(data: unknown): data is {
  edits: Array<{
    pageId: string | null
    pageTitle: string
    pageSlug: string
    summary: string
    isNew?: boolean
  }>
  overallSummary: string
} {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>

  if (!Array.isArray(obj.edits)) return false
  if (typeof obj.overallSummary !== 'string') return false

  return obj.edits.every((edit: unknown) => {
    if (typeof edit !== 'object' || edit === null) return false
    const e = edit as Record<string, unknown>
    return (
      (e.pageId === null || typeof e.pageId === 'string') &&
      typeof e.pageTitle === 'string' &&
      typeof e.pageSlug === 'string' &&
      typeof e.summary === 'string'
    )
  })
}
