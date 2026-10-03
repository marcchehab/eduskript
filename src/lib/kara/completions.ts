/**
 * Autocomplete entries for the Kara commands (the snake_case names; the
 * camelCase and original-Kara aliases are left out to keep the list short).
 * Keep in sync with __all__ in kara-module.ts.
 */
export const KARA_COMPLETIONS: { label: string; type: string; info: string }[] = [
  { label: 'move', type: 'function', info: 'move() — one cell forward (pushes a box, picks up chips)' },
  { label: 'turn_left', type: 'function', info: 'turn_left() — turn 90° left' },
  { label: 'turn_right', type: 'function', info: 'turn_right() — turn 90° right' },
  { label: 'put_barrel', type: 'function', info: 'put_barrel() — put a barrel on the current cell' },
  { label: 'remove_barrel', type: 'function', info: 'remove_barrel() — pick up the barrel on the current cell' },
  { label: 'press_switch', type: 'function', info: 'press_switch() — on a switch: toggle all doors and lasers' },
  { label: 'read_log', type: 'function', info: 'read_log() — read the terminal in front' },
  { label: 'wall_front', type: 'function', info: 'wall_front() -> bool — wall or obstacle in front?' },
  { label: 'wall_left', type: 'function', info: 'wall_left() -> bool — wall or obstacle on the left?' },
  { label: 'wall_right', type: 'function', info: 'wall_right() -> bool — wall or obstacle on the right?' },
  { label: 'box_front', type: 'function', info: 'box_front() -> bool — box in front?' },
  { label: 'door_front', type: 'function', info: 'door_front() -> bool — closed door in front?' },
  { label: 'laser_front', type: 'function', info: 'laser_front() -> bool — active laser in front?' },
  { label: 'acid_front', type: 'function', info: 'acid_front() -> bool — acid in front?' },
  { label: 'terminal_front', type: 'function', info: 'terminal_front() -> bool — terminal in front?' },
  { label: 'on_barrel', type: 'function', info: 'on_barrel() -> bool — standing on a barrel?' },
  { label: 'on_switch', type: 'function', info: 'on_switch() -> bool — standing on a switch?' },
  { label: 'on_exit', type: 'function', info: 'on_exit() -> bool — standing on the exit?' },
  { label: 'on_target', type: 'function', info: 'on_target() -> bool — standing on a box target?' },
  { label: 'scan', type: 'function', info: "scan() -> list[str] — what lies ahead up to the next wall, e.g. ['leer', 'fass', 'kiste']" },
  { label: 'position', type: 'function', info: "position() -> (x, y, direction) — e.g. (3, 1, 'O'); direction 'N', 'O', 'S' or 'W'" },
  { label: 'ship_map', type: 'function', info: 'ship_map() -> list[str] — the whole world as rows of legend chars: karte[y][x]' },
  { label: 'look_at', type: 'function', info: 'look_at(x, y) -> str — legend char of one cell (counts as a look)' },
  { label: 'mark', type: 'function', info: 'mark(v) — write a label (≤ 3 chars, e.g. a distance) on the current cell; free' },
  { label: 'mark_at', type: 'function', info: 'mark_at(x, y, v) — write a label on cell (x, y) without moving; free' },
  { label: 'marked', type: 'function', info: 'marked() -> value or None — the mark on the current cell' },
]
