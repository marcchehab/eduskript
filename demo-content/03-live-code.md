# Live Code in the Browser

Code editors that actually **run**. No "install Python first" instructions, no servers to wake up, no laptops that can't keep up. Python and JavaScript both run client-side in 2 seconds, on every device a student owns — including their phone.

---

## Python that just works

Click **Run** on the editor below:

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

Python runs via [Pyodide](https://pyodide.org) — a real CPython compiled to WebAssembly. It supports the standard library and a growing list of scientific packages (NumPy, Pandas, Matplotlib, scikit-learn). The first run loads the Python runtime (~5 seconds, cached after that); subsequent runs are instant.

### Interactive `input()`

Python's `input()` works too — students get a prompt right above the output:

```python editor
name = input("What is your name? ")
age = int(input("How old are you? "))

print(f"Hello {name}!")
print(f"In 10 years you'll be {age + 10}.")
```

### Turtle graphics

The classic teaching tool. Great for loops, geometry, and "I made a thing" moments:

```python editor
import turtle

t = turtle.Turtle()
t.speed(0)

for i in range(36):
    t.forward(100)
    t.right(170)
```

---

## JavaScript editors

Same idea, different language:

```javascript editor
// FizzBuzz, the classic
for (let i = 1; i <= 15; i++) {
  if (i % 15 === 0) console.log("FizzBuzz")
  else if (i % 3 === 0) console.log("Fizz")
  else if (i % 5 === 0) console.log("Buzz")
  else console.log(i)
}
```

Useful for teaching the web side of things, or as a comparison alongside Python in algorithms courses.

---

## Multi-file editors

For anything more complex than a one-file script, use the multi-file pattern: two consecutive code blocks with the same `id`. Each block becomes a tab in the editor.

```python editor id="rectangle" file="main.py"
from shapes import area, perimeter

w, h = 4, 7
print("Area:", area(w, h))
print("Perimeter:", perimeter(w, h))
```

```python editor id="rectangle" file="shapes.py"
def area(width, height):
    return width * height

def perimeter(width, height):
    return 2 * (width + height)
```

The blocks must be **consecutive** in the markdown source (anything between them other than another block with the same id breaks the grouping). The `file=` attribute names each tab; if you omit it, the first becomes `main.py` and the rest become `file2.py`, `file3.py`, etc.

This works for Python, JavaScript, and SQL.

---

## Per-student persistence

Every code editor automatically saves what each student types — keyed to their account and the editor's `id`. When they come back tomorrow, their work is right there. Reset is one click away if they want to start from your original.

> [!tip] Stable IDs matter
> If you don't pass an `id`, the editor gets a generated one based on its position in the page. **Edit the page later and the student's work might end up associated with a different editor.** For anything you expect students to come back to, set an explicit `id="something-stable"`.

---

## Code editor cheat sheet

| Goal | Syntax |
|------|--------|
| Standalone Python editor | ` ```python editor ` |
| Standalone JavaScript editor | ` ```javascript editor ` |
| Persistent editor (recommended) | ` ```python editor id="my-stable-id" ` |
| Multi-file editor (multiple blocks, same id) | ` ```python editor id="x" file="main.py" ` |
| Hide the file tabs (single-file mode) | ` ```python editor single ` |

Ready to make exercises that grade themselves? **Auto-graded exercises** is the next page.
