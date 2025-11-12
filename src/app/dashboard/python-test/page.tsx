import { CodeEditor } from '@/components/public/code-editor'

const turtleExample = `import turtle
import sys

print("🐢 Running with Skulpt (turtle graphics)")
print(f"Python version: {sys.version}")

# Create a turtle
t = turtle.Turtle()

# Draw a square
for i in range(4):
    t.forward(100)
    t.right(90)

print("Square drawn!")
`

const matplotlibExample = `import sys
import matplotlib.pyplot as plt
import numpy as np

print("🚀 Running with Pyodide (full Python + scientific stack)")
print(f"Python version: {sys.version}")
print(f"NumPy version: {np.__version__}")
print(f"Matplotlib version: {plt.matplotlib.__version__}")
print()

# Create some data
x = np.linspace(0, 10, 100)
y1 = np.sin(x)
y2 = np.cos(x)

# Create a figure with two subplots
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))

# Plot sine wave
ax1.plot(x, y1, 'b-', label='sin(x)')
ax1.set_title('Sine Wave')
ax1.set_xlabel('x')
ax1.set_ylabel('y')
ax1.grid(True)
ax1.legend()

# Plot cosine wave
ax2.plot(x, y2, 'r-', label='cos(x)')
ax2.set_title('Cosine Wave')
ax2.set_xlabel('x')
ax2.set_ylabel('y')
ax2.grid(True)
ax2.legend()

plt.tight_layout()
plt.show()

print("✓ Plot generated!")
`

export default function PythonTestPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Python Editor Test</h1>

      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-3">Example 1: Turtle Graphics</h2>
          <CodeEditor
            id="turtle-example"
            language="python"
            initialCode={turtleExample}
            showCanvas={true}
          />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Example 2: Simple Python</h2>
          <CodeEditor
            id="simple-example"
            language="python"
            initialCode={`import sys

print("🚀 Running with Pyodide (full Python)")
print(f"Python version: {sys.version}")
print()

# Simple Python example
for i in range(10):
    print(f"Count: {i}")

print("Done!")
`}
            showCanvas={false}
          />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Example 3: Matplotlib Plots</h2>
          <CodeEditor
            id="matplotlib-example"
            language="python"
            initialCode={matplotlibExample}
            showCanvas={false}
          />
        </section>
      </div>
    </div>
  )
}
