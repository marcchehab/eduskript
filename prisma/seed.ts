import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Default password for test users
  const defaultPassword = 'test123'
  const hashedPassword = await bcrypt.hash(defaultPassword, 12)

  // Create teacher users
  const teacher1 = await prisma.user.upsert({
    where: { email: 'sarah@informatikgarten.ch' },
    update: {
      hashedPassword,
      emailVerified: new Date()
    },
    create: {
      email: 'sarah@informatikgarten.ch',
      name: 'Dr. Sarah Johnson',
      title: 'Mathematics Teacher',
      subdomain: 'sarah',
      hashedPassword,
      emailVerified: new Date()
    }
  })

  const teacher2 = await prisma.user.upsert({
    where: { email: 'michael@informatikgarten.ch' },
    update: {
      hashedPassword,
      emailVerified: new Date()
    },
    create: {
      email: 'michael@informatikgarten.ch',
      name: 'Prof. Michael Chen',
      title: 'Physics Professor',
      bio: 'Specializing in quantum mechanics and theoretical physics',
      subdomain: 'michael',
      hashedPassword,
      emailVerified: new Date()
    }
  })

  const teacher3 = await prisma.user.upsert({
    where: { email: 'emily@informatikgarten.ch' },
    update: {
      hashedPassword,
      emailVerified: new Date()
    },
    create: {
      email: 'emily@informatikgarten.ch',
      name: 'Dr. Emily Rodriguez',
      title: 'Computer Science Teacher',
      bio: 'Passionate about programming education and software engineering',
      subdomain: 'emily',
      hashedPassword,
      emailVerified: new Date()
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
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      collectionId: collection.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // Create test skripts
  const skript1 = await prisma.skript.upsert({
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

  // Add the teacher as an author of skript1
  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: skript1.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      skriptId: skript1.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  const skript2 = await prisma.skript.upsert({
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

  // Add the teacher as an author of skript2
  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: skript2.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      skriptId: skript2.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // Create test pages for skript 1
  const page1 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: skript1.id,
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
      skriptId: skript1.id
    }
  })

  // Add the teacher as an author of page1
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page1.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      pageId: page1.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  const page2 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: skript1.id,
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
      skriptId: skript1.id
    }
  })

  // Add the teacher as an author of page2
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page2.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      pageId: page2.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // Create test pages for skript 2
  const page3 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: skript2.id,
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
      skriptId: skript2.id
    }
  })

  // Add the teacher as an author of page3
  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: page3.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      pageId: page3.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // CREATE MORE COLLECTIONS FOR DIFFERENT TEACHERS

  // Physics collection for Michael
  const physicsCollection = await prisma.collection.upsert({
    where: { slug: 'quantum-physics-101' },
    update: {},
    create: {
      title: 'Quantum Physics 101',
      description: 'Introduction to quantum mechanics and its applications',
      slug: 'quantum-physics-101',
      isPublished: true
    }
  })

  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: physicsCollection.id,
        userId: teacher2.id
      }
    },
    update: {},
    create: {
      collectionId: physicsCollection.id,
      userId: teacher2.id,
      permission: 'author'
    }
  })

  // Computer Science collection for Emily
  const csCollection = await prisma.collection.upsert({
    where: { slug: 'programming-fundamentals' },
    update: {},
    create: {
      title: 'Programming Fundamentals',
      description: 'Learn the basics of programming with JavaScript',
      slug: 'programming-fundamentals',
      isPublished: true
    }
  })

  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: csCollection.id,
        userId: teacher3.id
      }
    },
    update: {},
    create: {
      collectionId: csCollection.id,
      userId: teacher3.id,
      permission: 'author'
    }
  })

  // Advanced Math collection for Sarah
  const advMathCollection = await prisma.collection.upsert({
    where: { slug: 'calculus-essentials' },
    update: {},
    create: {
      title: 'Calculus Essentials',
      description: 'Master the fundamentals of differential and integral calculus',
      slug: 'calculus-essentials',
      isPublished: true
    }
  })

  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: advMathCollection.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      collectionId: advMathCollection.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // CREATE PHYSICS SKRIPTS
  const quantumSkript1 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: physicsCollection.id,
        slug: 'wave-particle-duality'
      }
    },
    update: {},
    create: {
      title: 'Wave-Particle Duality',
      description: 'Understanding the dual nature of light and matter',
      slug: 'wave-particle-duality',
      order: 1,
      isPublished: true,
      collectionId: physicsCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: quantumSkript1.id,
        userId: teacher2.id
      }
    },
    update: {},
    create: {
      skriptId: quantumSkript1.id,
      userId: teacher2.id,
      permission: 'author'
    }
  })

  const quantumSkript2 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: physicsCollection.id,
        slug: 'heisenberg-principle'
      }
    },
    update: {},
    create: {
      title: 'Heisenberg Uncertainty Principle',
      description: 'Exploring the limits of measurement in quantum mechanics',
      slug: 'heisenberg-principle',
      order: 2,
      isPublished: true,
      collectionId: physicsCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: quantumSkript2.id,
        userId: teacher2.id
      }
    },
    update: {},
    create: {
      skriptId: quantumSkript2.id,
      userId: teacher2.id,
      permission: 'author'
    }
  })

  // CREATE PROGRAMMING SKRIPTS
  const progSkript1 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: csCollection.id,
        slug: 'variables-and-data-types'
      }
    },
    update: {},
    create: {
      title: 'Variables and Data Types',
      description: 'Learn about different data types and how to work with variables',
      slug: 'variables-and-data-types',
      order: 1,
      isPublished: true,
      collectionId: csCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: progSkript1.id,
        userId: teacher3.id
      }
    },
    update: {},
    create: {
      skriptId: progSkript1.id,
      userId: teacher3.id,
      permission: 'author'
    }
  })

  const progSkript2 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: csCollection.id,
        slug: 'functions-and-scope'
      }
    },
    update: {},
    create: {
      title: 'Functions and Scope',
      description: 'Understanding function declarations and variable scope',
      slug: 'functions-and-scope',
      order: 2,
      isPublished: true,
      collectionId: csCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: progSkript2.id,
        userId: teacher3.id
      }
    },
    update: {},
    create: {
      skriptId: progSkript2.id,
      userId: teacher3.id,
      permission: 'author'
    }
  })

  // CREATE CALCULUS SKRIPTS
  const calcSkript1 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: advMathCollection.id,
        slug: 'limits-and-continuity'
      }
    },
    update: {},
    create: {
      title: 'Limits and Continuity',
      description: 'Understanding limits as the foundation of calculus',
      slug: 'limits-and-continuity',
      order: 1,
      isPublished: true,
      collectionId: advMathCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: calcSkript1.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      skriptId: calcSkript1.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  const calcSkript2 = await prisma.skript.upsert({
    where: {
      collectionId_slug: {
        collectionId: advMathCollection.id,
        slug: 'derivatives'
      }
    },
    update: {},
    create: {
      title: 'Introduction to Derivatives',
      description: 'Learn how to find rates of change using derivatives',
      slug: 'derivatives',
      order: 2,
      isPublished: true,
      collectionId: advMathCollection.id
    }
  })

  await prisma.skriptAuthor.upsert({
    where: {
      skriptId_userId: {
        skriptId: calcSkript2.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      skriptId: calcSkript2.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // CREATE PHYSICS PAGES
  const physicsPage1 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: quantumSkript1.id,
        slug: 'double-slit-experiment'
      }
    },
    update: {},
    create: {
      title: 'The Double-Slit Experiment',
      content: `# The Double-Slit Experiment

The double-slit experiment demonstrates the wave-particle duality of light and matter.

## The Setup

- Light source shines through two parallel slits
- Screen placed behind the slits to observe the pattern

## What We Observe

When light passes through both slits:
- **Wave behavior**: Creates an interference pattern with bright and dark bands
- **Particle behavior**: Individual photons can be detected

## The Mystery

The particle somehow "knows" about both slits and interferes with itself!

## Key Insight

> "The quantum world behaves differently when we're not observing it."

This experiment revolutionized our understanding of quantum mechanics.`,
      slug: 'double-slit-experiment',
      order: 1,
      isPublished: true,
      skriptId: quantumSkript1.id
    }
  })

  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: physicsPage1.id,
        userId: teacher2.id
      }
    },
    update: {},
    create: {
      pageId: physicsPage1.id,
      userId: teacher2.id,
      permission: 'author'
    }
  })

  // CREATE PROGRAMMING PAGES
  const progPage1 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: progSkript1.id,
        slug: 'javascript-variables'
      }
    },
    update: {},
    create: {
      title: 'JavaScript Variables',
      content: `# JavaScript Variables

Variables are containers for storing data values.

## Declaring Variables

\`\`\`javascript
let name = "John";
const age = 25;
var city = "New York";
\`\`\`

## Data Types

### Primitive Types
- **String**: \`"Hello World"\`
- **Number**: \`42\`, \`3.14\`
- **Boolean**: \`true\`, \`false\`
- **Undefined**: \`undefined\`
- **Null**: \`null\`

### Complex Types
- **Object**: \`{ name: "John", age: 25 }\`
- **Array**: \`[1, 2, 3, 4, 5]\`

## Variable Rules

1. Names can contain letters, digits, underscores, and dollar signs
2. Names must begin with a letter, underscore, or dollar sign
3. Names are case-sensitive
4. Reserved words cannot be used as names

## Best Practices

- Use \`const\` for values that won't change
- Use \`let\` for values that will change
- Avoid \`var\` in modern JavaScript
- Use descriptive names: \`userAge\` instead of \`a\``,
      slug: 'javascript-variables',
      order: 1,
      isPublished: true,
      skriptId: progSkript1.id
    }
  })

  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: progPage1.id,
        userId: teacher3.id
      }
    },
    update: {},
    create: {
      pageId: progPage1.id,
      userId: teacher3.id,
      permission: 'author'
    }
  })

  // CREATE CALCULUS PAGES
  const calcPage1 = await prisma.page.upsert({
    where: {
      skriptId_slug: {
        skriptId: calcSkript1.id,
        slug: 'understanding-limits'
      }
    },
    update: {},
    create: {
      title: 'Understanding Limits',
      content: `# Understanding Limits

A limit describes the value a function approaches as the input approaches some value.

## Notation

$$\\lim_{x \\to a} f(x) = L$$

This reads: "The limit of f(x) as x approaches a equals L"

## Intuitive Understanding

Imagine you're walking toward a door:
- You get closer and closer
- But maybe never actually reach it
- The door represents the limit

## Example

Consider: $$\\lim_{x \\to 2} (x^2 - 1)$$

As x gets closer to 2:
- When x = 1.9: f(x) = 2.61
- When x = 1.99: f(x) = 2.9601
- When x = 1.999: f(x) = 2.996001

The limit is 3, even though we never actually plug in x = 2.

## Types of Limits

1. **Finite Limits**: Function approaches a specific value
2. **Infinite Limits**: Function grows without bound
3. **Limits at Infinity**: What happens as x gets very large

## Why Limits Matter

Limits are the foundation for:
- Derivatives (rate of change)
- Integrals (area under curves)
- Continuity (smooth functions)`,
      slug: 'understanding-limits',
      order: 1,
      isPublished: true,
      skriptId: calcSkript1.id
    }
  })

  await prisma.pageAuthor.upsert({
    where: {
      pageId_userId: {
        pageId: calcPage1.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      pageId: calcPage1.id,
      userId: teacher1.id,
      permission: 'author'
    }
  })

  // CREATE SOME COLLABORATION RELATIONSHIPS
  await prisma.collaboration.upsert({
    where: {
      requesterId_receiverId: {
        requesterId: teacher1.id,
        receiverId: teacher2.id
      }
    },
    update: {},
    create: {
      requesterId: teacher1.id,
      receiverId: teacher2.id
    }
  })

  await prisma.collaboration.upsert({
    where: {
      requesterId_receiverId: {
        requesterId: teacher2.id,
        receiverId: teacher3.id
      }
    },
    update: {},
    create: {
      requesterId: teacher2.id,
      receiverId: teacher3.id
    }
  })

  // GIVE SARAH ACCESS TO VIEW MICHAEL'S PHYSICS CONTENT
  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: physicsCollection.id,
        userId: teacher1.id
      }
    },
    update: {},
    create: {
      collectionId: physicsCollection.id,
      userId: teacher1.id,
      permission: 'viewer'
    }
  })

  // GIVE EMILY ACCESS TO EDIT SARAH'S CALCULUS CONTENT
  await prisma.collectionAuthor.upsert({
    where: {
      collectionId_userId: {
        collectionId: advMathCollection.id,
        userId: teacher3.id
      }
    },
    update: {},
    create: {
      collectionId: advMathCollection.id,
      userId: teacher3.id,
      permission: 'author'
    }
  })

  // CREATE A SAMPLE PAGE LAYOUT FOR SARAH
  const sarahLayout = await prisma.pageLayout.upsert({
    where: { userId: teacher1.id },
    update: {},
    create: {
      userId: teacher1.id,
      items: {
        create: [
          {
            type: 'collection',
            contentId: collection.id,
            order: 0
          },
          {
            type: 'collection', 
            contentId: advMathCollection.id,
            order: 1
          }
        ]
      }
    }
  })

  console.log('🎉 EXPANDED SEED DATA CREATED SUCCESSFULLY!')
  console.log('')
  console.log('👩‍🏫 Teachers created (password: "test123"):')
  console.log('- Sarah Johnson (sarah@informatikgarten.ch) - Mathematics')
  console.log('  → Subdomain: sarah.localhost:3000 or http://localhost:3000/sarah')
  console.log('- Michael Chen (michael@informatikgarten.ch) - Physics') 
  console.log('  → Subdomain: michael.localhost:3000 or http://localhost:3000/michael')
  console.log('- Emily Rodriguez (emily@informatikgarten.ch) - Computer Science')
  console.log('  → Subdomain: emily.localhost:3000 or http://localhost:3000/emily')
  console.log('')
  console.log('📚 Collections created:')
  console.log('- Algebra Basics (Sarah) - 2 skripts, 3 pages')
  console.log('- Quantum Physics 101 (Michael) - 2 skripts, 1 page')
  console.log('- Programming Fundamentals (Emily) - 2 skripts, 1 page')
  console.log('- Calculus Essentials (Sarah) - 2 skripts, 1 page')
  console.log('')
  console.log('🤝 Collaborations set up:')
  console.log('- Sarah ↔ Michael (collaborators)')
  console.log('- Michael ↔ Emily (collaborators)')
  console.log('- Sarah can VIEW Michael\'s Physics content')
  console.log('- Emily can EDIT Sarah\'s Calculus content')
  console.log('')
  console.log('📄 Sarah has a sample page layout configured!')
  console.log('')
  console.log('🚀 Ready to test the page builder!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
