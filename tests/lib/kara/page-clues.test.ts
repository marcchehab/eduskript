import { describe, expect, it } from 'vitest'
import { karaClues, pageKaraClues, parseKaraLevel } from '@/lib/kara/world'

const PAGE = `# Woche
## Level 1: Brücke
\`\`\`kara-world for="w1-l1"
#>tc#
---
log: Erster Log. | speaker=LENZ
chip: w1-becher | Becher | Nr. 112
\`\`\`
## Level 2: Gang
\`\`\`python editor id="ed2"
# Ihr Programm (kein Titel)
\`\`\`
\`\`\`kara-world for="ed2"
#>t#
---
id: w1-l2
log: Zweiter Log.
\`\`\`
`

describe('pageKaraClues', () => {
  it('lists chips and logs of every level in page order with their section', () => {
    const clues = pageKaraClues(PAGE)
    expect(clues.map(c => [c.id, c.level, c.kind, c.section])).toEqual([
      ['w1-becher', 'w1-l1', 'chip', 'Level 1: Brücke'],
      ['w1-l1-log-0', 'w1-l1', 'log', 'Level 1: Brücke'],
      ['w1-l2-log-0', 'w1-l2', 'log', 'Level 2: Gang'],
    ])
    expect(clues[1]).toMatchObject({ title: 'Log: LENZ', text: 'Erster Log.' })
  })
  it('uses the same ids as karaClues (what the panel saves)', () => {
    const level = parseKaraLevel('#>t#\n---\nlog: X')
    expect(karaClues(level.config, 'w9-l1').map(c => c.id)).toEqual(['w9-l1-log-0'])
  })
})
