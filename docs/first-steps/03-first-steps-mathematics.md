# First Steps: Mathematics

Formulas and function plots, answers graded with a tolerance, handwritten derivations checked by AI, GeoGebra applets, and calculations in Python. Try each one. The source is one click away under each example.

## Formula and graph together

$$f(x) = \frac{1}{3}x^3 - x$$

```plot
x: -4..4
y: -3..3
grid
f(x) = 1/3x^3 - x
A = (-1, 2/3), label="H"
B = (1, -2/3), label="L"
```

> [!code]- Show source
> ````markdown
> $$f(x) = \frac{1}{3}x^3 - x$$
>
> ```plot
> x: -4..4
> y: -3..3
> grid
> f(x) = 1/3x^3 - x
> A = (-1, 2/3), label="H"
> B = (1, -2/3), label="L"
> ```
> ````

Math is LaTeX, inline with `$...$` or on its own line with `$$...$$`. The plot is written the way you would write it on paper, and it renders as an image, so students can draw on it with a pen.

## An estimate, graded with a tolerance

Three attempts. A wrong check gives a hint, the answer stays hidden.

<question id="maximum" type="number" points="2" attempts="3" minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">
At which $x$ does $f(x) = \frac{1}{3}x^3 - x$ have its local maximum?
<answer from="1" feedback="Correct. $f'(x) = x^2 - 1 = 0$ gives $x = \pm 1$, and $f''(-1) < 0$."></answer>
<answer from="0.7" feedback="Close. Set $f'(x) = x^2 - 1$ to zero."></answer>
<answer feedback="Not yet. Differentiate first, then solve $f'(x) = 0$."></answer>
</question>

> [!code]- Show source
> ```html
> <question id="maximum" type="number" points="2" attempts="3" minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">
> At which $x$ does $f(x) = \frac{1}{3}x^3 - x$ have its local maximum?
> <answer from="1" feedback="Correct. $f'(x) = x^2 - 1 = 0$ gives $x = \pm 1$, and $f''(-1) < 0$."></answer>
> <answer from="0.7" feedback="Close. Set $f'(x) = x^2 - 1$ to zero."></answer>
> <answer feedback="Not yet. Differentiate first, then solve $f'(x) = 0$."></answer>
> </question>
> ```

The closer to `expected`, the higher the score. The `from` bands pick the feedback by distance. `attempts` is how often the student may press Check before the question locks; the default is one.

## Draw the tangent, checked by AI

Draw the tangent to $g(x) = x^2$ at $x = 1$ directly onto the graph with a pen, then press the button. The AI sees your drawing together with the exercise text.

```plot
x: -3..3
y: -1..5
grid
g(x) = x^2
P = (1, 1), label="P"
```

<ai-feedback label="Check my tangent" prompt="The student should draw the tangent to g(x) = x^2 at the point P = (1, 1). The correct tangent has slope 2 and passes through (1, 1) and (0, -1). Check whether the drawn line touches the parabola at P and has roughly the right slope. Do not reveal the equation of the tangent." />

> [!code]- Show source
> ````markdown
> ```plot
> x: -3..3
> y: -1..5
> grid
> g(x) = x^2
> P = (1, 1), label="P"
> ```
>
> <ai-feedback label="Check my tangent" prompt="The student should draw the tangent to g(x) = x^2 at P = (1, 1). Check whether the drawn line touches the parabola at P and has roughly slope 2. Do not reveal the equation." />
> ````

## A handwritten derivation, checked by AI

Solve $x^2 - 5x + 6 = 0$ by hand in the area below, then press the button.

<spacer id="quadratic-work" pattern="checkered" height="240" />

<ai-feedback label="Check my solution" prompt="The student solves x^2 - 5x + 6 = 0 by hand. The solutions are x = 2 and x = 3. Check each step. Point out the first error if there is one, without giving the solution away." />

> [!code]- Show source
> ```html
> <spacer pattern="checkered" height="240" />
>
> <ai-feedback label="Check my solution" prompt="The student solves x^2 - 5x + 6 = 0 by hand. The solutions are x = 2 and x = 3. Check each step. Point out the first error if there is one, without giving the solution away." />
> ```

The prompt is yours. Students never see it, only the feedback.

## GeoGebra

Public GeoGebra constructions embed directly. This one is by [Laura Hochreiter](https://www.geogebra.org/u/laura.hochreither).

<geogebra material-id="yTAzVxRG" />

> [!code]- Show source
> ```html
> <geogebra material-id="yTAzVxRG" />
> ```

The `material-id` is the code at the end of any geogebra.org share link. Add `correct-when="name"` with a boolean from your construction, and Eduskript records per student whether the construction is right.

## Calculations in Python

Numerical work that checks itself. Complete the function so it approximates $\int_0^1 x^2 \, dx$ with the midpoint rule, then press **Run** and **Check**.

```python editor id="midpoint"
def integral(f, a, b, n=1000):
    # midpoint rule: sum f(midpoint) * width over n strips
    pass

print(integral(lambda x: x**2, 0, 1))
```

```python-check for="midpoint" points="5"
assert abs(integral(lambda x: x**2, 0, 1) - 1/3) < 1e-3, "integral of x^2 from 0 to 1 should be about 0.333"
assert abs(integral(lambda x: x, 0, 2) - 2) < 1e-3, "integral of x from 0 to 2 should be about 2"
```

> [!code]- Show source
> ````markdown
> ```python editor id="midpoint"
> def integral(f, a, b, n=1000):
>     pass
> ```
>
> ```python-check for="midpoint" points="5"
> assert abs(integral(lambda x: x**2, 0, 1) - 1/3) < 1e-3, "integral of x^2 from 0 to 1 should be about 0.333"
> assert abs(integral(lambda x: x, 0, 2) - 2) < 1e-3, "integral of x from 0 to 2 should be about 2"
> ```
> ````

## Quiz questions with math

<question id="derivative-sin" type="single" points="1">
What is the derivative of $\sin(x)$?
<answer correct="true">$\cos(x)$</answer>
<answer feedback="That is the derivative of $\cos(x)$, up to sign.">$-\sin(x)$</answer>
<answer feedback="Differentiating, not integrating.">$-\cos(x)$</answer>
</question>

> [!code]- Show source
> ```html
> <question id="derivative-sin" type="single" points="1">
> What is the derivative of $\sin(x)$?
> <answer correct="true">$\cos(x)$</answer>
> <answer feedback="That is the derivative of $\cos(x)$, up to sign.">$-\sin(x)$</answer>
> <answer feedback="Differentiating, not integrating.">$-\cos(x)$</answer>
> </question>
> ```

One attempt by default: the student picks, presses Check, sees the result, and the question locks. On an exam page there is no Check button; answers are handed in with the exam and marked on return.

## Next

The full list of components is in the [Components overview](https://eduskript.org/en/components/overview). Or look at the other subjects: [Computer Science](https://eduskript.org/en/first-steps/first-steps-computer-science), [Chemistry](https://eduskript.org/en/first-steps/first-steps-chemistry).

<cta href="/auth/signup">Create free account</cta>
