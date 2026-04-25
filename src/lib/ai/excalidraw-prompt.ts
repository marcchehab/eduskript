// System prompt + helpers for the AI → Mermaid → Excalidraw bridge.
// See src/app/api/ai/excalidraw/route.ts for the caller.

export const EXCALIDRAW_SYSTEM_PROMPT = `You are an assistant that converts a user's natural-language description into a Mermaid diagram.

Output a Mermaid source block. You may wrap it in \`\`\`mermaid fences if you want — they will be stripped. Do not add any prose, commentary, or explanation outside the diagram. The first non-fence line of the diagram MUST be a valid Mermaid diagram type declaration.

Supported diagram types (pick the best fit for the user's request):
- flowchart (\`flowchart TD\` / \`flowchart LR\`) — processes, decision trees
- sequenceDiagram — interactions over time
- classDiagram — OO structure
- stateDiagram-v2 — state machines
- erDiagram — entity-relationship models
- gantt — schedules
- mindmap — hierarchical brainstorming
- pie — proportions
- gitGraph — git history

Rules:
- Keep node labels short (≤6 words).
- Do NOT put double quotes (\`"\`) inside square/round/curly node brackets — Mermaid's parser will reject \`A[Show "Foo" Error]\`. If you need to quote a word, either omit the quotes (\`A[Show Foo Error]\`) or wrap the whole label in quotes (\`A["Show 'Foo' Error"]\` with single quotes inside).
- Do NOT use semicolons to separate statements; put each statement on its own line.
- Prefer flowchart when in doubt.
- Do not invent unsupported syntax.
- If the user requests something that cannot be expressed as a diagram (e.g. "draw a cat"), still emit the closest reasonable Mermaid diagram (e.g. a flowchart placeholder).`

export function buildRetryPrompt(prompt: string, language: 'en' | 'de', failedMermaid: string, parserError: string): string {
  const langInstr =
    language === 'de'
      ? 'Use German for any text labels in the diagram.'
      : 'Use English for any text labels in the diagram.'
  return `${langInstr}

User request:
${prompt.trim()}

Your previous attempt failed Mermaid's parser with this error:
${parserError}

The failing diagram was:
${failedMermaid}

Emit a corrected Mermaid diagram. Output ONLY the Mermaid source — no fences, no explanation.`
}

export function buildUserPrompt(prompt: string, language: 'en' | 'de'): string {
  const langInstr =
    language === 'de'
      ? 'Use German for any text labels in the diagram.'
      : 'Use English for any text labels in the diagram.'
  return `${langInstr}\n\nUser request:\n${prompt.trim()}`
}

// Models often wrap output in ```mermaid ... ``` fences despite instructions.
// Strip both fenced and partially-fenced forms, plus surrounding whitespace.
export function stripMermaidFences(text: string): string {
  let t = text.trim()
  const full = t.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n```$/)
  if (full) return full[1].trim()
  t = t.replace(/^```(?:mermaid)?\s*\n?/, '')
  t = t.replace(/\n?```\s*$/, '')
  return t.trim()
}
