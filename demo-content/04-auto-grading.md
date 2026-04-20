# Auto-Graded Exercises

Pair any code editor with a `python-check` block — the page grades itself.

No grading queue. Students get feedback the moment they're ready for it.

---

## Try it

Write code that advises on the weather. Click **Check**:

```python editor id="weather"
def advise(temperature, raining):
    return ""
```

```python-check for="weather"
assert "umbrella" in advise(10, True).lower(), "At 10° in rain, mention 'umbrella'.|Nice — umbrella for cold rain."
assert "sunscreen" in advise(30, False).lower(), "At 30° and sunny, mention 'sunscreen'."
assert "jacket" in advise(15, False).lower(), "At 15° and dry, mention 'jacket'."
assert "umbrella" in advise(28, True).lower(), "Warm rain still needs an umbrella.|Top — rain beats sunshine."
```

Click **Edit** on this page to see the source.

---

## Anatomy

````markdown
```python editor id="my-exercise"
def square(x):
    pass
```

```python-check for="my-exercise"
assert square(5) == 25, "square(5) should return 25."
assert square(-3) == 9, "Negatives squared are positive."
```
````

- Editor needs an `id`; check block references it via `for=`.
- Each `assert` is one test. Message after the comma is the test name.
- The check block is **never rendered** to students — only the results.

---

## Different messages for pass and fail

Pipe-split: **fail on the left, pass on the right.**

```python
assert fn(5) == 25, "fn(5) should return 25.|Nice — fn(5) = 25!"
```

Students see the hint while it's failing, the cheer once it passes. Drop the pass message for trivial checks — every "🎉" gets noisy fast.

---

## Good tests vs bad tests

✅ **Behavior:** `assert "umbrella" in advise(10, True).lower()`

❌ **Implementation:** `assert "if raining:" in inspect.getsource(advise)` (penalizes students who solve it differently)

❌ **Preflight that passes on stub code:** `assert "fn" in globals()` (inflates the score from 0% before they've done anything)

---

## Options

```markdown
` ```python-check for="x" points="10" max-checks="3" ` 
```

`points` weights the score. `max-checks` caps attempts — useful in exams.

Next up: **SQL Studio**.
