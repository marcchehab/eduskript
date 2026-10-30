import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { verifyApproveToken } from '@/lib/product-updates/tokens'
import { getRecipients } from '@/lib/product-updates/service'
import { renderProductUpdate, unsubscribePageUrl } from '@/lib/product-updates/render'
import { DraftActions } from '@/components/product-updates/admin-actions'

// Approval page, reached from the signed link in the preview mail. Needs an
// admin session (dashboard layout sends anonymous visitors to sign-in) AND a
// valid token. The actual send is POST /api/admin/product-updates/[id].
export default async function ProductUpdateApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.isAdmin) redirect('/dashboard')

  const { id } = await params
  const { token = '' } = await searchParams
  const draft = await prisma.productUpdate.findUnique({ where: { id } })

  if (!draft || !verifyApproveToken(draft.id, draft.expiresAt, token)) {
    return <p className="text-muted-foreground">Invalid or unknown approval link.</p>
  }

  const expired = draft.expiresAt <= new Date()
  const count = draft.status === 'pending' ? (await getRecipients()).length : draft.recipientCount ?? 0
  const preview = renderProductUpdate(draft, 'de', unsubscribePageUrl('preview'))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{draft.subject}</h1>
        <p className="text-muted-foreground mt-2">
          From {draft.fromAddr} · status <b>{draft.status}</b>
          {draft.status !== 'pending' && draft.recipientCount !== null && (
            <> · {draft.sentCount}/{draft.recipientCount} sent{draft.failedCount ? `, ${draft.failedCount} failed` : ''}</>
          )}
        </p>
      </div>

      <DraftActions
        id={draft.id}
        token={token}
        status={draft.status}
        expired={expired}
        recipientCount={count}
      />

      <Card>
        <CardHeader>
          <CardTitle>Preview (German-language recipient)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sandboxed: no scripts, no same-origin access. */}
          <iframe
            title="Mail preview"
            sandbox=""
            srcDoc={preview.html}
            className="w-full h-[600px] rounded border bg-white"
          />
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Plain-text version</summary>
            <pre className="whitespace-pre-wrap text-sm mt-2">{preview.text}</pre>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
