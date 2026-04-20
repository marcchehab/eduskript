# Welcome to Eduskript

You write markdown. Your students get a beautiful, interactive lesson — math that renders, code they can run, exercises that grade themselves, diagrams that adapt to dark mode.

No slide deck. No PDF. No "please install Python first." Just a URL.

> [!tip] This is itself an Eduskript page
> Everything you see on these tour pages is written in the same markdown you're about to learn. Click **Edit** in any page to peek behind the curtain.

---

## The 60-second tour

**Math, typeset properly.** Inline like $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$, or full block:

$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$

**Callouts that frame your content.**

> [!success] Learning goals
> Set them at the top of every lesson. Students know what they're signing up for.

> [!question]- Think about it
> What is $\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n$?
>
> It's $e \approx 2.71828$. Click the heading to collapse again.

**Code that runs in the browser.** Click Run:

```python editor
import math
for n in [1, 10, 100, 1000, 100000]:
    print(f"n={n:>6}  →  (1 + 1/n)^n = {(1 + 1/n)**n:.6f}")
print(f"\ne = {math.e:.6f}")
```

**Themed colors that work in both light and dark mode.**

$$\textcolor{cyan}{\text{plaintext}}^{\textcolor{lightgreen}{k_{pub}}} \mod n = \textcolor{orange}{\text{ciphertext}}$$

---

## What else is in this tour

Each page is independent — pick what interests you:

- **Diagrams & images** — Excalidraw sketches that swap with dark mode
- **Live code** — Python, JavaScript, SQL right in the page
- **Auto-graded exercises** — write a few `assert`s, the page grades itself
- **SQL Studio** — upload a `.db`, students query it in the browser
- **Custom plugins** — build any interactive widget you can imagine
- **Annotations & broadcasting** — shared whiteboard for the whole class
- **Video** — Mux-hosted, no YouTube tax
- **AI co-pilot** — an assistant that knows your skript inside and out
- **Exams & classes** — real digital exams with Safe Exam Browser lockdown

The full user manual is at [the docs site](/) — this is the whirlwind tour.
