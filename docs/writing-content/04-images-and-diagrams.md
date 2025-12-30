# Images and Diagrams

## Adding Images

**Drag and drop**: Drag an image file into the editor. It uploads automatically.

**Markdown syntax**:
```markdown
![Alt text](image.png)
```

**With sizing**:
```markdown
![Alt text](image.png){width=50%}
![Alt text](image.png){width=300px}
```

**With alignment**:
```markdown
![Centered image](image.png){width=50%;align=center}
![Right-aligned](image.png){align=right}
```

## Excalidraw Diagrams

Excalidraw is a hand-drawn style diagramming tool built into Eduskript.

**Creating a diagram**:
1. In the file browser, click **+ New Excalidraw**
2. Draw your diagram
3. Reference it in markdown:

```markdown
![My diagram](diagram.excalidraw)
```

**HTML syntax** (with more options):
```html
<excali src="diagram" alt="My diagram" width="80%" />
```

**Theme support**: Create light and dark versions:
- `diagram.excalidraw.light.svg`
- `diagram.excalidraw.dark.svg`

Eduskript automatically shows the right version based on the reader's theme.

## Supported Formats

| Format | Use case |
|--------|----------|
| PNG, JPG, WebP | Photos, screenshots |
| SVG | Vector graphics, icons |
| GIF | Animations |
| Excalidraw | Editable diagrams |

## Tips

- Use descriptive alt text for accessibility
- Compress large images before uploading
- Excalidraw files remain editable — update diagrams anytime
