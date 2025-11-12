import { MarkdownRenderer } from '@/components/markdown/markdown-renderer'

const testMarkdown = `# CodeMirror Static Code Block Test

## JavaScript with additions

\`\`\`javascript
function hello() {
  console.log("Hello World") // [!code ++]
  console.log("New feature") // [!code ++]
  return true
}
\`\`\`

## Python with comment before marker

\`\`\`python
print("🐢 Running with Skulpt (turtle graphics)") # hallo [!code highlight]
print("Another line") # world [!code ++]
print("Old line") # test [!code --]
print(sys.version) # [!code highlight]
\`\`\`

## Python with removals

\`\`\`python
def calculate(x, y):
    result = x + y
    print("Debug:", result) # [!code --]
    return result
\`\`\`

## TypeScript with highlights

\`\`\`typescript
interface User {
  name: string
  email: string // [!code highlight]
  age: number // [!code highlight]
}
\`\`\`

## Rust with focus

\`\`\`rust
fn main() {
    let x = 5;
    let y = 10; // [!code focus]
    let sum = x + y; // [!code focus]
    println!("Sum: {}", sum);
}
\`\`\`

## Mixed annotations

\`\`\`go
package main

import "fmt"

func main() {
    // Old implementation
    value := 10 // [!code --]

    // New implementation
    value := 20 // [!code ++]

    // Important calculation
    result := value * 2 // [!code highlight]

    fmt.Println(result)
}
\`\`\`

## Plain JavaScript (no annotations)

\`\`\`javascript
const numbers = [1, 2, 3, 4, 5]
const doubled = numbers.map(n => n * 2)
console.log(doubled)
\`\`\`

## HTML

\`\`\`html
<!DOCTYPE html>
<html>
<head>
    <title>Test</title> <!-- [!code highlight] -->
</head>
<body>
    <h1>Hello World</h1>
</body>
</html>
\`\`\`

## CSS

\`\`\`css
.container {
  display: flex;
  justify-content: center; /* [!code highlight] */
  align-items: center;
}
\`\`\`

## SQL

\`\`\`sql
SELECT * FROM users
WHERE age > 18 -- [!code highlight]
ORDER BY name;
\`\`\`
`

export default function CodeMirrorTestPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="prose dark:prose-invert max-w-none">
        <MarkdownRenderer content={testMarkdown} />
      </div>
    </div>
  )
}
