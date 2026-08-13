import { notFound, redirect } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getPublicLayers } from '@/lib/public-page-data'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import type { Metadata } from 'next'
import { getFullSiteStructure, getOrgTeacherContentPage } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    skriptSlug: string
    contentPageSlug: string
  }>
}

// ISR: published content only, no session/cookie/header reads. Exam pages —
// the one part that genuinely needs the request — redirect to /exam/... below.
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, skriptSlug, contentPageSlug } = await params

  try {
    // Same cached entry the component below uses, so metadata is free.
    const data = await getOrgTeacherContentPage(orgSlug, pageSlug, skriptSlug, contentPageSlug)

    if (!data) {
      return { title: 'Page Not Found', robots: 'noindex' }
    }

    const { organization, teacher, page } = data
    const teacherName = teacher.sites[0]?.pageName || teacher.name || 'Teacher'
    const title = `${page.title} | ${teacherName} | ${organization.name}`

    return {
      title,
      description: `${page.title} by ${teacherName}`,
      openGraph: {
        title,
        type: 'article',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${skriptSlug}/${contentPageSlug}`
      },
      twitter: { card: 'summary_large_image', title }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgTeacherContentPage({ params }: PageProps) {
  const { orgSlug, pageSlug, skriptSlug, contentPageSlug } = await params

  // One cached lookup for org + teacher + page (shared with generateMetadata).
  const data = await getOrgTeacherContentPage(orgSlug, pageSlug, skriptSlug, contentPageSlug)

  if (!data) {
    notFound()
  }

  const { orgSite, teacher, page } = data
  const organization = {
    ...data.organization,
    description: orgSite.pageDescription,
    iconUrl: orgSite.pageIcon,
    showIcon: orgSite.showIcon,
  }

  const skript = page.skript
  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection
  const allPages = skript.pages

  // Exam pages go through /exam/<siteSlug>/<skript>/<page>, which reads
  // headers() + cookies() for SEB detection and exam-session auth. That whole
  // flow used to be inlined here, which forced a dynamic render for every
  // visitor of every content page on eduskript.org. The custom-domain twin
  // ([domain]/[skriptSlug]/[pageSlug]) has always redirected instead; this now
  // matches it, and the redirect itself is part of the ISR output.
  if (page.pageType === 'exam') {
    redirect(`/exam/${pageSlug}/${skriptSlug}/${contentPageSlug}`)
  }

  const { publicAnnotations, publicSnaps, publicStickyNotes } = await getPublicLayers(page.id)

  // Authorship is resolved client-side (AnnotationLayer for the toolbar,
  // ClassToolbar's own gateOnPageAuthor); reading the session here would opt
  // the route out of static rendering again.

  // Build site structure
  const siteStructure = collection
    ? buildSiteStructure([{
        id: collection.id,
        title: collection.title,
        accentColor: collection.accentColor,
        collectionSkripts: [{
          order: collectionSkript?.order ?? 0,
          skript: {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            isPublished: skript.isPublished,
            pages: allPages
          }
        }]
      }], { onlyPublished: true })
    : [{
        id: 'standalone',
        title: skript.title,
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: allPages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  const teacherSite = teacher.sites[0]
  const fullSiteStructure = (teacherSite?.sidebarBehavior || 'full') === 'full'
    ? await getFullSiteStructure(teacher.id, teacherSite.slug)
    : undefined

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacherSite?.slug || pageSlug,
    pageName: teacherSite?.pageName || null,
    pageDescription: teacherSite?.pageDescription || null,
    pageIcon: teacherSite?.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${skriptSlug}/${contentPageSlug}`

  const body = (
    <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
      <article className="prose-theme">
        <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes}>
          <ServerMarkdownRenderer
            content={page.content}
            skriptId={skript.id}
            pageId={page.id}
            organizationSlug={orgSlug}
            pageLanguage={orgSite.pageLanguage}
          />
        </AnnotationWrapper>
      </article>
    </div>
  )

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      fullSiteStructure={fullSiteStructure}
      currentPath={currentPath}
      sidebarBehavior={(teacherSite?.sidebarBehavior as 'contextual' | 'full') || 'full'}
      typographyPreference={(teacher.sites[0]?.typographyPreference as 'modern' | 'classic') || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
      pageId={page.id}
    >
      {/* Submissions list for the page's author. The server-side gate went with
          the session read, so the toolbar self-gates client-side on page
          authorship — same as the org /c/ content route. Exam controls are not
          needed here: exam pages redirect to /exam/... above. */}
      <ClassToolbar
        pageId={page.id}
        pageType={page.pageType ?? 'standard'}
        unlockedClasses={[]}
        gateOnPageAuthor
      />

      {body}
    </PublicSiteLayout>
  )
}
