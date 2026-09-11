# First Steps: Computer Science

Code editors that grade themselves, turtle graphics, SQL against a real database, live HTML, and interactive plugins. Everything below runs in the browser. Try each one. The source is one click away under each example.

## A function, graded

Write `is_even(n)` so that it returns `True` for even numbers. Press **Run**, then **Check**.

```python editor id="even-odd"
def is_even(n):
    # your code here
    pass
```

```python-check for="even-odd" points="10"
assert is_even(4) == True, "is_even(4) should be True"
assert is_even(7) == False, "is_even(7) should be False"
assert is_even(0) == True, "is_even(0) should be True"
```

> [!code]- Show source
> ````markdown
> ```python editor id="even-odd"
> def is_even(n):
>     # your code here
>     pass
> ```
>
> ```python-check for="even-odd" points="10"
> assert is_even(4) == True, "is_even(4) should be True"
> assert is_even(7) == False, "is_even(7) should be False"
> assert is_even(0) == True, "is_even(0) should be True"
> ```
> ````

The `editor` block is where students write and run code. The `python-check` block is invisible to them and runs when they click Check. Each `assert` is one test, its message is what the student sees. Add `exam` to the editor and the checks run silently, for a real exam.

## Turtle graphics, graded against your solution

Draw a 3-step stairs made of three 30×30 squares with line colors red, yellow, green. Press **Run** and **Check**.

```python editor id="stairs-3"
import turtle
t = turtle.Turtle()

for square in ["red", "orange", "green"]:
    t.color(square)
    for side in range(6):
        t.forward(30)
        t.left(90)
    t.left(180)
```

```python-check for="stairs-3"
solution = """
import turtle
t = turtle.Turtle()

for square in ["red", "yellow", "green"]:
    t.color(square)
    for side in range(6):
        t.forward(30)
        t.left(90)
    t.left(180)
"""
assert turtle_solution_matches(solution), "Draw a 3-step stairs of three 30×30 squares."
assert turtle_solution_matches(solution, match_colors=True), "Colors match red, yellow, green."
```

> [!code]- Show source
> ````markdown
> ```python editor id="stairs-3"
> import turtle
> t = turtle.Turtle()
> # student code
> ```
>
> ```python-check for="stairs-3"
> solution = """
> import turtle
> t = turtle.Turtle()
>
> for square in ["red", "yellow", "green"]:
>     t.color(square)
>     for side in range(6):
>         t.forward(30)
>         t.left(90)
>     t.left(180)
> """
> assert turtle_solution_matches(solution), "Draw a 3-step stairs of three 30×30 squares."
> assert turtle_solution_matches(solution, match_colors=True), "Colors match red, yellow, green."
> ```
> ````

You write the solution in turtle yourself. The check compares the drawn figure, not the code, so a student who starts at a different corner or draws counter-clockwise still passes.

## SQL against a real database

Query the **top 10 most danceable genres** in `spotify.db`: select `name` from `genres` and the average `danceability` of its tracks as `avg_danceability`. Press **Run**.

```sql editor db="spotify.db" solution="SELECT g.name AS genre, ROUND(AVG(t.danceability), 3) AS avg_danceability FROM genres g JOIN track_genres tg ON g.genre_id = tg.genre_id JOIN tracks t ON tg.track_id = t.track_id GROUP BY g.name ORDER BY avg_danceability DESC LIMIT 10;"
-- Student answer:
SELECT g.name AS genre,
       ROUND(AVG(t.danceability), 3) AS avg_danceability
FROM genres g
JOIN track_genres tg ON g.genre_id = tg.genre_id
JOIN tracks t        ON tg.track_id = t.track_id
GROUP BY g.name
ORDER BY avg_danceability DESC
LIMIT 10;
```

> [!code]- Show source
> ````markdown
> ```sql editor db="spotify.db" solution="SELECT g.name AS genre, ROUND(AVG(t.danceability), 3) AS avg_danceability FROM genres g JOIN track_genres tg ON g.genre_id = tg.genre_id JOIN tracks t ON tg.track_id = t.track_id GROUP BY g.name ORDER BY avg_danceability DESC LIMIT 10;"
> -- Student answer:
> SELECT ...
> ```
> ````

Upload a `.db` file once. Every student gets their own copy in the browser, so `DROP TABLE` hurts nobody. The schema diagram next to the editor is picked up automatically from a file named `spotify-schema.excalidraw.light.svg`.

## Plots and live data

Python in the browser includes matplotlib and can call public APIs. This plots all earthquakes of magnitude 4 or more from the last 7 days. Click **Show code** to see and change it.

```python editor id="quake-7" output-only height="500"
from pyodide.http import pyfetch
import matplotlib.pyplot as plt

QUAKE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"
LAND_URL  = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
PLATE_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json"

quakes = await (await pyfetch(QUAKE_URL)).json()
land   = await (await pyfetch(LAND_URL)).json()
plates = await (await pyfetch(PLATE_URL)).json()

strong = [f for f in quakes["features"]
          if f["properties"]["mag"] is not None and f["properties"]["mag"] >= 4.0]

lons  = [f["geometry"]["coordinates"][0] for f in strong]
lats  = [f["geometry"]["coordinates"][1] for f in strong]
mags  = [f["properties"]["mag"]          for f in strong]
sizes = [10 * (m ** 2) for m in mags]

fig, ax = plt.subplots(figsize=(13, 6.5))
ax.set_facecolor("#cfe0eb")

for feature in land["features"]:
    geom = feature["geometry"]
    polygons = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polygons:
        outer = poly[0]
        ax.fill([c[0] for c in outer], [c[1] for c in outer],
                facecolor="#e8d9b0", edgecolor="#a89870", linewidth=0.4)

for feature in plates["features"]:
    coords = feature["geometry"]["coordinates"]
    ax.plot([c[0] for c in coords], [c[1] for c in coords],
            color="#444", linewidth=0.8, alpha=0.7)

ax.scatter(lons, lats, s=sizes, color="#d63031",
           alpha=0.7, edgecolor="black", linewidth=0.3)

ax.set_xlim(-180, 180)
ax.set_ylim(-90, 90)
ax.set_aspect("equal")
ax.set_title(f"Earthquakes (M ≥ 4) and plate boundaries, last 7 days ({len(strong)} quakes)")
ax.set_xlabel("Longitude")
ax.set_ylabel("Latitude")
plt.show()
```

> [!code]- Show source
> ````markdown
> ```python editor id="quake-7" output-only height="500"
> from pyodide.http import pyfetch
> import matplotlib.pyplot as plt
> ...
> plt.show()
> ```
> ````

`output-only` runs the code once on page load and shows just the plot. Students can open the code, change it, and rerun.

## Predict the output

Students type what they think the program prints, then press **Check answer**. The answer is compared line by line, with partial credit and a diff.

```python
for i in range(3):
    print(i * 2)
print("Done!")
```

<question id="predict-loop" type="text" points="2">
What does this program print?

```expected
0
2
4
Done!
```
</question>

> [!code]- Show source
> ````markdown
> ```python
> for i in range(3):
>     print(i * 2)
> print("Done!")
> ```
>
> <question id="predict-loop" type="text" points="2">
> What does this program print?
>
> ```expected
> 0
> 2
> 4
> Done!
> ```
> </question>
> ````

For an exam, put a `<next-stage>` line between the prediction and a runnable editor. Students must hand in the prediction before the editor appears, so nobody runs the code to get the answer. On exam pages there is no Check button; the diff appears on the returned exam.

## HTML with live preview

The page on the right re-renders as you type. Change the color.

```html editor height="260"
<style>h1 { color: crimson }</style>
<h1>Hello</h1>
<button onclick="alert('Click!')">Click me</button>
```

> [!code]- Show source
> ````markdown
> ```html editor height="260"
> <style>h1 { color: crimson }</style>
> <h1>Hello</h1>
> <button onclick="alert('Click!')">Click me</button>
> ```
> ````

## Plugins

Interactive tools you drop into a page with one line. Below is a Dijkstra shortest-path visualizer. **Press Play.**

<plugin src="informatikgarten/dijkstra-visualizer" lang="en" initialdirected="false" initialnodecount="7" initialspeed="2000" />

And a tool where students design and encode their own EAN-13 barcode. Press **Play demo**.

<plugin src="informatikgarten/barcode-editor" />

> [!code]- Show source
> ```html
> <plugin src="informatikgarten/dijkstra-visualizer" lang="en" initialnodecount="7" initialspeed="2000" />
>
> <plugin src="informatikgarten/barcode-editor" />
> ```

Need a widget that does not exist yet? Describe it to an AI agent and publish it as a plugin. Both tools above were built that way.

## Next

The full reference for editors, checks and scoring is under [Code Editors & Scoring](https://eduskript.org/en/components/code-editors-and-scoring). Or look at the other subjects: [Mathematics](https://eduskript.org/en/first-steps/first-steps-mathematics), [Chemistry](https://eduskript.org/en/first-steps/first-steps-chemistry).

<cta href="/auth/signup">Create free account</cta>
