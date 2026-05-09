# Flex sections — annotation anchoring test

This page is a repro for the rehype change that treats `<flex>` as a
single annotation section. Inspect any element with `data-section-id` in
devtools to verify the model.

## Baseline (no flex)

Headings and callouts at the top level each get their own section.

> [!note] Standalone callout
> Outside any flex. Should have its own `data-section-id="callout-N"`.

### Subheading outside flex

Plain paragraph between baseline elements.

## Side-by-side: heading + callout

The whole flex below should expose a single `data-section-id="flex-0"`.
The h3 and the callout inside should NOT have `data-section-id`.

<flex gap="medium" align="start">
  <flex-item>

### Left column heading

Some explanatory text in the left column. Annotations drawn across this
row should anchor to the flex, not to whichever child is taller.

  </flex-item>
  <flex-item>

> [!tip] Right-column tip
> Folding/unfolding this should still keep annotations correctly placed
> because the flex itself carries `data-dynamic-height="true"` and an
> end-sentinel sibling.

  </flex-item>
</flex>

## Side-by-side: two callouts

<flex gap="large">
  <flex-item>

> [!success] Lernziele
> - Verify single section ID on the flex.
> - Verify no IDs on the two child callouts.

  </flex-item>
  <flex-item>

> [!warning] Watch out
> Strokes drawn over this row should follow the row when either callout
> folds, not jump to a different column.

  </flex-item>
</flex>

## Nested flex (outer wins)

The outer flex claims the section; the inner flex is skipped along with
the rest of the subtree.

<flex>
  <flex-item>

### Outer left

  </flex-item>
  <flex-item>

<flex direction="column">
  <flex-item>

> [!info] Inner top
> Should not produce its own section.

  </flex-item>
  <flex-item>

> [!quote] Inner bottom
> Also no section ID.

  </flex-item>
</flex>

  </flex-item>
</flex>

## Trailing baseline

A heading after all the flex blocks, to confirm sequential counters
still increment correctly across the page.

> [!example] Trailing callout
> Sits outside any flex; gets `callout-N`.
