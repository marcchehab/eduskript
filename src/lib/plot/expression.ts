/**
 * Expression layer for the `plot` fence.
 *
 * mathjs does the parsing (it understands the implicit multiplication teachers
 * write: `2x`, `2sin(x)`, `1/2x`). We only harden it and adapt two naming
 * conventions:
 *
 *   - `ln` doesn't exist in mathjs; `log` there is the NATURAL logarithm. Swiss
 *     school notation is the opposite (`ln` natural, `log` base 10), so the
 *     evaluation scope shadows both names.
 *   - author terms never contain `=`; assignments are rejected in spec.ts, so
 *     mathjs' function-assignment syntax is out of reach.
 *
 * `mathjs/number` is the number-only build (no BigNumber/Complex/Matrix) —
 * markedly smaller than the default entry, which matters because this module is
 * pulled into the page render.
 */
import { create, all, type MathJsInstance } from 'mathjs/number'

/** Hard limits — this runs inside the SSR/ISR render path. */
export const MAX_EXPRESSION_LENGTH = 500

let instance: MathJsInstance | null = null

function mathjs(): MathJsInstance {
  if (instance) return instance
  const inst = create(all, {})
  // mathjs' own hardening recipe for untrusted input. `parse` must stay intact —
  // compile() goes through it.
  const disabled = function disabledFn(): never {
    throw new Error('This function is not available in plots')
  }
  inst.import(
    {
      import: disabled,
      createUnit: disabled,
      reviver: disabled,
      evaluate: disabled,
      simplify: disabled,
      derivative: disabled,
      config: disabled,
    },
    { override: true }
  )
  instance = inst
  return inst
}

/** Scope overrides applied to every evaluation (see the `ln`/`log` note above). */
const SCOPE_OVERRIDES = {
  ln: (v: number) => Math.log(v),
  log: (v: number) => Math.log10(v),
  lg: (v: number) => Math.log10(v),
}

export class PlotExpressionError extends Error {}

/**
 * Compile a term into `(x) => number`. Throws PlotExpressionError for syntax
 * errors and unknown names; domain problems (`ln(-1)`, `1/0`) are NOT errors —
 * they yield NaN/Infinity, which the sampler turns into a gap in the curve.
 *
 * `extra` holds previously defined curves, so `g(x) = f(x) + 2` works.
 */
export function compileExpression(
  term: string,
  extra?: Record<string, (x: number) => number>
): (x: number) => number {
  if (term.length > MAX_EXPRESSION_LENGTH) {
    throw new PlotExpressionError(`Expression is too long (max ${MAX_EXPRESSION_LENGTH} characters)`)
  }

  let compiled: { evaluate: (scope: Record<string, unknown>) => unknown }
  try {
    compiled = mathjs().compile(term)
  } catch (err) {
    throw new PlotExpressionError(cleanMessage(err))
  }

  // One scope object reused across ~1200 samples: only `x` is mutated.
  const scope: Record<string, unknown> = { ...SCOPE_OVERRIDES, ...extra, x: 0 }

  // Evaluate once up front so a bad name ("lg2(x)") surfaces as an author error
  // instead of NaN pixels. A domain error at this one probe point is fine.
  scope.x = 1
  try {
    compiled.evaluate(scope)
  } catch (err) {
    throw new PlotExpressionError(cleanMessage(err))
  }

  return (x: number): number => {
    scope.x = x
    try {
      const value = compiled.evaluate(scope)
      return typeof value === 'number' ? value : NaN
    } catch {
      // Per-sample failures (e.g. mod by zero) are gaps, not errors.
      return NaN
    }
  }
}

function cleanMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // mathjs appends "(char 7)" — the offset is relative to the term, which we
  // don't show on its own, so drop it and keep the sentence.
  return raw.replace(/\s*\(char \d+\)\s*$/, '')
}
