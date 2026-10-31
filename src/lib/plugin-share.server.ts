import { eventBus } from '@/lib/events'
import { prisma } from '@/lib/prisma'

/** A nickname shows in every list of the student's classes, so all of them refetch. */
export async function notifyNicknameChange(studentId: string) {
  const memberships = await prisma.classMembership.findMany({
    where: { studentId },
    select: { classId: true },
  })
  await Promise.all(memberships.map((m) => eventBus.publish(`class:${m.classId}`, { type: 'leaderboard-update' })))
}
