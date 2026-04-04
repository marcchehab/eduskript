# Plugins

Build custom interactive elements and embed them in your lessons. Plugins are sandboxed HTML/JS components that communicate with the page via a simple SDK.

---

## How Plugins Work

A plugin is a self-contained HTML file that runs in a sandboxed iframe. It can:
- Receive configuration from the markdown
- Adapt to the page theme (light/dark)
- Save and restore student data
- Resize dynamically to fit its content

Embed a plugin in markdown:
```markdown
<plugin src="author/plugin-name" height="400"></plugin>
```

## Example: Modular Arithmetic Clock

A visual clock that teaches residue classes — students click numbers and see modular equivalences:

<plugin src="marcchehab/modular-clock" modulus="7" height="450"></plugin>

## Example: Dijkstra's Algorithm

An interactive graph where students step through Dijkstra's shortest-path algorithm:

<plugin src="marcchehab/dijkstra" height="500"></plugin>

> [!info] Building Your Own
> Plugins are just HTML files with a small SDK for theme detection and data persistence. Any teacher can create and share plugins — no server setup needed.

> [!tip] Data Persistence
> Plugin state is automatically saved per student. When they return to the page, their progress is restored — just like code editors.
