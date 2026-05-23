# Coupled video demo

Press play. While **Coupled** (toggle beneath the video), the video pauses at
each mark until you clear the check below it. Flip the toggle to **Unlinked**
and it plays straight through like a normal video. The video stays pinned to the
top as you scroll down to the checks.

<youtube id="dQw4w9WgXcQ" coupled="true" pin="true" />

## Gate 1 — question (mark 0:05)

The video pauses at 0:05 until you answer this correctly.

<question id="q1" type="single" gate-at="0:05">
<answer correct="true">HyperText Markup Language</answer>
<answer correct="false">Hot Mango Tea Latte</answer>
<answer correct="false">High Memory Transfer Layer</answer>
</question>

## Gate 2 — staged coding (marks 0:12 then 0:20)

Two stages on one editor. First make `total` equal **10** and press **Check**
(that clears stage 1 and releases the 0:12 mark). Then make it **20** and press
**Check** again (stage 2, releases the 0:20 mark).

```python editor id="stagedemo"
total = 0
print(total)
```

```python-check for="stagedemo" gate-at="0:12" label="reach 10"
assert total == 10, "total should be 10|stage 1 cleared — nice"
```

```python-check for="stagedemo" gate-at="0:20" label="reach 20"
assert total == 20, "total should be 20|stage 2 cleared — done"
```
