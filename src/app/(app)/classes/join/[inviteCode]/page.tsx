import { redirect } from 'next/navigation'

// Old invite links (mails, bookmarks). The join page moved to /join/<code>.
export default async function OldJoinPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const { inviteCode } = await params
  redirect(`/join/${encodeURIComponent(inviteCode)}`)
}
