#!/usr/bin/env node
/**
 * One-off: split eduskript.org into a German main site and an English site
 * at eduskript.org/en. Idempotent — every step checks before writing.
 *
 *   DATABASE_URL=<prod url> node scripts/setup-en-site.mjs --owner marc@example.ch
 *
 * Steps:
 *   1. Create Site slug "en" owned by --owner (a teacher account), unless it exists.
 *      Same rules as POST /api/admin/users/<id>/sites (order = max + 1).
 *   2. Copy the default org's FrontPage to the "en" site, unless "en" has one:
 *      content with https://eduskript.org/c/ links rewritten to /en/, same
 *      isPublished, plus a hidden file skript (`__frontpage_files_<id>`, same
 *      convention as /api/frontpage/[id]/ensure-file-storage) with the org
 *      frontpage's top-level File rows copied by name — no S3 traffic, storage
 *      is content-addressed by hash.
 *   3. pageLanguage: "en" → 'en', default org site → 'de'.
 *
 * The collections themselves ("User Manual", "Developer Guide") are NOT moved
 * here: scripts/sync-docs.mjs re-homes them at the next deploy because
 * docs/_collections.json names `"site": "en"` for them. The German
 * "Benutzerhandbuch" is created by that same sync from docs/de/.
 *
 * Caches: the app's cached sidebar/frontpage queries are not invalidated by
 * this script. The deploy that follows restarts the app, which is enough.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { config } from 'dotenv'

config()

const { Pool } = pg
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}
const isLocal = connectionString.includes('localhost')
const pool = new Pool({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const args = process.argv.slice(2)
const ownerEmail = args[args.indexOf('--owner') + 1]
if (!args.includes('--owner') || !ownerEmail) {
  console.error('Usage: node scripts/setup-en-site.mjs --owner <teacher email>')
  process.exit(1)
}

const EN_SLUG = 'en'
const defaultOrgSlug = process.env.DEFAULT_ORG_SLUG || 'eduskript'

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true } })
  if (!owner) throw new Error(`No user with email ${ownerEmail}`)

  const orgSite = await prisma.site.findFirst({
    where: { slug: defaultOrgSlug, organizationId: { not: null } },
    select: { id: true, slug: true, pageLanguage: true, frontPage: { select: { id: true, content: true, isPublished: true, fileSkriptId: true } } },
  })
  if (!orgSite) throw new Error(`Default org site "${defaultOrgSlug}" not found`)

  // 1. Site "en"
  let enSite = await prisma.site.findUnique({ where: { slug: EN_SLUG }, select: { id: true, userId: true, pageLanguage: true, frontPage: { select: { id: true } } } })
  if (enSite) {
    if (enSite.userId !== owner.id) throw new Error(`Site /${EN_SLUG} exists but is owned by another user`)
    console.log(`✓ Site /${EN_SLUG} exists (${enSite.id})`)
  } else {
    const maxOrder = await prisma.site.aggregate({ where: { userId: owner.id }, _max: { order: true } })
    enSite = await prisma.site.create({
      data: { slug: EN_SLUG, userId: owner.id, pageName: 'Eduskript', pageLanguage: 'en', order: (maxOrder._max.order ?? -1) + 1 },
      select: { id: true, userId: true, pageLanguage: true, frontPage: { select: { id: true } } },
    })
    console.log(`✓ Created site /${EN_SLUG} (${enSite.id}) for ${owner.email}`)
  }

  // 2. Frontpage copy
  if (enSite.frontPage) {
    console.log(`✓ /${EN_SLUG} already has a frontpage — not touched`)
  } else if (!orgSite.frontPage) {
    console.log(`⚠ Org site has no frontpage — nothing to copy`)
  } else {
    const content = orgSite.frontPage.content.replaceAll(`https://eduskript.org/c/`, `https://eduskript.org/${EN_SLUG}/`)
    const fp = await prisma.frontPage.create({
      data: { siteId: enSite.id, content, isPublished: orgSite.frontPage.isPublished },
      select: { id: true },
    })
    const fileSkript = await prisma.skript.create({
      data: {
        title: 'User Front Page Files',
        slug: `__frontpage_files_${fp.id}`,
        description: 'Hidden skript for front page file storage',
        isPublished: false,
        authors: { create: { userId: owner.id, permission: 'author' } },
      },
      select: { id: true },
    })
    await prisma.frontPage.update({ where: { id: fp.id }, data: { fileSkriptId: fileSkript.id } })
    let copied = 0
    if (orgSite.frontPage.fileSkriptId) {
      const files = await prisma.file.findMany({ where: { skriptId: orgSite.frontPage.fileSkriptId, parentId: null, isDirectory: false } })
      for (const f of files) {
        await prisma.file.create({
          data: { name: f.name, isDirectory: false, skriptId: fileSkript.id, hash: f.hash, contentType: f.contentType, size: f.size, width: f.width, height: f.height, createdBy: f.createdBy },
        })
        copied++
      }
    }
    console.log(`✓ Frontpage copied to /${EN_SLUG} (${copied} file row(s) copied, links /c/ → /${EN_SLUG}/)`)
  }

  // 3. Languages
  if (enSite.pageLanguage !== 'en') {
    await prisma.site.update({ where: { id: enSite.id }, data: { pageLanguage: 'en' } })
    console.log(`✓ /${EN_SLUG} pageLanguage → en`)
  }
  if (orgSite.pageLanguage !== 'de') {
    await prisma.site.update({ where: { id: orgSite.id }, data: { pageLanguage: 'de' } })
    console.log(`✓ /${defaultOrgSlug} (org) pageLanguage → de`)
  }

  console.log('\nDone. Next: push docs/ + sync changes; the deploy-time sync moves "User Manual"/"Developer Guide" to /en and creates "Benutzerhandbuch".')
}

main()
  .catch(e => { console.error('❌', e.message); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
