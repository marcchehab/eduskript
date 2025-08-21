import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Create a teacher user
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@example.com' },
    update: {},
    create: {
      email: 'teacher@example.com',
      name: 'Dr. Sarah Johnson',
      title: 'Mathematics Teacher',
      subdomain: 'informatikgarten'
    }
  })

  // Create a test collection
  const collection = await prisma.collection.upsert({
    where: { slug: 'algebra-basics' },
    update: {},
    create: {
      title: 'Algebra Basics',
      description: 'Introduction to fundamental algebra concepts',
      slug: 'algebra-basics',
      isPublished: true
    }
  })

  // Add the teacher as an author of the collection
  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: collection.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      collectionId: collection.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  // Create test chapters
  const chapter1 = await prisma.chapter.upsert({
    where: {
      collectionId_slug: {
        collectionId: collection.id,
        slug: 'introduction'
      }
    },
    update: {},
    create: {
      title: 'Introduction to Variables',
      description: 'Understanding what variables are and how to use them',
      slug: 'introduction',
      order: 1,
      isPublished: true,
      collectionId: collection.id
    }
  })

  // Add the teacher as an author of chapter1
  await prisma.chapterAuthor.upsert({
    where: {
      chapterId_userId: {
        chapterId: chapter1.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      chapterId: chapter1.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  const chapter2 = await prisma.chapter.upsert({
    where: {
      collectionId_slug: {
        collectionId: collection.id,
        slug: 'solving-equations'
      }
    },
    update: {},
    create: {
      title: 'Solving Linear Equations',
      description: 'Step-by-step guide to solving linear equations',
      slug: 'solving-equations',
      order: 2,
      isPublished: true,
      collectionId: collection.id
    }
  })

  // Add the teacher as an author of chapter2
  await prisma.chapterAuthor.upsert({
    where: {
      chapterId_userId: {
        chapterId: chapter2.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      chapterId: chapter2.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  // Create test pages for chapter 1
  const page1 = await prisma.page.upsert({
    where: {
      chapterId_slug: {
        chapterId: chapter1.id,
        slug: 'what-are-variables'
      }
    },
    update: {},
    create: {
      title: 'What are Variables?',
      content: `# What are Variables?

Variables are symbols that represent unknown values in mathematics. They are typically represented by letters like x, y, or z.

## Key Concepts

- A variable can represent any number
- Variables allow us to write general mathematical statements
- We can solve for variables to find their specific values

## Examples

If x = 5, then:
- x + 3 = 8
- 2x = 10
- x² = 25`,
      slug: 'what-are-variables',
      order: 1,
      isPublished: true,
      chapterId: chapter1.id
    }
  })

  // Add the teacher as an author of page1
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page1.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      pageId: page1.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  const page2 = await prisma.page.upsert({
    where: {
      chapterId_slug: {
        chapterId: chapter1.id,
        slug: 'using-variables'
      }
    },
    update: {},
    create: {
      title: 'Using Variables in Practice',
      content: `# Using Variables in Practice

Now that we understand what variables are, let's practice using them in real scenarios.

## Practice Problems

1. If a = 7, what is a + 4?
2. If b = 12, what is b - 5?
3. If c = 3, what is 4c?

## Solutions

1. a + 4 = 7 + 4 = 11
2. b - 5 = 12 - 5 = 7  
3. 4c = 4 × 3 = 12`,
      slug: 'using-variables',
      order: 2,
      isPublished: true,
      chapterId: chapter1.id
    }
  })

  // Add the teacher as an author of page2
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page2.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      pageId: page2.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  // Create test pages for chapter 2
  const page3 = await prisma.page.upsert({
    where: {
      chapterId_slug: {
        chapterId: chapter2.id,
        slug: 'basic-equations'
      }
    },
    update: {},
    create: {
      title: 'Basic Linear Equations',
      content: `# Basic Linear Equations

A linear equation is an equation that makes a straight line when graphed.

## Standard Form

The standard form of a linear equation is: ax + b = c

Where:
- a, b, and c are constants
- x is the variable we want to solve for

## Example

Solve: 2x + 3 = 11

Steps:
1. Subtract 3 from both sides: 2x = 8
2. Divide both sides by 2: x = 4

Check: 2(4) + 3 = 8 + 3 = 11 ✓`,
      slug: 'basic-equations',
      order: 1,
      isPublished: true,
      chapterId: chapter2.id
    }
  })

  // Add the teacher as an author of page3
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page3.id,
        userId: teacher.id
      }
    },
    update: {},
    create: {
      pageId: page3.id,
      userId: teacher.id,
      role: 'author'
    }
  })

  console.log('Seed data created successfully!')
  console.log('Teacher:', teacher.email)
  console.log('Collection:', collection.title)
  console.log('Chapters:', chapter1.title, ',', chapter2.title)
  console.log('Pages created: 3')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
