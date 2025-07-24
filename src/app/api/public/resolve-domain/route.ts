import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// This endpoint is public - no authentication required for domain resolution
export async function GET(request: NextRequest) {
  try {
    const hostname = request.nextUrl.searchParams.get('domain')
    
    if (!hostname) {
      return NextResponse.json({ error: 'Domain parameter required' }, { status: 400 })
    }

    // Look up the custom domain (try both with and without www)
    let customDomain = await prisma.customDomain.findUnique({
      where: { 
        domain: hostname,
        isActive: true 
      },
      include: {
        user: {
          select: { subdomain: true }
        }
      }
    })

    // If not found and hostname starts with www, try without www
    if (!customDomain && hostname.startsWith('www.')) {
      const domainWithoutWww = hostname.substring(4)
      customDomain = await prisma.customDomain.findUnique({
        where: { 
          domain: domainWithoutWww,
          isActive: true 
        },
        include: {
          user: {
            select: { subdomain: true }
          }
        }
      })
    }

    if (customDomain && customDomain.user.subdomain) {
      return NextResponse.json({
        isCustomDomain: true,
        subdomain: customDomain.user.subdomain,
        redirectPath: `/${customDomain.user.subdomain}`
      })
    }

    return NextResponse.json({
      isCustomDomain: false
    })

  } catch (error) {
    console.error('Error resolving custom domain:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
