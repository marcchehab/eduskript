import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getS3Client } from '@/lib/utils'
import { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { filename } = await params
    const { newFilename, chapterId, updateLinks } = await request.json()

    if (!newFilename?.trim()) {
      return NextResponse.json({ error: 'New filename is required' }, { status: 400 })
    }

    const s3 = getS3Client()
    const bucket = process.env.CELLAR_ADDON_BUCKET!
    const userSubdomain = (session.user as { subdomain?: string })?.subdomain

    if (!userSubdomain) {
      return NextResponse.json({ error: 'User subdomain not found' }, { status: 400 })
    }

    // Determine the old and new S3 keys
    const oldKey = chapterId 
      ? `${userSubdomain}/chapters/${chapterId}/${filename}`
      : `${userSubdomain}/global/${filename}`
    
    const newKey = chapterId 
      ? `${userSubdomain}/chapters/${chapterId}/${newFilename.trim()}`
      : `${userSubdomain}/global/${newFilename.trim()}`

    // Check if file exists at old location
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: oldKey }))
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Check if target name already exists
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: newKey }))
      return NextResponse.json({ error: 'A file with the new name already exists' }, { status: 409 })
    } catch {
      // File doesn't exist at new location, which is what we want
    }

    // Copy file to new location
    await s3.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${oldKey}`,
      Key: newKey,
      ACL: 'public-read',
      MetadataDirective: 'COPY',
    }))

    // Delete old file
    await s3.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: oldKey,
    }))

    // Update links in chapter pages if requested
    if (updateLinks && chapterId) {
      try {
        console.log(`Starting link updates for chapter ${chapterId}, renaming ${filename} to ${newFilename.trim()}`)
        
        // Get all pages in this chapter
        const pages = await prisma.page.findMany({
          where: { chapterId },
          select: { id: true, content: true }
        })

        console.log(`Found ${pages.length} pages in chapter ${chapterId}`)

        // Update each page's content
        const updatePromises = pages.map(async (page) => {
          // Escape special regex characters in filenames
          const escapedOldFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          
          console.log(`Updating page ${page.id}, looking for filename: ${filename}`)
          console.log(`Escaped filename for regex: ${escapedOldFilename}`)
          
          // Replace markdown image references: ![alt](filename)
          const imageRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedOldFilename}\\)`, 'g')
          // Replace markdown link references: [text](filename)  
          const linkRegex = new RegExp(`\\[([^\\]]*)\\]\\(${escapedOldFilename}\\)`, 'g')
          
          const updatedContent = page.content
            .replace(imageRegex, `![$1](${newFilename.trim()})`)
            .replace(linkRegex, `[$1](${newFilename.trim()})`)

          if (updatedContent !== page.content) {
            console.log(`Page ${page.id} content changed, updating...`)
            console.log(`Old content snippet: ${page.content.substring(0, 200)}...`)
            console.log(`New content snippet: ${updatedContent.substring(0, 200)}...`)
            
            await prisma.page.update({
              where: { id: page.id },
              data: { content: updatedContent }
            })
          } else {
            console.log(`No changes needed for page ${page.id}`)
          }
        })

        await Promise.all(updatePromises)
      } catch (error) {
        console.error('Error updating links:', error)
        // Don't fail the rename if link updating fails
      }
    }

    return NextResponse.json({ 
      success: true, 
      oldFilename: filename, 
      newFilename: newFilename.trim() 
    })

  } catch (error) {
    console.error('Error renaming file:', error)
    return NextResponse.json({ error: 'Failed to rename file' }, { status: 500 })
  }
} 