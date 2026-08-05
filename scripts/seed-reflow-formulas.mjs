import { config } from 'dotenv'
config({ path: '.env.local' }); config()
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const pg = (await import('pg')).default
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) })

const f1 = '\\int_0^{\\infty} x^{2} e^{-\\alpha x}\\,dx + \\sum_{k=1}^{n} \\frac{(-1)^{k}}{k^{2}} \\binom{n}{k} \\cos(k\\theta)'
const f2 = '\\prod_{j=1}^{m} \\frac{\\alpha_j + \\beta_j^{2}}{\\gamma_j - \\delta_j} \\cdot \\sqrt{\\lambda_j^{3} + \\mu_j x + \\nu_j}'
const section = `\n\n## Long formulas\n\nHere are two long inline formulas: $${f1}$ and $${f2}$ end.\n`

const page = await prisma.page.findFirst({ where: { slug: 'intro' }, select: { id: true, content: true } })
let content = page.content.split('\n## Two formulas')[0].split('\n## Long formulas')[0]
content += section
await prisma.page.update({ where: { id: page.id }, data: { content } })
console.log('updated. tail:\n', content.slice(-280))
await prisma.$disconnect()
