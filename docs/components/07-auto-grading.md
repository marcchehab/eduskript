# Auto-Graded Exercises

Pair any code editor with a `python-check` block, and the page grades itself. Students click **Check**; the runner executes their code, runs your assertions, and shows what passed and what didn't — with the hints *you* wrote, in the language *you* wrote them.

No grading queue. No "I'll get to it next week." Students get feedback the moment they're ready for it.

---

## A first example

Pair an editor with a check block. The editor needs an `id`; the check block references it via `for=`.

````markdown
```python editor id="square-it"
def square(x):
    return x  # student fills this in
```

```python-check for="square-it"
assert square(5) == 25, "square(5) should return 25.|Nice — square(5) = 25!"
assert square(0) == 0, "square(0) should return 0."
assert square(-3) == 9, "square(-3) should return 9 (negatives squared are positive)."
```
````

Students see the editor and a **Check** button. Clicking Check:

1. Runs the student's code (defining `square`)
2. Executes each `assert` in turn
3. Shows a pass/fail panel with each assertion's result and message

The `python-check` block itself is **never rendered** to students — they only see the editor and the results.

---

## Anatomy of a `python-check`

Each line is a Python `assert` statement:

```python
assert <expression>, "<message>"
```

- The **expression** is evaluated. If truthy, the test passes; if falsy or it raises, the test fails.
- The **message** is what students see for that test (more on this below).

You can have any Python code in between asserts — set up variables, call helper functions, whatever. Just remember each `assert` is a separate test.

```python-check for="my-exercise"
# Setup
result_5 = my_function(5)
result_0 = my_function(0)

# Tests
assert result_5 == 25, "my_function(5) should return 25."
assert result_0 == 0, "my_function(0) should return 0."

# A more complex check
import math
assert math.isclose(my_function(0.5), 0.25), "my_function(0.5) should return 0.25."
```

---

## Pass and fail messages — the pipe syntax

A single message string works as the test's name in both pass and fail cases:

```python
assert fn(5) == 25, "fn(5) should return 25."
```

To show **different messages for pass and fail**, separate them with `|`:

```python
assert fn(5) == 25, "fn(5) should return 25.|Nice — fn(5) = 25!"
#                    └─── shown on fail ──┘└── shown on pass ──┘
```

Students see "fn(5) should return 25." while it's failing, and "Nice — fn(5) = 25!" once it passes. Use this for the harder problems where a little encouragement lands. For trivial checks, leave the pass message off — every test getting a 🎉 feels noisy fast.

> [!tip] f-strings work too
> ` `assert ok, f"Got {actual}, expected {expected}.|Top, you got {actual}!"` `
> The interpolations are stripped from the displayed test name (replaced with `…`), but the rendered message is shown in the error detail when the test fails.

---

## Behavior tests, not implementation tests

For open challenges with multiple valid solutions, test what the function *produces* — not how it's structured.

✅ **Behavior test:**
```python
assert "umbrella" in advise(10, True).lower(), "Should mention umbrella when raining."
```

❌ **Implementation test:**
```python
import inspect
assert "if raining:" in inspect.getsource(advise), "Should use an if statement on raining."
```

The first lets every student find their own way. The second penalizes anyone who solves it differently than you imagined.

---

## What NOT to do

> [!failure] Anti-patterns
> - **Don't add preflight checks that pass on stub code**, like `assert "fn_name" in globals()` or `assert result is not None`. These pass *before the student does anything*, inflating the score from 0% to ~30% and giving false reassurance. If the student's function is missing, the runner already surfaces a clear error on every test that uses it — that's enough.
> - **Don't repeat the same code path with different inputs.** Three asserts that all hit the same branch waste your score signal. Pick inputs that cover *different* paths (boundaries, edge cases, the obvious main case).
> - **Don't write tests that depend on print output** unless you really mean it. Test return values when you can — they're more robust to formatting differences.
> - **Don't write a hint that says only "wrong"** — give specific, actionable guidance. The failure message is the only thing students see when stuck.

---

## Optional attributes

```python-check for="my-exercise" points="10" max-checks="5"
```

| Attribute | Effect |
|-----------|--------|
| `for="<editor-id>"` | Links the check to a specific editor (required) |
| `points="N"` | Score weight for the gradebook (default: 1 per test) |
| `max-checks="N"` | Cap how many times a student can run Check (useful for exams — prevents brute-force) |

---

## The grading flow for students

1. Student writes code in the editor
2. Clicks **Check** (next to Run)
3. Sees a panel with each test as a row:
   - ✅ green if passed (with the pass message, if you wrote one)
   - ❌ red if failed (with the fail message + error trace)
4. Score shown as `passed/total` (e.g. `3/5`)
5. Student fixes their code, clicks Check again

The `python-check` panel persists between sessions — students see their last result when they come back to the page.

---

## What you can see as the teacher

For students who are signed in to a class:

- **Submissions interface** (`Dashboard → Classes → Submissions`) — see each student's latest score and code
- **Per-student detail** — view their code in the same editor they used, run it yourself
- **Numeric overrides** — record a manual grade to override the auto-graded score
- **Comments** — leave rich-text feedback per submission, or per code block

Auto-graded `python-check` results show alongside your manual grading, so you can spot at a glance who passed all checks vs who needs a closer look.

---

## Auto-grading cheat sheet

| Goal | Syntax |
|------|--------|
| Pair an exercise with auto-grading | Editor with `id="x"`, then ` ```python-check for="x" ` |
| Plain message (used for both pass and fail) | `assert ok, "Single message."` |
| Different pass and fail messages | `assert ok, "Failure hint.\|Success cheer!"` |
| With f-string interpolation | `assert ok, f"Got {x} — expected {y}."` |
| Score weighting | `python-check for="x" points="10"` |
| Limit attempts (exam contexts) | `python-check for="x" max-checks="5"` |
