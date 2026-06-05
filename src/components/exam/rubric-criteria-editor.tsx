'use client'

/**
 * Controlled editor for a scoring rubric's criteria (description + points each).
 * Used in the in-exam AI score tab and the dashboard AI scoring modal. Pure UI:
 * the parent owns persistence (PUT /scoring/rubric). Strings English.
 */

import { Plus, Trash2 } from 'lucide-react'

export interface RubricCriterion {
  id: string
  description: string
  points: number
}

const sum = (cs: RubricCriterion[]) => Math.round(cs.reduce((s, c) => s + (Number(c.points) || 0), 0) * 10) / 10

export function RubricCriteriaEditor({
  criteria,
  onChange,
}: {
  criteria: RubricCriterion[]
  onChange: (criteria: RubricCriterion[]) => void
}) {
  const update = (i: number, patch: Partial<RubricCriterion>) =>
    onChange(criteria.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const remove = (i: number) => onChange(criteria.filter((_, idx) => idx !== i))
  const add = () => onChange([...criteria, { id: `c${criteria.length + 1}`, description: '', points: 0 }])

  return (
    <div className="space-y-2">
      {criteria.map((c, i) => (
        <div key={c.id} className="flex items-start gap-2">
          <input
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
            value={c.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="Criterion…"
          />
          <input
            type="number"
            step="0.5"
            className="w-16 rounded border bg-background px-2 py-1 text-right text-sm tabular-nums"
            value={c.points}
            onChange={(e) => update(i, { points: Number(e.target.value) })}
          />
          <button
            type="button"
            className="mt-1 text-muted-foreground hover:text-destructive"
            title="Remove criterion"
            onClick={() => remove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent/50"
        >
          <Plus className="h-4 w-4" /> Add criterion
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">Σ {sum(criteria)} pts</span>
      </div>
    </div>
  )
}
