import { createLucideIcon, type IconNode } from 'lucide-react'

// Lucide's cog (as in UserCog), ~20% larger, in the bottom-right corner.
// Shapes combined with it leave the corner (x>12, y>12) open.
const COG: IconNode = [
  ['circle', { cx: '18', cy: '18', r: '3.6', key: 'cog' }],
  ['path', { d: 'm13.566 19.836 1.108 -0.458', key: 't1' }],
  ['path', { d: 'm14.674 16.622 -1.108 -0.460', key: 't2' }],
  ['path', { d: 'm16.622 14.674 -0.460 -1.108', key: 't3' }],
  ['path', { d: 'm16.622 21.326 -0.460 1.109', key: 't4' }],
  ['path', { d: 'm19.378 14.674 0.460 -1.108', key: 't5' }],
  ['path', { d: 'm19.836 22.435 -0.458 -1.109', key: 't6' }],
  ['path', { d: 'm21.326 16.622 1.109 -0.460', key: 't7' }],
  ['path', { d: 'm21.326 19.378 1.109 0.460', key: 't8' }],
]

/** "Your Eduskript site" settings: the ring notebook from the Eduskript logo + cog. */
export const NotebookCog = createLucideIcon('notebook-cog', [
  ['path', { d: 'M12 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8', key: 'body' }],
  ['path', { d: 'M2 6h4', key: 'r1' }],
  ['path', { d: 'M2 10h4', key: 'r2' }],
  ['path', { d: 'M2 14h4', key: 'r3' }],
  ['path', { d: 'M2 18h4', key: 'r4' }],
  ...COG,
])

/** Page settings: lucide's File (page) + cog. */
export const PageCog = createLucideIcon('page-cog', [
  ['path', { d: 'M12 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v4', key: 'body' }],
  ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5', key: 'fold' }],
  ...COG,
])
