/**
 * IndexedDB storage for teacher's email mappings
 * Stores real email -> pseudonym mappings locally
 */

const DB_NAME = 'eduskript_teacher_data'
const STORE_NAME = 'email_mappings'
const DB_VERSION = 1

interface EmailMapping {
  classId: string
  realEmail: string
  pseudonymEmail: string
  addedAt: number
}

let dbInstance: IDBDatabase | null = null

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true })
        // Create indexes for efficient querying
        store.createIndex('classId', 'classId', { unique: false })
        store.createIndex('realEmail', 'realEmail', { unique: false })
        store.createIndex('pseudonymEmail', 'pseudonymEmail', { unique: false })
        store.createIndex('classEmail', ['classId', 'realEmail'], { unique: true })
      }
    }
  })
}

export async function saveEmailMapping(
  classId: string,
  realEmail: string,
  pseudonymEmail: string
): Promise<void> {
  const db = await getDB()
  const transaction = db.transaction([STORE_NAME], 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const index = store.index('classEmail')

  // Check if mapping already exists
  const existing = await new Promise<EmailMapping | undefined>((resolve, reject) => {
    const request = index.get([classId, realEmail])
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  if (existing) {
    // Update existing mapping
    const cursorRequest = index.openCursor([classId, realEmail])
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          cursor.update({
            classId,
            realEmail,
            pseudonymEmail,
            addedAt: Date.now(),
          })
          resolve()
        }
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
  } else {
    // Add new mapping
    await new Promise<void>((resolve, reject) => {
      const request = store.add({
        classId,
        realEmail,
        pseudonymEmail,
        addedAt: Date.now(),
      })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export async function saveEmailMappings(
  classId: string,
  mappings: Record<string, string>
): Promise<void> {
  for (const [realEmail, pseudonymEmail] of Object.entries(mappings)) {
    await saveEmailMapping(classId, realEmail, pseudonymEmail)
  }
}

export async function getEmailMappingsForClass(
  classId: string
): Promise<Record<string, string>> {
  const db = await getDB()
  const transaction = db.transaction([STORE_NAME], 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  const index = store.index('classId')

  return new Promise((resolve, reject) => {
    const request = index.getAll(classId)
    request.onsuccess = () => {
      const mappings: Record<string, string> = {}
      const results = request.result as EmailMapping[]
      for (const mapping of results) {
        mappings[mapping.realEmail] = mapping.pseudonymEmail
      }
      resolve(mappings)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function getRealEmail(
  classId: string,
  pseudonymEmail: string
): Promise<string | null> {
  const db = await getDB()
  const transaction = db.transaction([STORE_NAME], 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  const index = store.index('pseudonymEmail')

  return new Promise((resolve, reject) => {
    const request = index.getAll(pseudonymEmail)
    request.onsuccess = () => {
      const results = request.result as EmailMapping[]
      // Find the mapping for this specific class
      const mapping = results.find((m) => m.classId === classId)
      resolve(mapping ? mapping.realEmail : null)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function getAllEmailMappings(): Promise<EmailMapping[]> {
  const db = await getDB()
  const transaction = db.transaction([STORE_NAME], 'readonly')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Get unmapped emails for a class (emails that haven't been resolved to pseudonyms yet)
 * Stored in localStorage for simplicity
 */
export function getUnmappedEmailsForClass(classId: string): string[] {
  if (typeof window === 'undefined') return []

  try {
    const key = `eduskript_unmapped_emails_${classId}`
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('[EmailMapping] Error reading unmapped emails:', error)
    return []
  }
}

/**
 * Save unmapped emails for a class
 */
export function saveUnmappedEmailsForClass(classId: string, emails: string[]): void {
  if (typeof window === 'undefined') return

  try {
    const key = `eduskript_unmapped_emails_${classId}`
    localStorage.setItem(key, JSON.stringify(emails))
  } catch (error) {
    console.error('[EmailMapping] Error saving unmapped emails:', error)
  }
}

/**
 * Add emails to unmapped list
 */
export function addUnmappedEmails(classId: string, newEmails: string[]): void {
  const existing = getUnmappedEmailsForClass(classId)
  const normalized = newEmails.map(e => e.toLowerCase().trim()).filter(e => e.length > 0)
  const combined = Array.from(new Set([...existing, ...normalized]))
  saveUnmappedEmailsForClass(classId, combined)
}

/**
 * Remove an unmapped email
 */
export function removeUnmappedEmail(classId: string, email: string): void {
  const existing = getUnmappedEmailsForClass(classId)
  const filtered = existing.filter(e => e !== email.toLowerCase().trim())
  saveUnmappedEmailsForClass(classId, filtered)
}

/**
 * Get reverse mappings: pseudonym → realEmail (for looking up by student pseudonym)
 */
export async function getReverseMappingsForClass(
  classId: string
): Promise<Record<string, string>> {
  const mappings = await getEmailMappingsForClass(classId)
  const reversed: Record<string, string> = {}
  for (const [realEmail, pseudonym] of Object.entries(mappings)) {
    reversed[pseudonym] = realEmail
  }
  return reversed
}

/**
 * When each address last got a class-invite mail (bulk-import sendInvites).
 * Kept next to the unmapped list in this browser only: the server stores the
 * date per pseudonym but can't map it back to an address.
 */
export function getInvitedAtForClass(classId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const stored = localStorage.getItem(`eduskript_invited_at_${classId}`)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function markInvited(classId: string, emails: string[]): void {
  if (typeof window === 'undefined' || emails.length === 0) return
  try {
    const invited = getInvitedAtForClass(classId)
    const now = new Date().toISOString()
    for (const email of emails) invited[email.toLowerCase().trim()] = now
    localStorage.setItem(`eduskript_invited_at_${classId}`, JSON.stringify(invited))
  } catch (error) {
    console.error('[EmailMapping] Error saving invite dates:', error)
  }
}
