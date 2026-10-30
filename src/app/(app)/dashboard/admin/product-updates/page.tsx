import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getConsentCandidates, getRecipients } from '@/lib/product-updates/service'
import { ConsentRequestButton } from '@/components/product-updates/admin-actions'

// Product updates (src/lib/product-updates/): drafts arrive by mail
// (CloudMailin → /api/webhooks/mail); approving happens via the link in the
// preview mail, not from this list. This page shows history + the one-time
// consent mail.
export default async function ProductUpdatesAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.isAdmin) redirect('/dashboard')

  const [drafts, recipients, candidates] = await Promise.all([
    prisma.productUpdate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, subject: true, fromAddr: true, status: true, createdAt: true,
        recipientCount: true, sentCount: true, failedCount: true,
      },
    }),
    getRecipients(),
    getConsentCandidates(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Product Updates</h1>
        <p className="text-muted-foreground mt-2">
          {recipients.length} teacher{recipients.length === 1 ? '' : 's'} opted in. Send an update by
          mailing it from an allowed sender to the product-update CloudMailin address; the approval
          link arrives by mail.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>One-time consent request</CardTitle>
          <CardDescription>
            Asks every teacher who has not opted in ({candidates.length}) whether they want product
            updates, with a one-click sign-up link. Sending it twice mails them twice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConsentRequestButton count={candidates.length} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drafts and sent updates</CardTitle>
        </CardHeader>
        <CardContent>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y">
              {drafts.map((d) => (
                <li key={d.id} className="py-2 flex items-center justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.subject}</div>
                    <div className="text-muted-foreground">
                      {d.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {d.fromAddr}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.recipientCount !== null && (
                      <span className="text-muted-foreground">
                        {d.sentCount}/{d.recipientCount} sent{d.failedCount ? `, ${d.failedCount} failed` : ''}
                      </span>
                    )}
                    <Badge variant={d.status === 'sent' ? 'default' : 'secondary'}>{d.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
