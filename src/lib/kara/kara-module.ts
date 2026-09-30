/**
 * Python source of the `kara` module, written into the Pyodide worker's FS
 * as `kara.py` for each Kara run (see runKaraCode in code-editor/index.tsx).
 *
 * The whole program runs to completion first; `_run` records a trace that the
 * main thread replays step by step (forward and backward). A step is one
 * executed line of the student's code (sys.settrace 'line' events on frames
 * compiled as `<student>`), carrying Kara's position, cell changes, sensor
 * results and printed text produced while that line ran. Lines in imported
 * helper modules are not traced; their Kara actions attach to the calling line.
 *
 * Limits: MAX_STEPS lines, then StepLimitError (catches `while True:` loops;
 * the trace up to the limit stays replayable). settrace slows Python down
 * (~several x), irrelevant at this scale.
 *
 * Level result (only when the program did not raise): `goal` checks the
 * world after the run; `energy` counts actions, `memory` counts statements
 * in the student's AST (docstrings excluded) — both feed the star rating in
 * world.ts `karaStars`. Doors/lasers: press_switch toggles every cell that
 * started as a door/laser, tracked with two high bits that are stripped from
 * the returned mutations.
 *
 * Keep the direction encoding (0=N,1=E,2=S,3=W) and the trace shape in sync
 * with src/lib/kara/world.ts.
 */
export const KARA_MODULE_SOURCE = `
"""Kara for Eduskript (MOP-7).

Actions (cost 1 energy each): move, turn_left, turn_right, put_barrel,
remove_barrel, press_switch, read_log.
Sensors (free): wall_front/left/right, box_front, door_front, laser_front,
acid_front, terminal_front, on_barrel, on_switch, on_exit, on_target.
camelCase aliases (turnLeft, wallFront, ...) and the original Kara names
(tree_front, on_leaf, put_leaf, mushroom_front, ...) work too."""
import sys as _sys
import json as _json
import ast as _ast

# Cell flags — keep in sync with src/lib/kara/world.ts
BLOCK, ITEM, BOX, CHIP, DOOR, LASER, ACID, EXIT, SWITCH, TARGET, TERMINAL = (
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024)
_DX = (0, 1, 0, -1)
_DY = (-1, 0, 1, 0)
MAX_STEPS = 50000
_STUDENT = '<student>'


class KaraError(Exception):
    pass


class StepLimitError(Exception):
    pass


class _World:
    def __init__(self, data):
        self.cols = data['cols']
        self.rows = data['rows']
        self.cells = list(data['cells'])
        k = data['kara']
        self.x, self.y, self.d = k['x'], k['y'], k['d']
        self.terminals = [tuple(t) for t in data.get('terminals', [])]
        self.chips = [tuple(c) for c in data.get('chips', [])]
        self.energy = 0

    def ahead(self, x, y, d):
        return (x + _DX[d]) % self.cols, (y + _DY[d]) % self.rows

    def get(self, x, y):
        return self.cells[y * self.cols + x]

    def set(self, x, y, value):
        i = y * self.cols + x
        before = self.cells[i]
        if before != value:
            self.cells[i] = value
            _cur_step().setdefault('m', []).append([x, y, before, value])


_w = None
_steps = []
_cur = None


def _open_step(line):
    global _cur
    if len(_steps) >= MAX_STEPS:
        raise StepLimitError(f'Stopped after {MAX_STEPS} steps. Is there an endless loop?')
    _cur = {'l': line}
    _steps.append(_cur)


def _cur_step():
    if _cur is None:
        _open_step(0)
    return _cur


def _moved():
    _cur_step()['k'] = [_w.x, _w.y, _w.d]


def _event(kind, index):
    _cur_step().setdefault('v', []).append([kind, index])


def _sensed(name, result):
    _cur_step().setdefault('s', []).append([name, result])
    return result


def _act():
    _w.energy += 1


# ─── Actions ─────────────────────────────────────────────

def move():
    """Move one cell forward. A box in front is pushed; chips are picked up."""
    _act()
    nx, ny = _w.ahead(_w.x, _w.y, _w.d)
    cell = _w.get(nx, ny)
    if cell & TERMINAL:
        raise KaraError("Kara can't move: there is a terminal in front.")
    if cell & BLOCK:
        raise KaraError("Kara can't move: there is a wall in front.")
    if cell & DOOR:
        raise KaraError("Kara can't move: the door is closed.")
    if cell & LASER:
        raise KaraError("Kara can't move: the laser is on.")
    if cell & BOX:
        bx, by = _w.ahead(nx, ny, _w.d)
        behind = _w.get(bx, by)
        if behind & (BLOCK | BOX | DOOR | LASER | ACID):
            raise KaraError("Kara can't push the box: something is behind it.")
        _w.set(nx, ny, cell & ~BOX)
        _w.set(bx, by, behind | BOX)
        cell = _w.get(nx, ny)
    _w.x, _w.y = nx, ny
    _moved()
    if cell & ACID:
        raise KaraError("Kara drove into the acid.")
    if cell & CHIP:
        _w.set(nx, ny, cell & ~CHIP)
        if (nx, ny) in _w.chips:
            _event('chip', _w.chips.index((nx, ny)))


def turn_left():
    _act()
    _w.d = (_w.d + 3) % 4
    _moved()


def turn_right():
    _act()
    _w.d = (_w.d + 1) % 4
    _moved()


def put_barrel():
    _act()
    cell = _w.get(_w.x, _w.y)
    if cell & ITEM:
        raise KaraError("Kara can't put a barrel: there already is one.")
    _w.set(_w.x, _w.y, cell | ITEM)


def remove_barrel():
    _act()
    cell = _w.get(_w.x, _w.y)
    if not cell & ITEM:
        raise KaraError("Kara can't remove a barrel: there is none here.")
    _w.set(_w.x, _w.y, cell & ~ITEM)


def press_switch():
    """Toggle every door and laser in the level. Kara must stand on a switch."""
    _act()
    if not _w.get(_w.x, _w.y) & SWITCH:
        raise KaraError("Kara can't press a switch: there is none here.")
    for y in range(_w.rows):
        for x in range(_w.cols):
            c = _w.get(x, y)
            if c & _DOORS:
                _w.set(x, y, c ^ DOOR)
            if c & _LASERS:
                _w.set(x, y, c ^ LASER)


def read_log():
    """Read the terminal in front of Kara."""
    _act()
    tx, ty = _w.ahead(_w.x, _w.y, _w.d)
    if not _w.get(tx, ty) & TERMINAL:
        raise KaraError("Kara can't read a log: there is no terminal in front.")
    if (tx, ty) in _w.terminals:
        _event('log', _w.terminals.index((tx, ty)))


# Door / laser cells are marked once at load (a pressed switch clears DOOR/LASER,
# so the static masks remember where they were): see _run.
_DOORS = 1 << 20
_LASERS = 1 << 21


# ─── Sensors ─────────────────────────────────────────────
# Each name records itself, so the inline hint shows what the student called
# (tree_front() stays tree_front() even though it is wall_front underneath).

def _look(d):
    return _w.get(*_w.ahead(_w.x, _w.y, d))


def _here():
    return _w.get(_w.x, _w.y)


_SENSORS = {
    'wall_front': lambda: bool(_look(_w.d) & BLOCK),
    'wall_left': lambda: bool(_look((_w.d + 3) % 4) & BLOCK),
    'wall_right': lambda: bool(_look((_w.d + 1) % 4) & BLOCK),
    'box_front': lambda: bool(_look(_w.d) & BOX),
    'door_front': lambda: bool(_look(_w.d) & DOOR),
    'laser_front': lambda: bool(_look(_w.d) & LASER),
    'acid_front': lambda: bool(_look(_w.d) & ACID),
    'terminal_front': lambda: bool(_look(_w.d) & TERMINAL),
    'on_barrel': lambda: bool(_here() & ITEM),
    'on_switch': lambda: bool(_here() & SWITCH),
    'on_exit': lambda: bool(_here() & EXIT),
    'on_target': lambda: bool(_here() & TARGET),
}


def _camel(name):
    head, *rest = name.split('_')
    return head + ''.join(w.title() for w in rest)


# alias → sensor it reads (camelCase + the original Kara's tree/leaf/mushroom)
_SENSOR_ALIASES = {_camel(n): n for n in _SENSORS}
_SENSOR_ALIASES.update({
    'tree_front': 'wall_front', 'tree_left': 'wall_left', 'tree_right': 'wall_right',
    'mushroom_front': 'box_front', 'on_leaf': 'on_barrel',
    'treeFront': 'wall_front', 'treeLeft': 'wall_left', 'treeRight': 'wall_right',
    'mushroomFront': 'box_front', 'onLeaf': 'on_barrel',
})


def _make_sensor(name, read):
    def sensor():
        return _sensed(name, read())
    sensor.__name__ = name
    return sensor


for _name, _read in _SENSORS.items():
    globals()[_name] = _make_sensor(_name, _read)
for _name, _target in _SENSOR_ALIASES.items():
    globals()[_name] = _make_sensor(_name, _SENSORS[_target])

turnLeft, turnRight, putBarrel, removeBarrel = turn_left, turn_right, put_barrel, remove_barrel
pressSwitch, readLog = press_switch, read_log
put_leaf, remove_leaf, putLeaf, removeLeaf = put_barrel, remove_barrel, put_barrel, remove_barrel

__all__ = [
    'move', 'turn_left', 'turn_right', 'put_barrel', 'remove_barrel', 'press_switch', 'read_log',
    'turnLeft', 'turnRight', 'putBarrel', 'removeBarrel', 'pressSwitch', 'readLog',
    'put_leaf', 'remove_leaf', 'putLeaf', 'removeLeaf',
    *_SENSORS, *_SENSOR_ALIASES,
    'KaraError',
]


# ─── Runner ──────────────────────────────────────────────

class _Out:
    def write(self, text):
        if text:
            step = _cur_step()
            step['o'] = step.get('o', '') + text
        return len(text)

    def flush(self):
        pass


def _local_trace(frame, event, arg):
    if event == 'line':
        _open_step(frame.f_lineno)
    return _local_trace


def _global_trace(frame, event, arg):
    if frame.f_code.co_filename == _STUDENT:
        return _local_trace
    return None


def _error_line(exc):
    line = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == _STUDENT:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


_expected_output = ''


def _goal(goals):
    missing = []
    cells = _w.cells
    if 'exit' in goals and not _here() & EXIT:
        missing.append('exit')
    if 'collect' in goals and any(c & ITEM for c in cells):
        missing.append('collect')
    if 'boxes' in goals and any(c & TARGET and not c & BOX for c in cells):
        missing.append('boxes')
    if 'chips' in goals and any(c & CHIP for c in cells):
        missing.append('chips')
    if 'output' in goals:
        printed = ''.join(s.get('o', '') for s in _steps).strip().splitlines()
        if not printed or printed[-1].strip() != str(_expected_output).strip():
            missing.append('output')
    return {'reached': not missing, 'missing': missing}


def _statements(tree):
    """Program size for the memory star: every statement node, docstrings excluded."""
    n = 0
    for node in _ast.walk(tree):
        if isinstance(node, _ast.stmt):
            if isinstance(node, _ast.Expr) and isinstance(getattr(node, 'value', None), _ast.Constant) and isinstance(node.value.value, str):
                continue
            n += 1
    return n


def _run(student_path='__kara_student.py', world_path='__kara_world.json'):
    global _w, _steps, _cur, _expected_output
    with open(world_path) as f:
        data = _json.load(f)
    _expected_output = data.get('output', '')
    _w = _World(data)
    # Remember door / laser cells (static masks, stripped from the result).
    for i, c in enumerate(_w.cells):
        if c & DOOR or data.get('look', [''] * len(_w.cells))[i] == 'D':
            _w.cells[i] |= _DOORS
        if c & LASER:
            _w.cells[i] |= _LASERS
    with open(student_path) as f:
        source = f.read()
    _steps = []
    _cur = None
    ns = {'__name__': '__main__', 'kara': _sys.modules[__name__]}
    ns.update({name: globals()[name] for name in __all__})
    error = None
    memory = 0
    old_out = _sys.stdout
    _sys.stdout = _Out()
    try:
        tree = _ast.parse(source, _STUDENT)
        memory = _statements(tree)
        code = compile(tree, _STUDENT, 'exec')
        _sys.settrace(_global_trace)
        try:
            exec(code, ns)
        finally:
            _sys.settrace(None)
    except SyntaxError as e:
        error = {'line': e.lineno, 'message': f'{type(e).__name__}: {e.msg}', 'kind': 'python'}
    except StepLimitError as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'loop'}
    except KaraError as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'kara'}
    except Exception as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'python'}
    finally:
        _sys.stdout = old_out
    mask = ~(_DOORS | _LASERS)
    for step in _steps:
        for m in step.get('m', []):
            m[2] &= mask
            m[3] &= mask
    result = {'steps': _steps, 'error': error, 'energy': _w.energy, 'memory': memory}
    if error is None:
        result['goal'] = _goal(data.get('goals', []))
    return _json.dumps(result)
`

/** Code the worker executes; the returned JSON string becomes `result`. */
export const KARA_RUNNER = 'import kara as __kara\n__kara._run()'
