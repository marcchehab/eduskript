import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// POST /api/admin/seed-example-data - Seed example data for demonstration
export async function POST(request: Request) {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    // Check if admin already has content
    const existingCollections = await prisma.collection.findFirst({
      where: {
        authors: {
          some: {
            userId: session!.user.id,
          },
        },
      },
    })

    if (existingCollections) {
      return NextResponse.json(
        { error: 'You already have collections. Example data seeding is only for new accounts.' },
        { status: 400 }
      )
    }

    // Create example users (teachers)
    const teacherPassword = await bcrypt.hash('teacher123', 12)

    const teacher1 = await prisma.user.create({
      data: {
        email: 'alice.johnson@example.com',
        name: 'Alice Johnson',
        subdomain: 'alicejohnson',
        title: 'Mathematics Teacher',
        hashedPassword: teacherPassword,
        emailVerified: new Date(),
        isAdmin: false,
        requirePasswordReset: true,
      },
    })

    const teacher2 = await prisma.user.create({
      data: {
        email: 'bob.smith@example.com',
        name: 'Bob Smith',
        subdomain: 'bobsmith',
        title: 'Physics Teacher',
        hashedPassword: teacherPassword,
        emailVerified: new Date(),
        isAdmin: false,
        requirePasswordReset: true,
      },
    })

    // Create example collection for admin
    const mathCollection = await prisma.collection.create({
      data: {
        title: 'Introduction to Algebra',
        slug: 'intro-to-algebra',
        description: 'A comprehensive introduction to algebraic concepts',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Create example skripts
    const linearEquationsSkript = await prisma.skript.create({
      data: {
        title: 'Linear Equations',
        slug: 'linear-equations',
        description: 'Understanding and solving linear equations',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const quadraticSkript = await prisma.skript.create({
      data: {
        title: 'Quadratic Equations',
        slug: 'quadratic-equations',
        description: 'Mastering quadratic equations and their graphs',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Link skripts to collection
    await prisma.collectionSkript.createMany({
      data: [
        {
          collectionId: mathCollection.id,
          skriptId: linearEquationsSkript.id,
          order: 0,
        },
        {
          collectionId: mathCollection.id,
          skriptId: quadraticSkript.id,
          order: 1,
        },
      ],
    })

    // Create example pages for Linear Equations skript
    const introPage = await prisma.page.create({
      data: {
        title: 'What are Linear Equations?',
        slug: 'what-are-linear-equations',
        skriptId: linearEquationsSkript.id,
        order: 0,
        content: `# What are Linear Equations?

A **linear equation** is an algebraic equation in which each term is either a constant or the product of a constant and a single variable.

## Standard Form

The standard form of a linear equation in one variable is:

\`\`\`
ax + b = 0
\`\`\`

Where:
- \`a\` and \`b\` are constants
- \`x\` is the variable
- \`a ≠ 0\`

## Examples

1. \`2x + 5 = 11\`
2. \`-3x + 7 = 1\`
3. \`x - 4 = 0\`

## Key Properties

- Linear equations graph as straight lines
- They have exactly one solution (when \`a ≠ 0\`)
- The solution represents the x-intercept of the line
`,
        sidebarBehavior: 'contextual',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const solvingPage = await prisma.page.create({
      data: {
        title: 'Solving Linear Equations',
        slug: 'solving-linear-equations',
        skriptId: linearEquationsSkript.id,
        order: 1,
        content: `# Solving Linear Equations

To solve a linear equation, we need to isolate the variable on one side of the equation.

## Step-by-Step Method

### Step 1: Simplify both sides
Remove parentheses and combine like terms.

### Step 2: Move variable terms to one side
Use addition or subtraction to get all variable terms on one side.

### Step 3: Move constant terms to the other side
Use addition or subtraction to get all constants on the other side.

### Step 4: Divide by the coefficient
Divide both sides by the coefficient of the variable.

## Example Problem

Solve: \`3x + 7 = 22\`

**Solution:**
1. Subtract 7 from both sides: \`3x = 15\`
2. Divide both sides by 3: \`x = 5\`

**Check:** \`3(5) + 7 = 15 + 7 = 22\` ✓

## Practice Problems

Try solving these on your own:

1. \`2x + 8 = 20\`
2. \`5x - 3 = 17\`
3. \`-4x + 12 = 0\`

\`\`\`javascript
// You can also use code to solve equations
function solveLinearEquation(a, b) {
  // Solve ax + b = 0
  if (a === 0) {
    return "No solution (a cannot be 0)";
  }
  return -b / a;
}

console.log(solveLinearEquation(3, -15)); // Output: 5
\`\`\`
`,
        sidebarBehavior: 'contextual',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Create example pages for Quadratic Equations skript
    const quadraticIntroPage = await prisma.page.create({
      data: {
        title: 'Introduction to Quadratics',
        slug: 'intro-to-quadratics',
        skriptId: quadraticSkript.id,
        order: 0,
        content: `# Introduction to Quadratic Equations

A **quadratic equation** is a polynomial equation of degree 2.

## Standard Form

$$ax^2 + bx + c = 0$$

Where:
- $a$, $b$, and $c$ are constants
- $x$ is the variable
- $a \\neq 0$

## Key Characteristics

- **Parabolic graph**: All quadratic equations graph as parabolas
- **Two solutions**: Can have 0, 1, or 2 real solutions
- **Vertex**: The turning point of the parabola
- **Axis of symmetry**: Vertical line through the vertex

## The Graph of a Quadratic

The graph of $y = ax^2 + bx + c$ is a parabola that:
- Opens **upward** if $a > 0$
- Opens **downward** if $a < 0$

The vertex is at $x = -\\frac{b}{2a}$

## Examples

1. $x^2 - 5x + 6 = 0$
2. $2x^2 + 3x - 2 = 0$
3. $-x^2 + 4x - 4 = 0$
`,
        sidebarBehavior: 'contextual',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const quadraticFormulaPage = await prisma.page.create({
      data: {
        title: 'The Quadratic Formula',
        slug: 'quadratic-formula',
        skriptId: quadraticSkript.id,
        order: 1,
        content: `# The Quadratic Formula

The quadratic formula is a powerful tool for solving any quadratic equation.

## The Formula

For the equation $ax^2 + bx + c = 0$, the solutions are:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

## The Discriminant

The expression under the square root, $b^2 - 4ac$, is called the **discriminant**.

- If $b^2 - 4ac > 0$: Two distinct real solutions
- If $b^2 - 4ac = 0$: One repeated real solution
- If $b^2 - 4ac < 0$: No real solutions (two complex solutions)

## Example

Solve $2x^2 + 5x - 3 = 0$

Here, $a = 2$, $b = 5$, $c = -3$

$$x = \\frac{-5 \\pm \\sqrt{5^2 - 4(2)(-3)}}{2(2)}$$

$$x = \\frac{-5 \\pm \\sqrt{25 + 24}}{4}$$

$$x = \\frac{-5 \\pm \\sqrt{49}}{4} = \\frac{-5 \\pm 7}{4}$$

Solutions:
- $x = \\frac{-5 + 7}{4} = \\frac{2}{4} = 0.5$
- $x = \\frac{-5 - 7}{4} = \\frac{-12}{4} = -3$

## Python Implementation

\`\`\`python
import math

def solve_quadratic(a, b, c):
    discriminant = b**2 - 4*a*c

    if discriminant > 0:
        x1 = (-b + math.sqrt(discriminant)) / (2*a)
        x2 = (-b - math.sqrt(discriminant)) / (2*a)
        return (x1, x2)
    elif discriminant == 0:
        x = -b / (2*a)
        return (x,)
    else:
        return "No real solutions"

print(solve_quadratic(2, 5, -3))  # Output: (0.5, -3.0)
\`\`\`
`,
        sidebarBehavior: 'contextual',
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Create a collection for teacher1
    const physicsCollection = await prisma.collection.create({
      data: {
        title: 'Newton\'s Laws of Motion',
        slug: 'newtons-laws',
        description: 'Understanding the fundamental laws of classical mechanics',
        authors: {
          create: {
            userId: teacher1.id,
            permission: 'author',
          },
        },
      },
    })

    const newtonsFirstLaw = await prisma.skript.create({
      data: {
        title: 'First Law: Inertia',
        slug: 'first-law-inertia',
        description: 'An object at rest stays at rest, an object in motion stays in motion',
        authors: {
          create: {
            userId: teacher1.id,
            permission: 'author',
          },
        },
      },
    })

    await prisma.collectionSkript.create({
      data: {
        collectionId: physicsCollection.id,
        skriptId: newtonsFirstLaw.id,
        order: 0,
      },
    })

    await prisma.page.create({
      data: {
        title: 'Understanding Inertia',
        slug: 'understanding-inertia',
        skriptId: newtonsFirstLaw.id,
        order: 0,
        content: `# Newton's First Law: The Law of Inertia

> An object at rest stays at rest, and an object in motion stays in motion with the same speed and in the same direction unless acted upon by an unbalanced force.

## What is Inertia?

**Inertia** is the tendency of an object to resist changes in its state of motion. The more massive an object, the greater its inertia.

## Real-World Examples

1. **Seatbelts in cars**: When a car suddenly stops, passengers continue moving forward due to inertia
2. **Tablecloth trick**: Quickly pulling a tablecloth can leave dishes in place
3. **Spacecraft in space**: With no air resistance, spacecraft continue moving without propulsion

## Key Concepts

- Objects naturally resist changes to their motion
- Force is required to change an object's velocity
- Mass is a measure of inertia
`,
        sidebarBehavior: 'contextual',
        authors: {
          create: {
            userId: teacher1.id,
            permission: 'author',
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Example data seeded successfully',
      data: {
        users: [
          { name: teacher1.name, email: teacher1.email, subdomain: teacher1.subdomain },
          { name: teacher2.name, email: teacher2.email, subdomain: teacher2.subdomain },
        ],
        collections: [
          { title: mathCollection.title, slug: mathCollection.slug },
          { title: physicsCollection.title, slug: physicsCollection.slug },
        ],
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
