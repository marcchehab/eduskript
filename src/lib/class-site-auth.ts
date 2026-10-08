/**
 * Authorization for teacher reads of class/student data under site scoping
 * (src/lib/site-access.ts, SITE-SCOPING.md).
 *
 * Every request names the site whose data is read (`siteId`); the caller
 * must manage it, and every user_data / checkpoint row is filtered by it.
 *   - Regular class: caller is the class teacher AND owns the (personal) site.
 *     Classes don't exist on org sites, so org admins never pass here.
 *   - Implicit survey class (Class.isImplicit): caller manages the site
 *     (personal owner or org owner/admin). Page authorship grants nothing.
 * No superadmin bypass anywhere.
 */

import { NextResponse } from 'next/server'
import { getSiteAccess } from '@/lib/site-access'

export interface ClassAuthRecord {
  teacherId: string | null
  isImplicit: boolean
}

/** null when allowed; otherwise the error response to return. */
export async function checkClassSiteRead(
  userId: string,
  classRecord: ClassAuthRecord,
  siteId: string | null | undefined,
): Promise<NextResponse | null> {
  if (!siteId) {
    return NextResponse.json({ error: 'Missing required parameter: siteId' }, { status: 400 })
  }
  const access = await getSiteAccess(userId, siteId)
  const allowed = classRecord.isImplicit
    ? !!access?.canManage
    : classRecord.teacherId === userId && !!access?.isOwner
  if (!allowed) {
    return NextResponse.json(
      { error: 'You do not have permission to view this class on this site' },
      { status: 403 },
    )
  }
  return null
}
