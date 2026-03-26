import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// POST /api/admin/seed-example-data - Create eduskript org + teacher user with example content
export async function POST(request: Request) {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    // Guard: check if eduskript org already exists
    const existingOrg = await prisma.organization.findUnique({
      where: { slug: 'eduskript' },
    })

    if (existingOrg) {
      return NextResponse.json(
        { error: 'The "eduskript" organization already exists. Sample data was already seeded.' },
        { status: 400 }
      )
    }

    // Create the eduskript organization
    const org = await prisma.organization.create({
      data: {
        name: 'Eduskript',
        slug: 'eduskript',
        description: 'The Eduskript platform organization',
      },
    })

    // Create teacher user (password: "teacher")
    const hashedPassword = await bcrypt.hash('teacher', 12)
    const teacherUser = await prisma.user.create({
      data: {
        email: 'teacher@eduskript.org',
        name: 'Demo Teacher',
        pageSlug: 'teacher',
        accountType: 'teacher',
        hashedPassword: hashedPassword,
        emailVerified: new Date(),
        requirePasswordReset: false,
        billingPlan: 'pro',
      },
    })

    // Add teacher as org owner
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: teacherUser.id,
        role: 'owner',
      },
    })

    // Add platform admin as org admin so they can access the org dashboard immediately
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: session!.user.id,
        role: 'admin',
      },
    })

    // Create example collection authored by the teacher
    const tutorialCollection = await prisma.collection.create({
      data: {
        title: 'Eduskript Tutorial',
        slug: 'eduskript-tutorial',
        description: 'Learn how to use all of Eduskript\'s features',
        authors: {
          create: {
            userId: teacherUser.id,
            permission: 'author',
          },
        },
      },
    })

    // Create example skripts
    const markdownSkript = await prisma.skript.create({
      data: {
        title: 'Markdown Basics',
        slug: 'markdown-basics',
        description: 'Learn Markdown formatting and text styling',
        isPublished: true,
        authors: {
          create: {
            userId: teacherUser.id,
            permission: 'author',
          },
        },
      },
    })

    const mathSkript = await prisma.skript.create({
      data: {
        title: 'Math & LaTeX',
        slug: 'math-latex',
        description: 'Write beautiful mathematical equations with LaTeX',
        isPublished: true,
        authors: {
          create: {
            userId: teacherUser.id,
            permission: 'author',
          },
        },
      },
    })

    const codeSkript = await prisma.skript.create({
      data: {
        title: 'Interactive Code',
        slug: 'interactive-code',
        description: 'Run Python and JavaScript directly in your pages',
        isPublished: true,
        authors: {
          create: {
            userId: teacherUser.id,
            permission: 'author',
          },
        },
      },
    })

    // Link skripts to collection
    await prisma.collectionSkript.createMany({
      data: [
        { collectionId: tutorialCollection.id, skriptId: markdownSkript.id, order: 0 },
        { collectionId: tutorialCollection.id, skriptId: mathSkript.id, order: 1 },
        { collectionId: tutorialCollection.id, skriptId: codeSkript.id, order: 2 },
      ],
    })

    // Create example pages for Markdown Basics skript
    await prisma.page.create({
      data: {
        title: 'Headings & Text Formatting',
        slug: 'headings-text',
        skriptId: markdownSkript.id,
        order: 0,
        isPublished: true,
        content: `# Welcome to Eduskript!

Eduskript uses **Markdown** for formatting educational content. Let's learn the basics!

## Text Formatting

You can make text **bold** using double asterisks or __underscores__.

You can make text *italic* using single asterisks or _underscores_.

You can even combine them for ***bold and italic*** text!

For code or technical terms, use \`backticks\` to create inline code.

## Headings

Headings create structure in your content. Use 1-6 hash symbols:

# Heading 1 (Page Title)
## Heading 2 (Major Section)
### Heading 3 (Subsection)
#### Heading 4
##### Heading 5
###### Heading 6

## Lists

### Unordered Lists

Use asterisks, plus, or minus for bullet points:

* First item
* Second item
  * Nested item (indent with 2 spaces)
  * Another nested item
* Third item

### Ordered Lists

Use numbers followed by periods:

1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step

## Blockquotes

Use \`>\` for blockquotes:

> "Education is the most powerful weapon which you can use to change the world."
> — Nelson Mandela

---

That's it for basic formatting! Next, we'll explore tables and code blocks.
`,
        authors: {
          create: { userId: teacherUser.id, permission: 'author' },
        },
      },
    })

    await prisma.page.create({
      data: {
        title: 'Tables, Links & Code',
        slug: 'tables-links-code',
        skriptId: markdownSkript.id,
        order: 1,
        isPublished: true,
        content: `# Tables, Links & Code Blocks

## Tables

Create tables using pipes \`|\` and hyphens \`-\`:

| Feature | Markdown | HTML | Eduskript |
|---------|----------|------|-----------|
| Easy to write | ✓ | ✗ | ✓ |
| Math support | ✗ | ✗ | ✓ |
| Interactive code | ✗ | ✗ | ✓ |
| Syntax highlighting | ✗ | ✗ | ✓ |

## Links

Create links using \`[text](url)\`:

- External link: [Eduskript GitHub](https://github.com/marcchehab/eduskript)

## Code Blocks

Use triple backticks for code blocks with syntax highlighting:

\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))  # Output: 55
\`\`\`

## Task Lists

Create interactive checkboxes:

- [x] Learn Markdown basics
- [x] Master text formatting
- [ ] Learn LaTeX math (next chapter!)
- [ ] Try interactive code editors
`,
        authors: {
          create: { userId: teacherUser.id, permission: 'author' },
        },
      },
    })

    // Create example pages for Math & LaTeX skript
    await prisma.page.create({
      data: {
        title: 'Inline Math with LaTeX',
        slug: 'inline-math',
        skriptId: mathSkript.id,
        order: 0,
        isPublished: true,
        content: `# Writing Math with LaTeX

Eduskript supports beautiful mathematical typesetting using **LaTeX** with the KaTeX renderer.

## Inline Math

Use single dollar signs \`$\` for inline math: The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.

- Einstein's equation: $E = mc^2$
- Euler's identity: $e^{i\\pi} + 1 = 0$
- Area of a circle: $A = \\pi r^2$

## Display Math

$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

$$\\int_{a}^{b} f(x) \\, dx$$
`,
        authors: {
          create: { userId: teacherUser.id, permission: 'author' },
        },
      },
    })

    // Create example pages for Interactive Code skript
    await prisma.page.create({
      data: {
        title: 'Interactive Python Editor',
        slug: 'python-editor',
        skriptId: codeSkript.id,
        order: 0,
        isPublished: true,
        content: `# Interactive Python Editor

One of Eduskript's most powerful features is the ability to **run Python code directly in your browser**!

## Try It Out!

Click the **Run** button to execute this code:

\`\`\`python editor
# Basic Python example
def greet(name):
    return f"Hello, {name}! Welcome to Eduskript!"

print(greet("Student"))

# Fibonacci sequence
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(10):
    print(f"F({i}) = {fibonacci(i)}")
\`\`\`

**Tip:** Your code is automatically saved as you type!
`,
        authors: {
          create: { userId: teacherUser.id, permission: 'author' },
        },
      },
    })

    await prisma.page.create({
      data: {
        title: 'Interactive JavaScript Editor',
        slug: 'javascript-editor',
        skriptId: codeSkript.id,
        order: 1,
        isPublished: true,
        content: `# Interactive JavaScript Editor

You can also run **JavaScript code** directly in your pages!

\`\`\`javascript editor
// Basic JavaScript example
function greet(name) {
  return \`Hello, \${name}! Welcome to Eduskript!\`;
}

console.log(greet("Student"));

const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const evens = numbers.filter(n => n % 2 === 0);
console.log("Even numbers:", evens);
\`\`\`
`,
        authors: {
          create: { userId: teacherUser.id, permission: 'author' },
        },
      },
    })

    // Add collection to teacher's public page layout
    await prisma.pageLayout.upsert({
      where: { userId: teacherUser.id },
      create: {
        userId: teacherUser.id,
        items: {
          create: {
            type: 'collection',
            contentId: tutorialCollection.id,
            order: 0,
          },
        },
      },
      update: {
        items: {
          create: {
            type: 'collection',
            contentId: tutorialCollection.id,
            order: 0,
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Sample data seeded successfully. Teacher: teacher@eduskript.org / teacher',
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        skripts: 3,
        pages: 5,
      },
    })
  } catch (error) {
    console.error('Error seeding example data:', error)
    return NextResponse.json(
      { error: 'Failed to seed example data' },
      { status: 500 }
    )
  }
}
