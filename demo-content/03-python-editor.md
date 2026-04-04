# Python Editor

Students run Python directly in the browser — no installation, no server, no configuration. It works on every device.

---

## Try It

Click **Run** to execute this code:

```python editor
# Calculate basic statistics
data = [4, 8, 15, 16, 23, 42]

mean = sum(data) / len(data)
variance = sum((x - mean) ** 2 for x in data) / len(data)
std_dev = variance ** 0.5

print(f"Data:     {data}")
print(f"Mean:     {mean:.2f}")
print(f"Variance: {variance:.2f}")
print(f"Std Dev:  {std_dev:.2f}")
```

## Interactive Input

Python's `input()` works too — students get a prompt in the console:

```python editor
name = input("What is your name? ")
age = int(input("How old are you? "))

print(f"Hello {name}!")
print(f"In 10 years you'll be {age + 10}.")
```

## Turtle Graphics

Draw with Python's turtle module — great for teaching loops and geometry:

```python editor
import turtle

t = turtle.Turtle()
t.speed(0)

for i in range(36):
    t.forward(100)
    t.right(170)
```

> [!info] How It Works
> Python runs via Pyodide (Python compiled to WebAssembly). Students' code is automatically saved. JavaScript and SQL editors are also available.
