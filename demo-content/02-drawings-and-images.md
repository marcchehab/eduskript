# Drawings and Images

Add visuals to your lessons — from simple images to hand-drawn diagrams with automatic dark mode support.

---

## Images

Drag and drop images into the editor, or use standard markdown:

```markdown
![A descriptive caption](my-image.png)
```

Images support alignment (left, center, right), resizing via drag handles, and the alt text becomes a caption below the image.

## Excalidraw Diagrams

Create hand-drawn style diagrams with [Excalidraw](https://excalidraw.com) — perfect for explaining data structures, algorithms, database schemas, or any concept that benefits from a sketch.

**How it works:**
1. Draw your diagram in Excalidraw
2. Export as SVG in both light and dark variants
3. Upload both files (e.g., `my-diagram.excalidraw.light.svg` and `my-diagram.excalidraw.dark.svg`)
4. Reference it in markdown: `![](my-diagram.excalidraw)`

Eduskript automatically shows the right version based on the student's theme preference — no manual switching.

> [!tip] Schema Diagrams for SQL
> For SQL exercises, name your schema diagram `{database}-schema.excalidraw.light.svg` and Eduskript will automatically display it next to the SQL editor.

> [!example] Use Cases
> - Algorithm flowcharts
> - Database ER diagrams
> - Network topologies
> - UML class diagrams
> - Any concept that's easier to draw than describe
