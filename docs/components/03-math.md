# Math

Write mathematical notation using LaTeX syntax, rendered with KaTeX.

## Inline Math

Wrap with single dollar signs:

```markdown
The area of a circle is $A = \pi r^2$.
```

The area of a circle is $A = \pi r^2$.

## Block Math

Wrap with double dollar signs:

```markdown
$$
E = mc^2
$$
```

$$
E = mc^2
$$

## Common Syntax

### Fractions
```latex
$\frac{a}{b}$         →  a/b
$\frac{x+1}{x-1}$     →  (x+1)/(x-1)
```

### Exponents and Subscripts
```latex
$x^2$                 →  x squared
$x_i$                 →  x subscript i
$x_i^2$               →  both
```

### Square Roots
```latex
$\sqrt{x}$            →  square root
$\sqrt[3]{x}$         →  cube root
```

### Greek Letters
```latex
$\alpha, \beta, \gamma, \delta$
$\pi, \sigma, \theta, \omega$
```

### Sums and Integrals
```latex
$\sum_{i=1}^{n} x_i$
$\int_0^1 x^2 dx$
$\prod_{i=1}^{n} x_i$
```

### Matrices
```latex
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$
```

### Aligned Equations
```latex
$$
\begin{aligned}
x + y &= 10 \\
x - y &= 4
\end{aligned}
$$
```

## Tips

- Preview as you type — errors show immediately
- Use `\text{word}` for words inside math: $P(\text{heads}) = 0.5$
- Escape special characters with backslash
- KaTeX is fast but doesn't support every LaTeX package
