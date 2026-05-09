# Dynamic-height repro page

Page focused on variable-height components — foldable callouts, code editors, plugins — so we can verify annotation alignment when those elements expand/collapse, and that annotations on them disappear when the element is folded or removed.

## Foldable callout (open by default)

Draw something on the callout below, fold it, unfold it. Annotations should hide while folded and reappear unchanged when unfolded.

> [!tip]+ Open foldable
> This callout starts open. The plus sign keeps it expanded; clicking the title bar toggles it.
> 
> Try drawing a circle around this paragraph. Fold the callout. Unfold it. The circle should disappear and reappear at the same screen position.
> 
> Bonus: with the callout open, draw something *just below* the callout's bottom edge. That stroke is anchored to `callout-N-end` and should follow the callout's bottom as it expands and contracts.

Some prose between the two callouts. Draw across these lines and the callouts to stress the section boundaries.

## Foldable callout (collapsed by default)

> [!warning]- Closed foldable
> This callout starts closed. Click the title to open it.
> 
> Then draw something inside, fold it again, unfold. Should match the open-by-default behavior.

## Code editor (resizable via console output)

Run the Python below — printing more lines makes the editor's output panel grow, which exercises the dynamic-height path the same way callouts do. Draw something next to the editor first, then run, and verify the stroke below follows.

```python editor
for i in range(5):
    print(f"line {i}")
```

A few lines of prose so there's space below the editor for annotations.

```sql editor db="netflix.db"
SELECT * FROM tv_show LIMIT 5;
```

## Section dividers in dense order

Three short paragraphs with no callouts/editors, just to give plenty of stroke-anchor surface area.

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

## Edit-the-markdown delete test

To test the "markdown-removed element → annotations dropped" path: open this page in the editor, draw something on the callout below, save, then edit the markdown to remove the entire callout block. The stroke's stored data persists but should not render anywhere. Re-add the callout (with the same position in the markdown) and the stroke should reappear.

> [!info]+ Removable callout
> Edit-target. Delete this entire block from the markdown to test orphan-suppression.
