/**
 * Python source of the `kara` module, written into the Pyodide worker's FS
 * as `kara.py` for each Kara run (see runKaraCode in code-editor/index.tsx).
 *
 * The whole program runs to completion first; `_run` records a trace that the
 * main thread replays step by step (forward and backward). A step opens on
 * every executed line of the student's code (sys.settrace 'line' events on
 * frames compiled as `<student>`) and carries Kara's position, cell changes,
 * sensor results and printed text produced while it was current.
 *
 * One action per step: every action (move, turn, put, remove, press, read)
 * that finds the current step already holding an action opens a new step with
 * the same line `l` (`_act`). So `drei_vor()` from befehle.py replays as 3
 * steps on the call line (`sub` 1..3), and `move(); move()` on one line as 2 —
 * the line marker stays on the call (= step over). Lines in imported helper
 * modules are not traced; an action made inside one records the innermost
 * non-kara frame as `f` (file name), `fl` (line), `fn` (function name).
 * Every step also records `d`, the call depth (user function frames on the
 * stack: student file + helper modules, see `_depth`; omitted when 0); a step
 * holding an action gets the depth the action ran at. The panel shows it
 * ('depth 3') and its «Step into» mode moves the marker to `f`:`fl`.
 * `sub` is only set when a line made more than one action (1-based, the first
 * step gets `sub: 1` retroactively). Sensors, prints and events stay on the
 * step that is current when they happen (e.g. a sensor after the 2nd move of a
 * line sits on that line's 2nd step).
 *
 * Limits: MAX_STEPS steps (the world JSON's `max_steps` overrides it; the
 * aftermath run in world.ts karaAftermathInput uses a low one), then StepLimitError (catches `while True:` loops,
 * also action loops inside helper modules; the trace up to the limit stays
 * replayable). A helper-module loop that makes no action (`while True: pass`
 * in befehle.py) opens no steps and is NOT caught. settrace slows Python down
 * (~several x), irrelevant at this scale. The frame walk in `_act` is
 * O(call depth) per action.
 *
 * Level result (only when the program did not raise): `goal` checks the
 * world after the run; `energy` counts actions, `memory` counts statements
 * in the student's AST (docstrings excluded) — both feed the star rating in
 * world.ts `karaStars`. Doors/lasers: press_switch toggles every cell that
 * started as a door/laser, tracked with two high bits that are stripped from
 * the returned mutations.
 *
 * Door codes (`door_ask` in the world JSON, from `door.ask:` in world.ts): a
 * move() into a closed door first calls the student's function the door asks
 * (`_ask_door`: no arguments, looked up in the student's namespace only, so a
 * befehle.py function needs `from befehle import ...`; `import befehle` alone
 * does not count). The call runs like any other code: its lines are traced,
 * its actions cost energy and move MOP-7. Afterwards one step on the move()
 * line carries `q = [function, repr(answer), ok]`; a right answer opens that
 * door (mutation + event 'door'), the next step is the move itself, starting
 * from wherever the function left MOP-7. A wrong answer raises KaraError
 * 'door_code' (error gets name/got/want), a missing function 'door_missing'.
 * Doors are numbered in reading order (cells that started as 'D' or 'd');
 * door i asks door_ask[min(i, len - 1)]. While a door function runs, a move
 * into another closed door is the plain 'door' error (no nested asking).
 *
 * Errors: `error.kind` is 'kara' (KaraError: MOP-7 refused an action),
 * 'loop' (StepLimitError) or 'python'; `error.sub` classifies it further
 * (KaraError.code, or the Python exception type via `_error_sub`) so AURORA
 * can comment per error class (src/lib/kara/aurora-defaults.ts). Messages
 * stay English like real Python errors; AURORA's card is the translation.
 *
 * Lints (`_lint`, before the program runs; student file only, helper modules
 * like befehle.py are not checked): `result.lints = [{line, code, name}]`,
 * shown by kara-panel.tsx when the run does not win. Codes: `bare_call`
 * (`turn_right` as a statement, no parentheses), `sensor_no_call` (a command,
 * sensor or student function without () as an if/elif/while/assert/ternary
 * test or operand of and/or/not: always truthy), `no_return` (a student def
 * that prints but never returns a value, called in a condition or comparison),
 * `never_called` (a top-level def whose name is never loaded outside its own
 * body and that no door.ask names). "Student function" = a def anywhere in the file or a name from
 * `from x import name`; `from befehle import *` names are unknown here, so
 * `if drei_vor:` after a star import is not caught.
 *
 * Forbidden names (`_FORBIDDEN`: exec, eval, compile, __import__, globals,
 * setattr) as a name, attribute or from-import refuse the whole run with
 * error sub 'forbidden' (closes "exec('move()\n' * 20)" beating the memory
 * star). This is a speed bump for copy-paste tricks, not a sandbox:
 * `getattr(__builtins__, 'ex' + 'ec')` or a helper module still get through.
 *
 * Broken targets ('q' in world.ts: TARGET | BROKEN): on_target() is False
 * there; the 'boxes' goal still counts them as targets. Airlock cells
 * (AIRLOCK, 'a'): a box pushed onto one is removed (one mutation, the box
 * vanishes); MOP-7 drives over them like floor.
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
import os as _os
import json as _json
import ast as _ast

# Cell flags — keep in sync with src/lib/kara/world.ts
BLOCK, ITEM, BOX, CHIP, DOOR, LASER, ACID, EXIT, SWITCH, TARGET, TERMINAL, BROKEN, AIRLOCK = (
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096)
_DX = (0, 1, 0, -1)
_DY = (-1, 0, 1, 0)
MAX_STEPS = 50000
_max_steps = MAX_STEPS  # per run: world JSON 'max_steps' (see _run)
_STUDENT = '<student>'


class KaraError(Exception):
    """MOP-7 refused an action; code becomes error['sub'] (wall, door, ...)."""
    def __init__(self, message='', code=None, **extra):
        super().__init__(message)
        self.code = code
        self.extra = extra  # merged into error (door codes: name, got, want)


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
        self.read = set()  # terminal indices read via read_log() (goal 'logs')
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
    if len(_steps) >= _max_steps:
        raise StepLimitError(f'Stopped after {_max_steps} steps. Is there an endless loop?')
    _cur = {'l': line}
    d = _depth()
    if d:
        _cur['d'] = d
    _steps.append(_cur)


def _depth():
    """Call depth for the replay ('depth 3'): user function frames on the stack.
    User = the student's file or a module next to kara.py (befehle.py, ...);
    '<module>', '<lambda>', '<listcomp>' etc. are not counted. O(stack) per step."""
    n = 0
    f = _sys._getframe(2)
    while f is not None:
        c = f.f_code
        if not c.co_name.startswith('<') and _is_user_file(c.co_filename):
            n += 1
        f = f.f_back
    return n


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


_THIS_FILE = _sys._getframe().f_code.co_filename
_HERE = _os.path.dirname(_os.path.abspath(_THIS_FILE))  # helper modules are written next to kara.py
_user_files = {}  # filename -> is user code (cache for _depth)


def _is_user_file(name):
    r = _user_files.get(name)
    if r is None:
        r = name == _STUDENT or (name != _THIS_FILE and not name.startswith('<')
                                 and _os.path.dirname(_os.path.abspath(name)) == _HERE)
        _user_files[name] = r
    return r


def _act():
    """Count one action and give it its own step (see the header in kara-module.ts)."""
    _w.energy += 1
    step = _cur_step()
    if step.get('a'):
        sub = step.setdefault('sub', 1)
        _open_step(step['l'])
        _cur['sub'] = sub + 1
    _cur['a'] = True
    # The tracer opened this step at the call line; the action runs deeper.
    d = _depth()
    if d:
        _cur['d'] = d
    else:
        _cur.pop('d', None)
    # Innermost frame outside kara.py: the student's file or a helper module.
    f = _sys._getframe(1)
    while f is not None and f.f_code.co_filename == _THIS_FILE:
        f = f.f_back
    if f is not None and f.f_code.co_filename != _STUDENT:
        _cur['f'] = f.f_code.co_filename.replace(chr(92), '/').rsplit('/', 1)[-1]
        _cur['fl'] = f.f_lineno
        _cur['fn'] = f.f_code.co_name


# ─── Actions ─────────────────────────────────────────────

def move():
    """Move one cell forward. A box in front is pushed; chips are picked up.
    A closed door in a level with door codes asks its function first."""
    if _door_ask and not _asking:
        nx, ny = _w.ahead(_w.x, _w.y, _w.d)
        if _w.get(nx, ny) & DOOR:
            _ask_door(nx, ny)
    _act()
    nx, ny = _w.ahead(_w.x, _w.y, _w.d)
    cell = _w.get(nx, ny)
    if cell & TERMINAL:
        raise KaraError("MOP-7 can't move: there is a terminal in front.", 'terminal')
    if cell & BLOCK:
        raise KaraError("MOP-7 can't move: there is a wall in front.", 'wall')
    if cell & DOOR:
        raise KaraError("MOP-7 can't move: the door is closed.", 'door')
    if cell & LASER:
        raise KaraError("MOP-7 can't move: the laser is on.", 'laser')
    if cell & BOX:
        bx, by = _w.ahead(nx, ny, _w.d)
        behind = _w.get(bx, by)
        if behind & (BLOCK | BOX | DOOR | LASER | ACID):
            raise KaraError("MOP-7 can't push the box: something is behind it.", 'box')
        _w.set(nx, ny, cell & ~BOX)
        if not behind & AIRLOCK:  # pushed into an open airlock: gone
            _w.set(bx, by, behind | BOX)
        cell = _w.get(nx, ny)
    _w.x, _w.y = nx, ny
    _moved()
    if cell & ACID:
        raise KaraError("MOP-7 drove into the acid.", 'acid')
    if cell & CHIP:
        _w.set(nx, ny, cell & ~CHIP)
        if (nx, ny) in _w.chips:
            _event('chip', _w.chips.index((nx, ny)))


_door_ask = []   # [[function name, expected str or None], ...] per door, reading order
_asking = False  # True while a door function runs (no nested door asking)
_ns = {}         # the student's namespace (door functions are looked up here)


def _door_want(expected):
    """What kind of answer a door expects: 'bool', 'number', 'text' (for AURORA)."""
    if expected in ('True', 'False'):
        return 'bool'
    try:
        float(expected)
        return 'number'
    except (TypeError, ValueError):
        return 'text'


def _door_ok(got, expected):
    if expected is None:
        return False
    if expected in ('True', 'False'):
        return isinstance(got, bool) and got == (expected == 'True')
    return str(got) == expected


def _ask_door(x, y):
    """Call the function the door at (x, y) asks; open it or raise (see header)."""
    global _asking
    doors = [i for i, c in enumerate(_w.cells) if c & _DOORS]
    i = doors.index(y * _w.cols + x)
    fn, expected = _door_ask[min(i, len(_door_ask) - 1)]
    line = _cur_step()['l']
    f = _ns.get(fn)
    if f is None:
        raise KaraError(f"The door asks {fn}(), but there is no such function.", 'door_missing', name=fn)
    _asking = True
    try:
        got = f()
    finally:
        _asking = False
    ok = _door_ok(got, expected)
    answer = repr(got)
    if len(answer) > 40:
        answer = answer[:39] + '…'
    _open_step(line)
    _cur['q'] = [fn, answer, ok]
    if not ok:
        raise KaraError(f"The door asked {fn}() and got {answer}.", 'door_code',
                        name=fn, got=answer, want=_door_want(expected))
    _w.set(x, y, _w.get(x, y) & ~DOOR)
    _event('door', i)
    _open_step(line)


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
        raise KaraError("MOP-7 can't put a barrel: there already is one.", 'item')
    _w.set(_w.x, _w.y, cell | ITEM)


def remove_barrel():
    _act()
    cell = _w.get(_w.x, _w.y)
    if not cell & ITEM:
        raise KaraError("MOP-7 can't remove a barrel: there is none here.", 'no_item')
    _w.set(_w.x, _w.y, cell & ~ITEM)


def press_switch():
    """Toggle every door and laser in the level. Kara must stand on a switch."""
    _act()
    if not _w.get(_w.x, _w.y) & SWITCH:
        raise KaraError("MOP-7 can't press a switch: there is none here.", 'no_switch')
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
        raise KaraError("MOP-7 can't read a log: there is no terminal in front.", 'no_terminal')
    if (tx, ty) in _w.terminals:
        i = _w.terminals.index((tx, ty))
        _w.read.add(i)
        _event('log', i)


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
    'on_target': lambda: bool(_here() & TARGET) and not _here() & BROKEN,
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


# Python exception type -> error['sub']. Order matters: TabError is an
# IndentationError is a SyntaxError; ModuleNotFoundError is an ImportError.
_PY_SUBS = (
    (IndentationError, 'indent'),
    (SyntaxError, 'syntax'),
    (ModuleNotFoundError, 'module'),
    (NameError, 'name'),
    (RecursionError, 'recursion'),
    (TypeError, 'type'),
)


def _error_sub(exc):
    if isinstance(exc, KaraError):
        return exc.code
    for cls, sub in _PY_SUBS:
        if isinstance(exc, cls):
            return sub
    return None


_expected_output = None  # None: no value for this variant, the output goal cannot hold


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
    if 'logs' in goals and len(_w.read) < len(_w.terminals):
        missing.append('logs')
    if 'output' in goals:
        printed = ''.join(s.get('o', '') for s in _steps).strip().splitlines()
        if _expected_output is None or not printed or printed[-1].strip() != str(_expected_output).strip():
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


_FORBIDDEN = frozenset(('exec', 'eval', 'compile', '__import__', 'globals', 'setattr'))
_CONDITIONS = (_ast.If, _ast.While, _ast.IfExp, _ast.Assert)


class ForbiddenError(Exception):
    pass


def _no_return(fn):
    """True when a def prints but never returns a value (callers get None)."""
    prints = False
    for node in _ast.walk(fn):
        if isinstance(node, _ast.Return) and node.value is not None and not (
                isinstance(node.value, _ast.Constant) and node.value.value is None):
            return False
        if isinstance(node, _ast.Call) and isinstance(node.func, _ast.Name) and node.func.id == 'print':
            prints = True
    return prints


def _lint(tree):
    """Static checks before the run (see the header in kara-module.ts).

    Returns (lints, forbidden): lints = [{line, code, name}] sorted by line,
    forbidden = the first node using a name in _FORBIDDEN (or None).
    One ast.walk per top-level statement (O(nodes)), plus one walk per def
    that is called inside a condition (_no_return)."""
    defs = {}        # every def in the file (also nested): name -> node
    imported = set()  # names from 'from x import name' (not '*')
    refs = {}        # name -> top-level defs (None = module level) that load it
    bare, tests, compared = [], [], []
    forbidden = None

    def ban(node):
        nonlocal forbidden
        if forbidden is None or node.lineno < forbidden.lineno:
            forbidden = node

    for top in tree.body:
        owner = top.name if isinstance(top, (_ast.FunctionDef, _ast.AsyncFunctionDef)) else None
        for node in _ast.walk(top):
            if isinstance(node, _ast.Name):
                if node.id in _FORBIDDEN:
                    ban(node)
                if isinstance(node.ctx, _ast.Load):
                    refs.setdefault(node.id, set()).add(owner)
            elif isinstance(node, _ast.Attribute):
                if node.attr in _FORBIDDEN:
                    ban(node)
            elif isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                defs[node.name] = node
            elif isinstance(node, _ast.ImportFrom):
                for a in node.names:
                    if a.name in _FORBIDDEN:
                        ban(node)
                    if a.name != '*':
                        imported.add(a.asname or a.name)
            elif isinstance(node, _ast.Expr):
                if isinstance(node.value, _ast.Name):
                    bare.append(node.value)
            elif isinstance(node, _CONDITIONS):
                tests.append(node.test)
            elif isinstance(node, _ast.BoolOp):
                tests.extend(node.values)
            elif isinstance(node, _ast.UnaryOp):
                if isinstance(node.op, _ast.Not):
                    tests.append(node.operand)
            elif isinstance(node, _ast.Compare):
                compared.append(node.left)
                compared.extend(node.comparators)
    if forbidden is not None:
        return [], forbidden

    commands = set(__all__) - {'KaraError'}
    callables = commands | set(defs) | imported
    found = {}

    def add(node, code, name):
        found.setdefault((node.lineno, code, name), None)

    for n in bare:
        if n.id in callables:
            add(n, 'bare_call', n.id)
    for t in tests:
        if isinstance(t, _ast.Name) and t.id in callables:
            add(t, 'sensor_no_call', t.id)
    silent = {}
    for t in tests + compared:
        if isinstance(t, _ast.Call) and isinstance(t.func, _ast.Name) and t.func.id in defs:
            name = t.func.id
            if name not in silent:
                silent[name] = _no_return(defs[name])
            if silent[name]:
                add(t, 'no_return', name)
    asked = {fn for fn, _ in _door_ask}  # a door calls these (door.ask): not "never called"
    for top in tree.body:
        if (isinstance(top, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and top.name not in asked
                and not refs.get(top.name, set()) - {top.name}):
            add(top, 'never_called', top.name)
    lints = [{'line': line, 'code': code, 'name': name} for line, code, name in found]
    lints.sort(key=lambda d: d['line'])
    return lints, None


def _run(student_path='__kara_student.py', world_path='__kara_world.json'):
    global _w, _steps, _cur, _expected_output, _door_ask, _asking, _ns, _max_steps
    with open(world_path) as f:
        data = _json.load(f)
    _max_steps = data.get('max_steps') or MAX_STEPS
    _expected_output = data.get('output')
    _door_ask = data.get('door_ask') or []
    _asking = False
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
    _ns = ns
    # Also as builtins, so helper files (e.g. a skript-wide befehle.py) can use
    # move() etc. without 'from kara import *', like print().
    import builtins as _builtins
    for name in __all__:
        setattr(_builtins, name, globals()[name])
    error = None
    memory = 0
    lints = []
    old_out = _sys.stdout
    _sys.stdout = _Out()
    try:
        tree = _ast.parse(source, _STUDENT)
        memory = _statements(tree)
        lints, banned = _lint(tree)
        if banned is not None:
            name = getattr(banned, 'id', None) or getattr(banned, 'attr', None) or next(
                a.name for a in banned.names if a.name in _FORBIDDEN)
            e = ForbiddenError(f'{name} is not available in Kara programs.')
            e.name, e.lineno = name, banned.lineno
            raise e
        code = compile(tree, _STUDENT, 'exec')
        _sys.settrace(_global_trace)
        try:
            exec(code, ns)
        finally:
            _sys.settrace(None)
    except SyntaxError as e:
        # Raised by ast.parse for the student's file, or by exec when an
        # imported helper (befehle.py) has a syntax error.
        error = {'line': e.lineno if e.filename == _STUDENT else _error_line(e),
                 'message': f'{type(e).__name__}: {e.msg}', 'kind': 'python', 'sub': _error_sub(e)}
    except ForbiddenError as e:
        error = {'line': e.lineno, 'message': f'{type(e).__name__}: {e}', 'kind': 'python',
                 'sub': 'forbidden', 'name': e.name}
    except StepLimitError as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'loop'}
    except KaraError as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'kara', 'sub': e.code, **e.extra}
    except Exception as e:
        error = {'line': _error_line(e), 'message': f'{type(e).__name__}: {e}', 'kind': 'python', 'sub': _error_sub(e)}
        if isinstance(e, ModuleNotFoundError) and e.name:
            # The editor flashes its toolbox tab when this is the toolbox module.
            error['name'] = e.name
    finally:
        _sys.stdout = old_out
    mask = ~(_DOORS | _LASERS)
    for step in _steps:
        step.pop('a', None)
        for m in step.get('m', []):
            m[2] &= mask
            m[3] &= mask
    result = {'steps': _steps, 'error': error, 'energy': _w.energy, 'memory': memory, 'lints': lints}
    if error is None:
        result['goal'] = _goal(data.get('goals', []))
    return _json.dumps(result)
`

/** Code the worker executes; the returned JSON string becomes `result`. */
export const KARA_RUNNER = 'import kara as __kara\n__kara._run()'
