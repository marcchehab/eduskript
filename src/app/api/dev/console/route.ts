import { NextRequest, NextResponse } from 'next/server'

// Only available in development
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { level, args, timestamp, clientId } = body

    // Get client IP for identification
    const forwarded = request.headers.get('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'local'

    // Extract last octet of IP for brevity (e.g., "192.168.1.112" -> "112")
    const ipShort = ip === 'local' ? 'local' : ip.split('.').pop() || ip

    // Format the output with client identifier
    const time = new Date(timestamp).toLocaleTimeString()
    const clientTag = clientId ? `${ipShort}:${clientId}` : ipShort
    const prefix = `[Browser ${level.toUpperCase()}] ${time} [${clientTag}]`

    // Print to server console with appropriate method
    switch (level) {
      case 'error':
        console.error(prefix, ...args)
        break
      case 'warn':
        console.warn(prefix, ...args)
        break
      case 'info':
        console.info(prefix, ...args)
        break
      default:
        console.log(prefix, ...args)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Dev Console API] Error:', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
