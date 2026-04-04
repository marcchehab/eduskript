# Your First Page

Welcome to **Eduskript** — write your lessons in Markdown, and your students get a beautiful, interactive experience. One document per lesson, no clicking through slides.

---

> [!success]- Learning Goals
> - Format text with **bold**, *italic*, and `inline code`
> - Write math with LaTeX
> - Use callouts to structure your lessons

## Text Formatting

| Syntax | Result |
|--------|--------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `***both***` | ***both*** |
| `` `code` `` | `code` |
| `~~strikethrough~~` | ~~strikethrough~~ |

## Math with LaTeX

Inline math with single dollar signs: The quadratic formula $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ renders right in the text.

Display math with double dollar signs:

$$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}$$

## Callouts

Callouts highlight important information. Add `-` to make them foldable (great for solutions!):

> [!tip] Pro Tip
> You can use `> [!type]- Title` to make any callout **collapsed by default** — perfect for hiding hints and solutions.

> [!warning] Common Mistake
> Don't forget the space after `>` in each line of a callout.

> [!question]- Think About It
> What is $\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n$?
>
> It's Euler's number $e \approx 2.71828...$

> [!info] Callout Types
> `note`, `tip`, `warning`, `success`, `info`, `question`, `example`, `quote`, `danger`, `abstract`, and more. German aliases like `lernziele` and `hinweis` also work.
