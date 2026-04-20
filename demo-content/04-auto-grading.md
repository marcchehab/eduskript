# Auto-Graded Exercises

Pair any code editor with a `python-check` block, and the page grades itself. Students click **Check**; the runner executes their code, runs your assertions, and shows what passed and what didn't — with the hints *you* wrote, in the language *you* wrote them.

No grading queue. No "I'll get to it next week." Students get feedback the moment they're ready for it.

---

## A first example

Here's a small open challenge — there are many valid solutions. Write your code, click **Check**:

```python editor id="weather"
def advise(temperature, raining):
    # Return a string that contains the right keyword for the weather.
    return ""

print(advise(30, False))
print(advise(15, True))
print(advise(15, False))
```

```python-check for="weather"
assert "umbrella" in advise(10, True).lower(), "On cold rainy weather (10°, raining), the advice should mention 'umbrella'.|Nice — you suggest an umbrella when it rains."
assert "sunscreen" in advise(30, False).lower(), "On warm sunny weather (30°, not raining), the advice should mention 'sunscreen'."
assert "jacket" in advise(15, False).lower(), "On cool dry weather (15°, not raining), the advice should mention 'jacket'."
assert "umbrella" in advise(28, True).lower(), "Even on warm rain (28°, raining), the advice should still mention 'umbrella' — rain beats sunshine.|Top — you handled the warm-rain edge case where rain wins over temperature."
```

Edit the page to see how it works.

---

## Anatomy of a `python-check`

```markdown
` ```python editor id="my-exercise" `
def my_function(x):
    # student's code
    pass
` ``` `

` ```python-check for="my-exercise" `
assert my_function(5) == 25, "my_function(5) should return 25."
assert my_function(0) == 0, "my_function(0) should return 0."
` ``` `
```

- The editor MUST have an `id`. The check block references it via `for="<id>"`.
- The check block is **never rendered** — it's invisible to students. Only the pass/fail results show up.
- Each `assert` becomes one test. The string after the comma is the **failure message** — the test name students see.

---

## Pass *and* fail messages

A single message works for the failure case. To celebrate a passing test too, use a pipe (`|`) to split fail and pass:

```python
assert fn(5) == 25, "fn(5) should return 25.|Nice — fn(5) = 25!"
```

Students see "fn(5) should return 25." while it's failing, and "Nice — fn(5) = 25!" once it passes. Use this for the harder problems where a little encouragement lands. For trivial checks, leave the pass message off — every test getting a "🎉" feels noisy.

> [!tip] Hints in the failure message
> The failure message is the only thing students see when they're stuck. Make it useful: don't just say "wrong" — say *what's wrong* and *what to try*. ` "Welche Operator verbindet zwei Bedingungen mit 'sowohl-als-auch'?" ` is a much better hint than ` "wrong" `.

---

## Behavior tests, not implementation tests

For open challenges with multiple valid solutions, test what the function *produces* — not how it's structured.

✅ **Behavior test:** `assert "umbrella" in advise(10, True).lower(), ...`

❌ **Implementation test:** `assert "if raining:" in inspect.getsource(advise), ...`

The first lets every student find their own way. The second penalizes anyone who solves it differently than you imagined.

---

## What NOT to do

- ❌ **Don't add preflight checks that pass on stub code**, like `assert "fn_name" in globals()` or `assert result is not None`. These pass *before the student does anything*, inflating the score from 0% to ~30% and giving false reassurance. If the student's function is missing, the runner already surfaces a clear error on every test that uses it — that's enough.
- ❌ **Don't repeat the same code path with different inputs.** Three asserts that all hit the same branch waste your score signal. Pick inputs that cover *different* paths (boundaries, edge cases, the obvious main case).
- ❌ **Don't write tests that depend on print output** unless you really mean it. Test return values when you can — they're more robust to formatting differences.

---

## Optional attributes

```python-check for="my-exercise" points="10" max-checks="5"
```

- `points="10"` — score weight for this exercise (used in the gradebook)
- `max-checks="5"` — limit how many times a student can run Check (useful in exam contexts)

---

## Auto-grading cheat sheet

| Goal | Syntax |
|------|--------|
| Pair an exercise with auto-grading | Editor with `id="x"`, then ` ```python-check for="x" ` |
| Plain message (used for both pass and fail) | `assert ok, "Single message."` |
| Different pass and fail messages | `assert ok, "Failure hint.\|Success cheer!"` |
| Helpful hint with specific guidance | `assert fn(0) == 1, "fn(0) should return 1 — empty input means 'one way to do nothing'."` |

Ready for SQL exercises? **SQL Studio** is the next page.
