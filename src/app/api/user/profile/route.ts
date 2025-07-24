import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withDatabaseConnection } from '@/lib/db-connection'
import { z } from 'zod'

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  subdomain: z.string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(50, 'Subdomain must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens')
    .refine(val => !val.startsWith('-') && !val.endsWith('-'), 'Subdomain cannot start or end with a hyphen'),
  webpageDescription: z.string().optional(), // New field for webpage description
  title: z.string().optional(),
  bio: z.string().optional()
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = updateProfileSchema.parse(body)

    const result = await withDatabaseConnection(async () => {
      // Check if subdomain is already taken by another user
      if (validatedData.subdomain) {
        const existingUser = await prisma.user.findUnique({
          where: { subdomain: validatedData.subdomain }
        })

        if (existingUser && existingUser.id !== session.user.id) {
          throw new Error('This subdomain is already taken')
        }
      }

      // Update the user profile
      return await prisma.user.update({
        where: { id: session.user.id },
        data: {
          name: validatedData.name,
          subdomain: validatedData.subdomain,
          webpageDescription: validatedData.webpageDescription || null,
          title: validatedData.title || null,
          bio: validatedData.bio || null
        },
        select: {
          id: true,
          name: true,
          email: true,
          subdomain: true,
          webpageDescription: true,
          title: true,
          bio: true
        }
      })
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating profile:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid data', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof Error && error.message === 'This subdomain is already taken') {
      return NextResponse.json(
        { error: 'This subdomain is already taken' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
