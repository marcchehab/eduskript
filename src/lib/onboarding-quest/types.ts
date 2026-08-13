// Onboarding quest: a short checklist new teachers walk through across the
// dashboard and their public site. Completing every step extends the trial
// (see extendTrialByPlanDays in src/lib/trial.ts). State is stored in
// UserData (adapter: 'onboarding-quest', itemId: 'global') via a dedicated
// route — not the generic useUserData hook, which never proactively syncs
// (see src/app/api/onboarding-quest/complete-step/route.ts).

export const QUEST_STEPS = [
  'place_skript',
  'visit_public_page',
  'return_to_builder',
  'open_page_editor',
  'rename_skript',
  'view_pages',
  'edit_page_content',
  'view_via_eye_icon',
  'return_via_edit_link',
  'use_ai_edit',
] as const

export type QuestStep = (typeof QUEST_STEPS)[number]

export interface QuestState {
  version: 1
  startedAt: number
  completedSteps: Partial<Record<QuestStep, number>>
  dismissed: boolean
  rewardGranted: boolean
  rewardGrantedAt: number | null
}

export const DEFAULT_QUEST_STATE: QuestState = {
  version: 1,
  startedAt: 0,
  completedSteps: {},
  dismissed: false,
  rewardGranted: false,
  rewardGrantedAt: null,
}

export function isQuestComplete(state: QuestState): boolean {
  return QUEST_STEPS.every((step) => step in state.completedSteps)
}
