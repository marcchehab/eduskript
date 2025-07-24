'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateChapterModal } from './create-chapter-modal'
import { ScriptSettingsModal } from './topic-settings-modal'
import { SortableChapters } from './sortable-chapters'
import { ArrowLeft, BookOpen, FileText } from 'lucide-react'

interface ScriptEditorProps {
  script: {
    id: string
    title: string
    description: string | null
    slug: string
    isPublished: boolean
    chapters: Array<{
      id: string
      title: string
      slug: string
      description: string | null
      order: number
      isPublished: boolean
      updatedAt: Date
      pages: Array<{
        id: string
        title: string
        slug: string
        order: number
        isPublished: boolean
        updatedAt: Date
      }>
    }>
  }
}

export function ScriptEditor({ script }: ScriptEditorProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPublished, setIsPublished] = useState(script.isPublished)
  const router = useRouter()

  const handleChapterCreated = () => {
    // Force a complete page refresh to ensure data is updated
    window.location.reload()
  }

  const handleScriptUpdated = (updatedScript?: {
    id: string
    title: string
    description: string | null
    slug: string
  }) => {
    if (updatedScript && updatedScript.slug !== script.slug) {
      // If slug changed, redirect to new URL
      router.push(`/dashboard/topics/${updatedScript.slug}`)
    } else {
      // Force a complete page refresh to ensure data is updated
      window.location.reload()
    }
  }

  const handlePublish = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/topics/${script.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isPublished: !isPublished
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update script')
      }

      const updatedScript = await response.json()
      setIsPublished(updatedScript.isPublished)
      
      // Optionally show success message or refresh
      window.location.reload()
    } catch (error) {
      console.error('Error publishing script:', error)
      // You might want to show an error toast here
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/topics">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Scripts
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground">
            {script.title}
          </h1>
          <p className="text-muted-foreground mt-2">
            {script.description || 'No description'}
          </p>
        </div>
        <div className="flex gap-2">
          <ScriptSettingsModal 
            script={script}
            onScriptUpdated={handleScriptUpdated}
          />
          <Button 
            onClick={handlePublish}
            disabled={isLoading}
          >
            {isLoading ? 'Publishing...' : (isPublished ? 'Unpublish' : 'Publish')}
          </Button>
        </div>
      </div>

      {/* Script Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chapters</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{script.chapters.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pages</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {script.chapters.reduce((acc: number, ch) => acc + ch.pages.length, 0)}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isPublished ? 'text-success' : 'text-warning'}`}>
              {isPublished ? 'Published' : 'Draft'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chapters */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Chapters</CardTitle>
              <CardDescription>Organize your content into chapters</CardDescription>
            </div>
            <CreateChapterModal 
              topicId={script.id} 
              onChapterCreated={handleChapterCreated}
            />
          </div>
        </CardHeader>
        <CardContent>
          {script.chapters.length > 0 ? (
            <SortableChapters
              chapters={script.chapters}
              topicId={script.id}
              scriptSlug={script.slug}
              onReorder={handleChapterCreated}
            />
          ) : (
            <div className="text-center py-8">
              <BookOpen className="h-12 w-12 text-icon-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No chapters yet
              </h3>
              <p className="text-muted-foreground mb-4">
                Start organizing your content by creating your first chapter.
              </p>
              <CreateChapterModal 
                topicId={script.id} 
                onChapterCreated={handleChapterCreated}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
