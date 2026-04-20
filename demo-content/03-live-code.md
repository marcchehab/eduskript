# Live Code in the Browser

Code editors that actually **run**. Python via Pyodide, JavaScript sandboxed in the browser, SQL via SQLite-on-WASM — all client-side, on every device, including phones.

---

## Python

```python editor
data = [4, 8, 15, 16, 23, 42]

mean = sum(data) / len(data)
variance = sum((x - mean) ** 2 for x in data) / len(data)
std_dev = variance ** 0.5

print(f"Mean:     {mean:.2f}")
print(f"Std Dev:  {std_dev:.2f}")
```

Full standard library, plus NumPy, Pandas, Matplotlib, scikit-learn, SymPy. First run loads Pyodide (~5s, cached after that); subsequent runs are instant.

### Interactive `input()`

```python editor
name = input("What is your name? ")
print(f"Hello, {name}!")
```

### Turtle graphics

```python editor
import turtle
t = turtle.Turtle()
t.speed(0)
for i in range(36):
    t.forward(100)
    t.right(170)
```

---

## JavaScript

```javascript editor
for (let i = 1; i <= 15; i++) {
  if (i % 15 === 0) console.log("FizzBuzz")
  else if (i % 3 === 0) console.log("Fizz")
  else if (i % 5 === 0) console.log("Buzz")
  else console.log(i)
}
```

---

## Multi-file editors

Two consecutive blocks with the same `id` → two tabs in one editor:

```python editor id="shapes-demo" file="main.py"
from shapes import area, perimeter
print("Area:", area(4, 7))
print("Perimeter:", perimeter(4, 7))
```

```python editor id="shapes-demo" file="shapes.py"
def area(w, h):
    return w * h

def perimeter(w, h):
    return 2 * (w + h)
```

Works for Python, JavaScript, and SQL.

---

## Per-student persistence

Every editor saves what each student types — automatically, per account, per `id`. Use stable IDs (`id="my-exercise"`) so student work follows the exercise through page edits.

Ready to grade exercises automatically? The next page is **Auto-graded exercises**.
