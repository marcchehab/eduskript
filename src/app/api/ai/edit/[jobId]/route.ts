import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/edit/[jobId] — Get job status + accumulated results.
 * Used for recovery after disconnect.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { jobId } = await params

  const job = await prisma.importJob.findUnique({ where: { id: jobId } })

  if (!job || job.userId !== session.user.id || job.type !== 'ai-edit') {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const result = job.result as Record<string, unknown> | null

  return Response.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    plan: result?.plan ?? null,
    completedEdits: result?.completedEdits ?? [],
    failedPages: result?.failedPages ?? [],
    instruction: result?.instruction ?? null,
    skriptId: result?.skriptId ?? null,
  })
}

/**
 * DELETE /api/ai/edit/[jobId] — Cancel/dismiss job.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { jobId } = await params

  const job = await prisma.importJob.findUnique({ where: { id: jobId } })

  if (!job || job.userId !== session.user.id || job.type !== 'ai-edit') {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'cancelled' },
  })

  return Response.json({ success: true })
}
