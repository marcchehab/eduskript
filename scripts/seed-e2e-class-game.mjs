/**
 * Seed for trying a class game plugin (plugin.setShared / payloads, see
 * src/lib/plugin-share.ts) locally with real logins. Run after seed-e2e.mjs:
 *
 *   node scripts/seed-e2e.mjs && node scripts/seed-e2e-class-game.mjs <entry.html>
 *
 * Adds to the e2e teacher: the plugin `e2e/graph-zeichnen` from <entry.html>,
 * the page /e2e/e2e-annotations/spiel embedding it with share="class" live="1",
 * a class, and three students (password = E2E_PASSWORD) who are members.
 * Idempotent: deletes its own rows first.
 */
import fs from 'fs'
import { E2E_EMAIL, E2E_PASSWORD } from './seed-e2e.mjs'

export const STUDENTS = ['ada', 'ben', 'cleo'].map((n) => ({ email: `e2e-${n}@eduskript.test`, name: n[0].toUpperCase() + n.slice(1) }))
export const GAME_PAGE_PATH = '/e2e/e2e-annotations/spiel'

const { default: dotenv } = await import('dotenv')
dotenv.config()
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default
const bcrypt = (await import('bcryptjs')).default
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

try {
  const entryHtml = fs.readFileSync(process.argv[2], 'utf8')
  const teacher = await prisma.user.findUniqueOrThrow({ where: { email: E2E_EMAIL } })
  await prisma.user.deleteMany({ where: { email: { in: STUDENTS.map((s) => s.email) } } })
  await prisma.class.deleteMany({ where: { teacherId: teacher.id } })
  await prisma.plugin.deleteMany({ where: { authorId: teacher.id, slug: 'graph-zeichnen' } })
  await prisma.page.deleteMany({ where: { id: 'e2e-page-spiel' } })

  await prisma.plugin.create({
    data: { slug: 'graph-zeichnen', name: 'Graph zeichnen', authorId: teacher.id, manifest: { defaultHeight: 760 }, entryHtml },
  })
  await prisma.page.create({
    data: {
      id: 'e2e-page-spiel', title: 'Spiel', slug: 'spiel', order: 1, isPublished: true, skriptId: 'e2e-skript-0001',
      authors: { create: { userId: teacher.id, permission: 'author' } },
      content: `# Parabelicus Maximus

<plugin src="e2e/graph-zeichnen" id="spiel" share="class" live="1" time="12" winner="Parabelicus Maximus">
f(x) = -1/2(x+1)^2 + 3 | key=(-1,3)
f(x) = 2(x-2)^2 - 4 | key=(2,-4)
</plugin>
`,
    },
  })
  const cls = await prisma.class.create({ data: { name: '4d Test', teacherId: teacher.id, inviteCode: 'e2e-class-game' } })
  const hashedPassword = await bcrypt.hash(E2E_PASSWORD, 12)
  for (const s of STUDENTS) {
    const u = await prisma.user.create({
      data: { email: s.email, name: s.name, accountType: 'student', hashedPassword, emailVerified: new Date() },
    })
    await prisma.classMembership.create({ data: { classId: cls.id, studentId: u.id } })
  }
  console.log(`Seeded class game: ${GAME_PAGE_PATH}, students ${STUDENTS.map((s) => s.email).join(', ')}`)
} finally {
  await prisma.$disconnect()
  await pool.end()
}
