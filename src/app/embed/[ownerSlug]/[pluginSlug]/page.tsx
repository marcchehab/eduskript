import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { EmbedPlugin } from '@/components/embed/embed-plugin'

interface PageProps {
  params: Promise<{ ownerSlug: string; pluginSlug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { ownerSlug, pluginSlug } = await params
  const plugin = await prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { pageSlug: ownerSlug } },
    select: { name: true, description: true },
  })
  if (!plugin) {
    return { title: 'Plugin not found', robots: { index: false, follow: false } }
  }
  return {
    title: plugin.name,
    description: plugin.description ?? undefined,
    robots: { index: false, follow: false },
  }
}

export default async function EmbedPluginPage({ params }: PageProps) {
  const { ownerSlug, pluginSlug } = await params

  const plugin = await prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { pageSlug: ownerSlug } },
    select: { entryHtml: true, name: true, manifest: true },
  })

  if (!plugin) notFound()

  return <EmbedPlugin entryHtml={plugin.entryHtml} name={plugin.name} />
}
