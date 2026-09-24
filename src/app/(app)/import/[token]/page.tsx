import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getImportByToken } from '@/lib/script-import/service'
import { ImportPreview } from './import-preview'

// Private preview: the unguessable token is the only access check.
export const metadata: Metadata = {
  title: 'Vorschau | Eduskript',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}
export const dynamic = 'force-dynamic'

export default async function ImportPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const row = await getImportByToken(token)
  if (!row) notFound()
  const session = await getServerSession(authOptions)

  return (
    <ImportPreview
      token={row.token}
      status={row.status as 'processing' | 'ready' | 'failed'}
      error={row.error}
      title={row.title ?? row.fileName}
      pages={row.pages}
      startedAt={row.createdAt.toISOString()}
      expiresAt={row.expiresAt.toISOString()}
      claimed={Boolean(row.claimedAt)}
      fileList={row.assets.map((a) => ({
        id: a.id,
        name: a.name,
        url: `/api/script-import/${row.token}/media/${encodeURIComponent(a.name)}`,
      }))}
      signedIn={Boolean(session?.user?.id)}
      warnings={row.warnings}
    />
  )
}
