import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withDatabaseConnection } from '@/lib/db-connection'

// Theme is a per-device UI preference held in localStorage. PATCH still
// records it on the user row so it appears in /api/user/data-export, but
// nothing reads it back to the client — the GET handler was removed when
// the dashboard's loadThemePreference fetch was deleted (it caused a
// post-paint setTheme flash on every dashboard load).

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { theme } = await request.json()

    if (!['light', 'dark', 'system'].includes(theme)) {
      return NextResponse.json({ error: 'Invalid theme value' }, { status: 400 })
    }

    await withDatabaseConnection(async () => {
      return await prisma.user.update({
        where: { email: session.user.email! },
        data: { themePreference: theme }
      })
    })

    return NextResponse.json({
      message: 'Theme preference updated successfully',
      themePreference: theme
    })

  } catch (error) {
    console.error('Error updating theme preference:', error)
    return NextResponse.json(
      { error: 'Failed to update theme preference' },
      { status: 500 }
    )
  }
}
