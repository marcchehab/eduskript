import { z } from 'zod'

/** A student's nickname (stored in User.name), set by them or by their teacher. */
export const nicknameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(3, 'Nickname must be at least 3 characters')
      .max(32, 'Nickname must be 32 characters or fewer')
      .regex(/^[^\x00-\x1f\x7f]+$/, 'Nickname cannot contain control characters'),
  )
