import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createTemplate, listTemplates } from '@/lib/plugin-templates/server'

/** GET — the central template list (no SVG bodies). */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ templates: await listTemplates() })
}

/** POST { title, description?, url? | svg? } — add a template to the shared list (teachers). */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.accountType === 'student') return NextResponse.json({ error: 'Only teachers can add templates' }, { status: 403 })
  const { title, description, url, svg } = await request.json()
  try {
    const template = await createTemplate(session.user.id, {
      title: String(title ?? ''),
      description: typeof description === 'string' ? description : undefined,
      url: typeof url === 'string' && url.trim() ? url.trim() : undefined,
      svg: typeof svg === 'string' ? svg : undefined,
    })
    return NextResponse.json({ template })
  } catch (error) {
    // createTemplate throws user-facing messages (bad link, not an SVG, too big, no ids).
    const message = error instanceof Error ? error.message : 'Could not add the template'
    console.warn('Plugin template rejected:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
