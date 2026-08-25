/**
 * POST /api/onboarding-quest/complete-step
 *
 * Body is { step } (marks one onboarding-quest step done), { dismiss: true }
 * (closes the widget without abandoning progress — steps can still complete
 * silently afterward), or { jumpToStep } (clicking a step's header in the
 * checklist — forces every earlier step complete and every later step,
 * including the clicked one, back to incomplete, so it always lands exactly
 * on the clicked step regardless of current progress). jumpToStep never
 * touches rewardGranted — it can't itself produce a fully-complete state
 * (the clicked step and everything after stays incomplete), so the one-time
 * trial-extension grant is untouched by rewinding/forwarding. Once every
 * step is complete, the reward is granted exactly once. Server-side merge
 * (not a client-sent full blob) so concurrent completions from different
 * origins (dashboard vs. a custom-domain public page) can't clobber each other.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { extendTrialByPlanDays } from '@/lib/trial'
import { QUEST_STEPS, DEFAULT_QUEST_STATE, isQuestComplete, type QuestState, type QuestStep } from '@/lib/onboarding-quest/types'

const ADAPTER = 'onboarding-quest'
const ITEM_ID = 'global'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user.accountType !== 'teacher') {
      return NextResponse.json({ error: 'Not applicable' }, { status: 403 })
    }
    const userId = session.user.id

    const body = await request.json().catch(() => null)
    const step = body?.step as QuestStep | undefined
    const dismiss = body?.dismiss === true
    const jumpToStep = body?.jumpToStep as QuestStep | undefined
    if (!dismiss && !jumpToStep && (!step || !QUEST_STEPS.includes(step))) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }
    if (jumpToStep && !QUEST_STEPS.includes(jumpToStep)) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      // findFirst + create/update, not upsert — upsert has issues with the
      // nullable compound key here (targetType/targetId), same as the sync route.
      const existing = await tx.userData.findFirst({
        where: { userId, adapter: ADAPTER, itemId: ITEM_ID, targetType: null, targetId: null },
      })

      const now = Date.now()
      const current: QuestState = (existing?.data as unknown as QuestState) ?? DEFAULT_QUEST_STATE

      let completedSteps = current.completedSteps
      if (jumpToStep) {
        const jumpIndex = QUEST_STEPS.indexOf(jumpToStep)
        completedSteps = {}
        QUEST_STEPS.forEach((s, i) => {
          if (i < jumpIndex) completedSteps[s] = current.completedSteps[s] ?? now
        })
      } else if (!dismiss) {
        completedSteps = { ...current.completedSteps, [step as QuestStep]: now }
      }

      const state: QuestState = {
        ...current,
        startedAt: current.startedAt || now,
        completedSteps,
        dismissed: dismiss ? true : current.dismissed,
      }

      let justGranted = false
      if (!state.rewardGranted && isQuestComplete(state)) {
        await extendTrialByPlanDays(userId)
        state.rewardGranted = true
        state.rewardGrantedAt = now
        justGranted = true
      }

      if (existing) {
        await tx.userData.update({
          where: { id: existing.id },
          data: { data: state as unknown as object, version: existing.version + 1 },
        })
      } else {
        await tx.userData.create({
          data: {
            userId,
            adapter: ADAPTER,
            itemId: ITEM_ID,
            data: state as unknown as object,
            version: 1,
          },
        })
      }

      return { state, justGranted }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[onboarding-quest/complete-step] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
