# Quizzes and Tabs

Two more built-in components: `<question>` for multiple-choice quizzes, and `<tabs-container>` for grouped content with switchable views.

---

## Quizzes

A quiz is a `<question>` block with one or more `<answer>` children. Marking an answer as `correct` makes it the right answer.

### Single-choice (radio buttons)

```html
<question id="q-single-demo" type="single">
  <p>Which keyword defines a function in Python?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
  <answer>lambda</answer>
</question>
```

Renders as:

<question id="q-single-demo" type="single">
  <p>Which keyword defines a function in Python?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
  <answer>lambda</answer>
</question>

Students see a list with radio buttons; can pick one. Click **Check** to see if it's right.

### Multi-choice (checkboxes)

```html
<question id="q-multi-demo" type="multi">
  <p>Which of these are immutable in Python?</p>
  <answer correct>tuple</answer>
  <answer>list</answer>
  <answer correct>str</answer>
  <answer correct>frozenset</answer>
  <answer>dict</answer>
</question>
```

Renders as:

<question id="q-multi-demo" type="multi">
  <p>Which of these are immutable in Python?</p>
  <answer correct>tuple</answer>
  <answer>list</answer>
  <answer correct>str</answer>
  <answer correct>frozenset</answer>
  <answer>dict</answer>
</question>

Students must pick **all and only** the correct answers to be marked correct.

### Free-text answer

```html
<question id="q-text-demo" type="text">
  <p>What is the output of <code>print(2 ** 10)</code>?</p>
  <answer correct>1024</answer>
</question>
```

Renders as:

<question id="q-text-demo" type="text">
  <p>What is the output of <code>print(2 ** 10)</code>?</p>
  <answer correct>1024</answer>
</question>

Student types an answer; case-insensitive comparison against the `correct` answer(s). You can list multiple `<answer correct>` to accept variations:

```html
<question id="q-text-variants-demo" type="text">
  <p>What is the capital of Switzerland?</p>
  <answer correct>Bern</answer>
  <answer correct>Berne</answer>
</question>
```

Renders as:

<question id="q-text-variants-demo" type="text">
  <p>What is the capital of Switzerland?</p>
  <answer correct>Bern</answer>
  <answer correct>Berne</answer>
</question>

### Question attributes

| Attribute | Values | Effect |
|-----------|--------|--------|
| `id` | string | Unique ID per page; used to track student responses |
| `type` | `single` / `multi` / `text` | Question style |
| `points` | number (default 1) | Score weight |
| `feedback-correct` | string | Custom message shown on correct answer |
| `feedback-incorrect` | string | Custom message shown on incorrect answer |

```html
<question id="q-feedback-demo" type="single" points="2"
          feedback-correct="Genau! In Python ist `def` das Schlüsselwort."
          feedback-incorrect="Hinweis: Die Antwort beginnt mit dem Buchstaben d.">
  <p>Welches Schlüsselwort definiert eine Funktion in Python?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
</question>
```

Renders as:

<question id="q-feedback-demo" type="single" points="2"
          feedback-correct="Genau! In Python ist `def` das Schlüsselwort."
          feedback-incorrect="Hinweis: Die Antwort beginnt mit dem Buchstaben d.">
  <p>Welches Schlüsselwort definiert eine Funktion in Python?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
</question>

### What students see

- Question text + answer choices
- **Check** button to submit
- ✓ green or ✗ red feedback after submitting
- Custom feedback message (if set)
- Score for that question

Their answer is saved per-student-per-page; coming back later shows their previous response.

---

## Tabs

Tabbed containers group related content with switchable views. Useful for: language alternatives, OS-specific instructions, beginner/advanced versions of the same content, before/after comparisons.

### Basic syntax

````html
<tabs-container>
  <tab-item label="Python">
    Standard Python solution.

    ```python
    print("Hello")
    ```
  </tab-item>

  <tab-item label="JavaScript">
    JavaScript equivalent.

    ```javascript
    console.log("Hello")
    ```
  </tab-item>

  <tab-item label="Rust">
    Rust version (compiled).

    ```rust
    println!("Hello");
    ```
  </tab-item>
</tabs-container>
````

Renders as:

<tabs-container>
  <tab-item label="Python">

Standard Python solution.

```python
print("Hello")
```

  </tab-item>
  <tab-item label="JavaScript">

JavaScript equivalent.

```javascript
console.log("Hello")
```

  </tab-item>
  <tab-item label="Rust">

Rust version (compiled).

```rust
println!("Hello");
```

  </tab-item>
</tabs-container>

Students see a tab bar at the top with the three labels; clicking switches between them.

### Tabs can hold any content

Markdown, code blocks, code editors, callouts, images, math — anything that works in the body of a page works inside a `<tab-item>`.

````html
<tabs-container>
  <tab-item label="Description">
    The Pythagorean theorem states that for a right triangle:
    $a^2 + b^2 = c^2$
  </tab-item>

  <tab-item label="Try it">
    ```python editor id="pythagoras"
    a, b = 3, 4
    c = (a**2 + b**2) ** 0.5
    print(f"c = {c}")
    ```
  </tab-item>

  <tab-item label="Proof">
    > [!example] Geometric proof
    > Take four right triangles with legs $a$ and $b$ ...
  </tab-item>
</tabs-container>
````

### Default open tab

Add `default` to one tab to make it open initially (otherwise the first tab is open by default):

```html
<tabs-container>
  <tab-item label="macOS">macOS instructions</tab-item>
  <tab-item label="Windows" default>Windows instructions</tab-item>
  <tab-item label="Linux">Linux instructions</tab-item>
</tabs-container>
```

### Tabs cheat sheet

| Goal | Syntax |
|------|--------|
| Tabbed container | `<tabs-container>...</tabs-container>` |
| Individual tab | `<tab-item label="Label">content</tab-item>` |
| Default open tab | `<tab-item label="..." default>` |
| Embed a code editor in a tab | Standard ` ```python editor ` inside the `<tab-item>` |

---

## When to use which

| Situation | Use |
|-----------|-----|
| Test a student's recall of a fact | `<question type="single">` or `type="text">` |
| Test programming behavior | `python editor` + `python-check` (auto-grading chapter) |
| Show the same content in multiple flavors | `<tabs-container>` |
| Hide hint until clicked | Collapsed callout (`> [!tip]-`) |
| Hide a long solution | Collapsed callout with code block |

For self-grading code exercises, `python-check` is much more powerful than `<question>`. For factual recall and discrete-answer questions, `<question>` is faster to write.
