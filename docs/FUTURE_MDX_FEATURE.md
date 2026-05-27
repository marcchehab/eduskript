# Future Feature: MDX Mode (Opt-in)

## Background

Eduskript previously used MDX for content rendering, which allowed JavaScript expressions and imports directly in markdown. This was removed due to security concerns - MDX allows arbitrary JavaScript execution, making it unsuitable for user-generated content.

The current pipeline uses a safe remark/rehype approach that:
- Parses markdown and raw HTML
- Sanitizes content to block XSS vectors
- Maps HTML elements to React components
- **Does not execute any JavaScript from content**

## Proposed Feature: MDX as Opt-in

For trusted organizations (schools with verified teachers), MDX could be re-enabled as an opt-in feature.

### Use Cases

1. **Advanced interactivity**: Teachers writing custom React components inline
2. **Dynamic content**: Computed values, conditional rendering
3. **Complex widgets**: Components that need JavaScript logic

### Security Model

```
┌─────────────────────────────────────────────────────────────┐
│  Organization Settings                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Content Pipeline                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ● Safe Mode (Default)                               │   │
│  │   Standard markdown with sanitized HTML.            │   │
│  │   No code execution - safe for all content.         │   │
│  │                                                     │   │
│  │ ○ MDX Mode (Advanced)                               │   │
│  │   Full MDX with JavaScript expressions.             │   │
│  │   ⚠️ Only enable if you trust ALL content authors.  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Requirements for Implementation

1. **Database field**: `Organization.contentPipeline` enum (SAFE, MDX)
2. **Dual pipeline**: Both `compileMarkdown()` and `compileMDX()` available
3. **Pipeline selector**: Check org setting when rendering content
4. **Warning modal**: Clear security warning when enabling MDX
5. **Audit logging**: Track who enables/disables MDX mode

### Security Warnings

When MDX is enabled:
- Authors can execute arbitrary JavaScript in viewers' browsers
- Authors can access cookies, session tokens, localStorage
- Authors can make network requests as the viewer
- Compromised author accounts become full XSS vectors

### Syntax Comparison

**Safe mode (current):**
```markdown
<question id="q1" type="multiple" showfeedback="true">
  What is 2+2?
  <answer correct="true">4</answer>
  <answer>5</answer>
</question>
```

**MDX mode (future):**
```mdx
<Question id="q1" type="multiple" showFeedback={true}>
  What is 2+2?
  <Option correct>4</Option>
  <Option>5</Option>
</Question>

{/* Dynamic content possible */}
{Math.random() > 0.5 ? <Hint /> : null}
```

### Implementation Priority

**Low priority** - The safe pipeline covers most use cases. MDX should only be considered if there's strong demand from trusted institutions with specific advanced needs.

### Alternative Approaches

Before implementing MDX, consider these safer alternatives:

1. **More built-in components**: Add commonly-requested features as first-class components
2. **Sandboxed plugins**: Per-org plugin choice via iframe sandboxing
3. **Declarative templates**: Config-based component customization without code execution

### "MDX grammar, never evaluate" (the safe way to get MDX's robustness)

The MDX security hole is **evaluation** (`@mdx-js/mdx` `compile()` → `run()` → JS), not the JSX
*syntax*. So a genuinely safe path to MDX-grade robustness exists: use the MDX **parser only**
(`micromark-extension-mdxjs` + `mdast-util-mdx-jsx`, already present transitively via
`rehype-react`) to parse `<Flex><FlexItem>**md**</FlexItem></Flex>` into `mdxJsxFlowElement`
nodes — markdown children parse natively, so the blank-line problem and nesting are solved by
the grammar — then **strip every `mdxFlowExpression`/`mdxTextExpression`/`mdxjsEsm` node** and
render the JSX elements through the existing component allowlist + `rehype-sanitize`. No
`compile`, no `run`, no `new Function`: the historical vector is never invoked.

**Why we did NOT adopt this (2026):** MDX/JSX is *strict*. `a < b`, `5<10`, an unmatched `{`, a
stray `<`, `<3`, or an unclosed tag is a hard parse error that fails the whole page — and
teacher content is full of these. CommonMark treats them as literal text. We already learned
this with `remark-directive` for alignment (see `rehype-plugins/align-tags.ts`: moved to plain
HTML "so a stray `:` in body text doesn't collide"). Plus a large migration of existing
loose-HTML content and the AI syntax reference. Instead we kept CommonMark's forgiving parsing
and made container tags robust by re-parsing inner content ourselves (`rehypeMarkdownChildren` +
`normalizeQuestionSpacing` — see `docs/internals/06-markdown-pipeline.md`). Revisit this option
only if first-class nesting / markdown-everywhere becomes a hard requirement and stricter
parsing is acceptable.
