/**
 * Server-side prefetch for the page-broadcast ("public") layers — annotations,
 * snaps, and sticky notes published by the page author for every visitor.
 *
 * Centralises what nine page routes used to copy-paste, so adding a new
 * public layer (or changing the select shape) is a one-file change. Lives in
 * the ISR cache: `revalidatePath` triggers fire when any public-targeted
 * record is written via /api/user-data/sync (see sync/route.ts).
 *
 * Free-teacher routes still skip the call and return EMPTY_PUBLIC_LAYERS —
 * the sync endpoint refuses writes for them, so these tables stay empty by
 * definition and the round-trip is wasted.
 */

import { prisma } from '@/lib/prisma'
import type { PublicAnnotation, PublicSnap } from '@/components/public/annotation-wrapper'
import type { StickyNote, StickyNotesData } from '@/components/annotations/sticky-notes-layer'

export interface PublicLayers {
  publicAnnotations: PublicAnnotation[]
  publicSnaps: PublicSnap[]
  /** Flattened notes array — already extracted from the wrapping {notes} record. */
  publicStickyNotes: StickyNote[]
}

export const EMPTY_PUBLIC_LAYERS: PublicLayers = {
  publicAnnotations: [],
  publicSnaps: [],
  publicStickyNotes: [],
}

export async function getPublicLayers(pageId: string): Promise<PublicLayers> {
  const [publicAnnotations, publicSnaps, stickyRecord] = await Promise.all([
    prisma.userData.findMany({
      where: { adapter: 'annotations', itemId: pageId, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.userData.findMany({
      where: { adapter: 'snaps', itemId: pageId, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.userData.findFirst({
      where: { adapter: 'sticky-notes', itemId: pageId, targetType: 'page' },
      select: { data: true },
    }),
  ])

  const stickyData = stickyRecord?.data as StickyNotesData | null | undefined
  const publicStickyNotes = stickyData?.notes ?? []

  return { publicAnnotations, publicSnaps, publicStickyNotes }
}
