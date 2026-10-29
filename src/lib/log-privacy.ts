/**
 * Guard for server log lines that could carry a student's data (email, AI
 * output about their work). /datenschutz and the AVV promise that server logs
 * contain no student content, so such lines are only written for test
 * accounts: user ids listed in LOG_TEST_USER_IDS (comma-separated, set in
 * config/deploy.yml or /etc/eduskript/app.env). Unset = never.
 *
 * Teacher data is not covered here; callers decide that themselves.
 */
export function isLogTestUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return (process.env.LOG_TEST_USER_IDS ?? '')
    .split(',')
    .some((id) => id.trim() === userId)
}
