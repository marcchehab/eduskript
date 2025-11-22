import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'

// POST /api/admin/seed-example-data - Seed example data for demonstration
export async function POST(request: Request) {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    // Verify the admin user exists in the database
    const adminUser = await prisma.user.findUnique({
      where: { id: session!.user.id },
    })

    if (!adminUser) {
      return NextResponse.json(
        { error: 'Admin user not found in database. Please log out and log back in.' },
        { status: 400 }
      )
    }

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

    // Create example collection for admin
    const tutorialCollection = await prisma.collection.create({
      data: {
        title: 'Eduskript Tutorial',
        slug: 'eduskript-tutorial',
        description: 'Learn how to use all of Eduskript\'s features',
        isPublished: true,
        authors: {
          create: {
            userId: session!.user.id,
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
            userId: session!.user.id,
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
            userId: session!.user.id,
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
          collectionId: tutorialCollection.id,
          skriptId: markdownSkript.id,
          order: 0,
        },
        {
          collectionId: tutorialCollection.id,
          skriptId: mathSkript.id,
          order: 1,
        },
        {
          collectionId: tutorialCollection.id,
          skriptId: codeSkript.id,
          order: 2,
        },
      ],
    })

    // Create example pages for Markdown Basics skript
    const headingsPage = await prisma.page.create({
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

## Horizontal Rules

Create a horizontal line with three or more hyphens, asterisks, or underscores:

---

That's it for basic formatting! Next, we'll explore lists and tables.
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const tablesLinksPage = await prisma.page.create({
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

You can align columns using colons:

| Left aligned | Center aligned | Right aligned |
|:-------------|:--------------:|--------------:|
| Left | Center | Right |
| Text | Text | Text |

## Links

Create links using \`[text](url)\`:

- External link: [Eduskript GitHub](https://github.com/marcchehab/eduskript)
- Email link: [Contact](mailto:example@eduskript.org)

## Code Blocks

Use triple backticks for code blocks with syntax highlighting:

\`\`\`python
def fibonacci(n):
    """Calculate the nth Fibonacci number."""
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))  # Output: 55
\`\`\`

\`\`\`javascript
// JavaScript example
const factorial = (n) => {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
};

console.log(factorial(5));  // Output: 120
\`\`\`

\`\`\`css
/* CSS example */
.highlight {
  background-color: #ffeb3b;
  padding: 2px 6px;
  border-radius: 3px;
}
\`\`\`

## Inline Code

Use single backticks for inline code: \`const x = 42;\` or \`print("Hello")\`

## Task Lists

Create interactive checkboxes:

- [x] Learn Markdown basics
- [x] Master text formatting
- [ ] Learn LaTeX math (next chapter!)
- [ ] Try interactive code editors
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Create example pages for Math & LaTeX skript
    const inlineMathPage = await prisma.page.create({
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

Here are more examples:

- The Pythagorean theorem: $a^2 + b^2 = c^2$
- Einstein's equation: $E = mc^2$
- Euler's identity: $e^{i\\pi} + 1 = 0$
- Area of a circle: $A = \\pi r^2$
- Derivative: $\\frac{d}{dx}(x^2) = 2x$

## Greek Letters

Use backslash followed by the letter name:

- Alpha: $\\alpha$, Beta: $\\beta$, Gamma: $\\gamma$, Delta: $\\delta$
- Pi: $\\pi$, Sigma: $\\sigma$, Omega: $\\omega$, Theta: $\\theta$
- Capital letters: $\\Gamma$, $\\Delta$, $\\Sigma$, $\\Omega$

## Subscripts and Superscripts

- Superscripts: $x^2$, $x^{10}$, $x^{2n+1}$
- Subscripts: $x_1$, $x_{i+1}$, $a_0$
- Both: $x_i^2$, $\\sum_{i=1}^{n} x_i$

## Common Symbols

- Fractions: $\\frac{1}{2}$, $\\frac{a+b}{c+d}$
- Square roots: $\\sqrt{2}$, $\\sqrt{x^2 + y^2}$
- Nth roots: $\\sqrt[3]{8}$, $\\sqrt[n]{x}$
- Inequalities: $x \\leq y$, $a \\geq b$, $x \\neq 0$
- Set notation: $x \\in \\mathbb{R}$, $A \\cup B$, $A \\cap B$, $A \\subseteq B$
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const displayMathPage = await prisma.page.create({
      data: {
        title: 'Display Math & Equations',
        slug: 'display-math',
        skriptId: mathSkript.id,
        order: 1,
        isPublished: true,
        content: `# Display Math & Complex Equations

For larger equations that should stand on their own line, use **double dollar signs** \`$$\`.

## Display Math

The quadratic formula in display mode:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

The solutions to a cubic equation:

$$x^3 + px + q = 0$$

## Summations and Products

Sum notation:

$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

Product notation:

$$\\prod_{i=1}^{n} i = n!$$

## Integrals and Derivatives

Definite integral:

$$\\int_{a}^{b} f(x) \\, dx$$

Partial derivatives:

$$\\frac{\\partial f}{\\partial x}, \\quad \\frac{\\partial^2 f}{\\partial x^2}$$

## Limits

$$\\lim_{x \\to \\infty} \\frac{1}{x} = 0$$

$$\\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h} = f'(x)$$

## Matrices

Write matrices using the \`pmatrix\` environment:

$$\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}$$

Identity matrix:

$$I = \\begin{pmatrix}
1 & 0 & 0 \\\\
0 & 1 & 0 \\\\
0 & 0 & 1
\\end{pmatrix}$$

## Systems of Equations

$$\\begin{cases}
x + y = 5 \\\\
2x - y = 1
\\end{cases}$$

## Aligned Equations

Use the \`aligned\` environment for step-by-step solutions:

$$\\begin{aligned}
(x+1)^2 &= x^2 + 2x + 1 \\\\
&= x^2 + 2x + 1
\\end{aligned}$$

## Famous Formulas

**Euler's Formula:**

$$e^{i\\theta} = \\cos\\theta + i\\sin\\theta$$

**Taylor Series:**

$$f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n$$

**Normal Distribution:**

$$f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2}$$
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    // Create example pages for Interactive Code skript
    const pythonEditorPage = await prisma.page.create({
      data: {
        title: 'Interactive Python Editor',
        slug: 'python-editor',
        skriptId: codeSkript.id,
        order: 0,
        isPublished: true,
        content: `# Interactive Python Editor

One of Eduskript's most powerful features is the ability to **run Python code directly in your browser**!

## How to Create an Interactive Editor

Add the \`editor\` keyword after your code block language:

\\\`\\\`\\\`python editor
# Write your Python code here
print("Hello, World!")
\\\`\\\`\\\`

## Try It Out!

Click the **Run** button to execute this code:

\`\`\`python editor
# Basic Python example
def greet(name):
    return f"Hello, {name}! Welcome to Eduskript!"

print(greet("Student"))
print("Python version: 3.x (Skulpt)")

# Try some calculations
result = 2 + 2
print(f"2 + 2 = {result}")
\`\`\`

## Math Examples

Python is great for mathematical computations:

\`\`\`python editor
import math

# Calculate circle properties
radius = 5
area = math.pi * radius**2
circumference = 2 * math.pi * radius

print(f"Circle with radius {radius}:")
print(f"  Area: {area:.2f}")
print(f"  Circumference: {circumference:.2f}")

# Fibonacci sequence
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(f"\\nFibonacci numbers:")
for i in range(10):
    print(f"F({i}) = {fibonacci(i)}")
\`\`\`

## Working with Lists

\`\`\`python editor
# List operations
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Filter even numbers
evens = [n for n in numbers if n % 2 == 0]
print(f"Even numbers: {evens}")

# Calculate sum and average
total = sum(numbers)
average = total / len(numbers)
print(f"\\nSum: {total}")
print(f"Average: {average}")

# Find squares
squares = [n**2 for n in numbers]
print(f"\\nSquares: {squares}")
\`\`\`

## Student Exercises

Try modifying the code above to:

1. Calculate the volume of a sphere: $V = \\frac{4}{3}\\pi r^3$
2. Generate the first 20 Fibonacci numbers
3. Filter odd numbers from the list
4. Calculate factorial of a number

**Tip:** Your code is automatically saved as you type! Try refreshing the page - your changes will still be there.
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const numpyMatplotlibPage = await prisma.page.create({
      data: {
        title: 'NumPy & Matplotlib',
        slug: 'numpy-matplotlib',
        skriptId: codeSkript.id,
        order: 1,
        isPublished: true,
        content: `# NumPy & Matplotlib - Data Science in Your Browser!

Eduskript supports **NumPy** for numerical computing and **Matplotlib** for data visualization - all running directly in your browser using Pyodide!

## NumPy Arrays

NumPy provides powerful array operations:

\`\`\`python editor
import numpy as np

# Create arrays
arr = np.array([1, 2, 3, 4, 5])
print("Array:", arr)
print("Mean:", np.mean(arr))
print("Standard deviation:", np.std(arr))

# 2D array operations
matrix = np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
print("\\nMatrix:")
print(matrix)
print("Sum of all elements:", np.sum(matrix))
print("Sum of each column:", np.sum(matrix, axis=0))
\`\`\`

## Linear Algebra

\`\`\`python editor
import numpy as np

# Matrix multiplication
A = np.array([[1, 2], [3, 4]])
B = np.array([[5, 6], [7, 8]])

print("Matrix A:")
print(A)
print("\\nMatrix B:")
print(B)

# Dot product
C = np.dot(A, B)
print("\\nA · B:")
print(C)

# Determinant
det = np.linalg.det(A)
print(f"\\nDeterminant of A: {det}")
\`\`\`

## Creating Visualizations with Matplotlib

Plot beautiful graphs directly in your pages:

\`\`\`python editor
import numpy as np
import matplotlib.pyplot as plt

# Generate data
x = np.linspace(0, 2*np.pi, 100)
y1 = np.sin(x)
y2 = np.cos(x)

# Create plot
plt.figure(figsize=(10, 6))
plt.plot(x, y1, label='sin(x)', linewidth=2)
plt.plot(x, y2, label='cos(x)', linewidth=2)
plt.xlabel('x')
plt.ylabel('y')
plt.title('Sine and Cosine Functions')
plt.legend()
plt.grid(True, alpha=0.3)
plt.show()

print("Graph generated successfully!")
\`\`\`

## Statistical Distributions

\`\`\`python editor
import numpy as np
import matplotlib.pyplot as plt

# Generate random data from different distributions
normal = np.random.normal(0, 1, 1000)
uniform = np.random.uniform(-3, 3, 1000)

# Create histogram
plt.figure(figsize=(12, 5))

plt.subplot(1, 2, 1)
plt.hist(normal, bins=30, edgecolor='black', alpha=0.7)
plt.title('Normal Distribution')
plt.xlabel('Value')
plt.ylabel('Frequency')

plt.subplot(1, 2, 2)
plt.hist(uniform, bins=30, edgecolor='black', alpha=0.7, color='orange')
plt.title('Uniform Distribution')
plt.xlabel('Value')
plt.ylabel('Frequency')

plt.tight_layout()
plt.show()

print(f"Normal distribution - Mean: {np.mean(normal):.2f}, Std: {np.std(normal):.2f}")
print(f"Uniform distribution - Mean: {np.mean(uniform):.2f}, Std: {np.std(uniform):.2f}")
\`\`\`

## Polynomial Fitting

\`\`\`python editor
import numpy as np
import matplotlib.pyplot as plt

# Generate sample data with noise
x = np.linspace(0, 10, 50)
y = 2*x**2 + 3*x + 1 + np.random.normal(0, 10, 50)

# Fit polynomial
coefficients = np.polyfit(x, y, 2)
polynomial = np.poly1d(coefficients)

# Generate smooth curve for plotting
x_smooth = np.linspace(0, 10, 200)
y_smooth = polynomial(x_smooth)

# Plot
plt.figure(figsize=(10, 6))
plt.scatter(x, y, alpha=0.5, label='Data points')
plt.plot(x_smooth, y_smooth, 'r-', linewidth=2, label='Fitted curve')
plt.xlabel('x')
plt.ylabel('y')
plt.title('Polynomial Fitting')
plt.legend()
plt.grid(True, alpha=0.3)
plt.show()

print(f"Fitted polynomial: y = {coefficients[0]:.2f}x² + {coefficients[1]:.2f}x + {coefficients[2]:.2f}")
\`\`\`

## Explore Further!

Try modifying the examples to:

1. Plot other functions like $\\tan(x)$ or $e^x$
2. Create a bar chart or scatter plot
3. Experiment with different distributions (exponential, binomial)
4. Fit polynomials of different degrees

**Note:** Matplotlib code may take a few seconds to run as it loads the plotting library. Be patient!
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    const javascriptEditorPage = await prisma.page.create({
      data: {
        title: 'Interactive JavaScript Editor',
        slug: 'javascript-editor',
        skriptId: codeSkript.id,
        order: 2,
        isPublished: true,
        content: `# Interactive JavaScript Editor

You can also run **JavaScript code** directly in your pages!

## Creating a JavaScript Editor

Use \`javascript editor\` to create an interactive JavaScript environment:

\\\`\\\`\\\`javascript editor
console.log("Hello from JavaScript!");
\\\`\\\`\\\`

## Try It Out!

\`\`\`javascript editor
// Basic JavaScript example
function greet(name) {
  return \`Hello, \${name}! Welcome to Eduskript!\`;
}

console.log(greet("Student"));
console.log("JavaScript is running in your browser!");

// Quick calculations
const result = 2 + 2;
console.log(\`2 + 2 = \${result}\`);
\`\`\`

## Working with Arrays

JavaScript has powerful array methods:

\`\`\`javascript editor
// Array operations
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Filter even numbers
const evens = numbers.filter(n => n % 2 === 0);
console.log("Even numbers:", evens);

// Map to squares
const squares = numbers.map(n => n ** 2);
console.log("Squares:", squares);

// Reduce to sum
const sum = numbers.reduce((acc, n) => acc + n, 0);
console.log("Sum:", sum);
console.log("Average:", sum / numbers.length);
\`\`\`

## Object-Oriented Programming

\`\`\`javascript editor
// Define a class
class Circle {
  constructor(radius) {
    this.radius = radius;
  }

  area() {
    return Math.PI * this.radius ** 2;
  }

  circumference() {
    return 2 * Math.PI * this.radius;
  }
}

// Create instances
const circle1 = new Circle(5);
const circle2 = new Circle(10);

console.log(\`Circle 1 (r=5):\`);
console.log(\`  Area: \${circle1.area().toFixed(2)}\`);
console.log(\`  Circumference: \${circle1.circumference().toFixed(2)}\`);

console.log(\`\\nCircle 2 (r=10):\`);
console.log(\`  Area: \${circle2.area().toFixed(2)}\`);
console.log(\`  Circumference: \${circle2.circumference().toFixed(2)}\`);
\`\`\`

## Modern JavaScript Features

\`\`\`javascript editor
// Arrow functions
const double = x => x * 2;
const triple = x => x * 3;

console.log("Doubling 5:", double(5));
console.log("Tripling 5:", triple(5));

// Destructuring
const person = { name: "Alice", age: 25, city: "Paris" };
const { name, age } = person;
console.log(\`\${name} is \${age} years old\`);

// Spread operator
const arr1 = [1, 2, 3];
const arr2 = [4, 5, 6];
const combined = [...arr1, ...arr2];
console.log("Combined:", combined);

// Template literals
const greeting = \`Hello, \${name}!\`;
console.log(greeting);
\`\`\`

## Challenge Exercises

Try these challenges:

1. Create a \`Rectangle\` class with width, height, area, and perimeter methods
2. Write a function to calculate factorial using recursion
3. Sort an array of numbers in descending order
4. Create a function that finds the largest number in an array

**Pro Tip:** Both Python and JavaScript editors support the **full screen mode** - click the expand icon for more space!
`,
        authors: {
          create: {
            userId: session!.user.id,
            permission: 'author',
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Example data seeded successfully',
      data: {
        collections: [
          { title: tutorialCollection.title, slug: tutorialCollection.slug },
        ],
        skripts: 3,
        pages: 7,
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
