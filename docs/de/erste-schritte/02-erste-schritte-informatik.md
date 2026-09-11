# Erste Schritte: Informatik

Code-Editoren, die sich selbst bewerten, Turtle-Grafik, SQL gegen eine echte Datenbank, Live-HTML und interaktive Plugins. Alles unten läuft im Browser. Probiere jedes Beispiel aus. Der Quelltext ist unter jedem Beispiel einen Klick entfernt.

## Eine Funktion, automatisch bewertet

Schreibe `is_even(n)` so, dass sie für gerade Zahlen `True` zurückgibt. Drücke **Run**, dann **Check**.

```python editor id="even-odd"
def is_even(n):
    # dein Code hier
    pass
```

```python-check for="even-odd" points="10"
assert is_even(4) == True, "is_even(4) sollte True sein"
assert is_even(7) == False, "is_even(7) sollte False sein"
assert is_even(0) == True, "is_even(0) sollte True sein"
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```python editor id="even-odd"
> def is_even(n):
>     # dein Code hier
>     pass
> ```
>
> ```python-check for="even-odd" points="10"
> assert is_even(4) == True, "is_even(4) sollte True sein"
> assert is_even(7) == False, "is_even(7) sollte False sein"
> assert is_even(0) == True, "is_even(0) sollte True sein"
> ```
> ````

Im `editor`-Block schreiben die Schülerinnen und Schüler ihren Code und führen ihn aus. Der `python-check`-Block ist für sie unsichtbar und läuft, wenn sie auf Check klicken. Jedes `assert` ist ein Test, seine Meldung ist das, was der Schüler sieht. Füge dem Editor `exam` hinzu, und die Checks laufen still, für eine echte Prüfung.

## Turtle-Grafik, bewertet gegen deine Lösung

Zeichne eine 3-stufige Treppe aus drei 30×30-Quadraten mit den Linienfarben rot, gelb, grün. Drücke **Run** und **Check**.

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
assert turtle_solution_matches(solution), "Zeichne eine 3-stufige Treppe aus drei 30×30-Quadraten."
assert turtle_solution_matches(solution, match_colors=True), "Die Farben stimmen mit rot, gelb, grün überein."
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```python editor id="stairs-3"
> import turtle
> t = turtle.Turtle()
> # Schüler-Code
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
> assert turtle_solution_matches(solution), "Zeichne eine 3-stufige Treppe aus drei 30×30-Quadraten."
> assert turtle_solution_matches(solution, match_colors=True), "Die Farben stimmen mit rot, gelb, grün überein."
> ```
> ````

Die Lösung schreibst du selbst in Turtle. Der Check vergleicht die gezeichnete Figur, nicht den Code, also besteht auch ein Schüler, der an einer anderen Ecke beginnt oder gegen den Uhrzeigersinn zeichnet.

## SQL gegen eine echte Datenbank

Frage die **10 tanzbarsten Genres** in `spotify.db` ab: wähle `name` aus `genres` und die durchschnittliche `danceability` der zugehörigen Tracks als `avg_danceability`. Drücke **Run**.

```sql editor db="spotify.db" solution="SELECT g.name AS genre, ROUND(AVG(t.danceability), 3) AS avg_danceability FROM genres g JOIN track_genres tg ON g.genre_id = tg.genre_id JOIN tracks t ON tg.track_id = t.track_id GROUP BY g.name ORDER BY avg_danceability DESC LIMIT 10;"
-- Schülerantwort:
SELECT g.name AS genre,
       ROUND(AVG(t.danceability), 3) AS avg_danceability
FROM genres g
JOIN track_genres tg ON g.genre_id = tg.genre_id
JOIN tracks t        ON tg.track_id = t.track_id
GROUP BY g.name
ORDER BY avg_danceability DESC
LIMIT 10;
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```sql editor db="spotify.db" solution="SELECT g.name AS genre, ROUND(AVG(t.danceability), 3) AS avg_danceability FROM genres g JOIN track_genres tg ON g.genre_id = tg.genre_id JOIN tracks t ON tg.track_id = t.track_id GROUP BY g.name ORDER BY avg_danceability DESC LIMIT 10;"
> -- Schülerantwort:
> SELECT ...
> ```
> ````

Lade eine `.db`-Datei einmal hoch. Jeder Schüler bekommt seine eigene Kopie im Browser, also tut `DROP TABLE` niemandem weh. Das Schema-Diagramm neben dem Editor wird automatisch aus einer Datei namens `spotify-schema.excalidraw.light.svg` übernommen.

## Plots und Live-Daten

Python im Browser enthält matplotlib und kann öffentliche APIs aufrufen. Dieses Beispiel plottet alle Erdbeben mit Magnitude 4 oder mehr aus den letzten 7 Tagen. Klicke auf **Show code**, um den Code zu sehen und zu ändern.

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

> [!code]- Quelltext anzeigen
> ````markdown
> ```python editor id="quake-7" output-only height="500"
> from pyodide.http import pyfetch
> import matplotlib.pyplot as plt
> ...
> plt.show()
> ```
> ````

`output-only` führt den Code beim Laden der Seite einmal aus und zeigt nur den Plot. Schüler können den Code öffnen, ändern und erneut ausführen.

## Die Ausgabe vorhersagen

Die Schülerinnen und Schüler tippen ein, was das Programm ihrer Meinung nach ausgibt, und drücken dann **Check answer**. Die Antwort wird Zeile für Zeile verglichen, mit Teilpunkten und einem Diff.

```python
for i in range(3):
    print(i * 2)
print("Done!")
```

<question id="predict-loop" type="text" points="2">
Was gibt dieses Programm aus?

```expected
0
2
4
Done!
```
</question>

> [!code]- Quelltext anzeigen
> ````markdown
> ```python
> for i in range(3):
>     print(i * 2)
> print("Done!")
> ```
>
> <question id="predict-loop" type="text" points="2">
> Was gibt dieses Programm aus?
>
> ```expected
> 0
> 2
> 4
> Done!
> ```
> </question>
> ````

Für eine Prüfung setzt du eine `<next-stage>`-Zeile zwischen die Vorhersage und einen ausführbaren Editor. Die Schüler müssen die Vorhersage abgeben, bevor der Editor erscheint, damit niemand den Code ausführt, um die Antwort zu erhalten. Auf Prüfungsseiten gibt es keinen Check-Button; der Diff erscheint auf der zurückgegebenen Prüfung.

## HTML mit Live-Vorschau

Die Seite rechts wird beim Tippen neu gerendert. Ändere die Farbe.

```html editor height="260"
<style>h1 { color: crimson }</style>
<h1>Hello</h1>
<button onclick="alert('Click!')">Click me</button>
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```html editor height="260"
> <style>h1 { color: crimson }</style>
> <h1>Hello</h1>
> <button onclick="alert('Click!')">Click me</button>
> ```
> ````

## Plugins

Interaktive Werkzeuge, die du mit einer Zeile in eine Seite einfügst. Unten ist ein Visualizer für Dijkstras Kürzeste-Wege-Algorithmus. **Drücke Play.**

<plugin src="informatikgarten/dijkstra-visualizer" lang="de" initialdirected="false" initialnodecount="7" initialspeed="2000" />

Und ein Werkzeug, mit dem Schüler ihren eigenen EAN-13-Barcode entwerfen und codieren. Drücke **Play demo**.

<plugin src="informatikgarten/barcode-editor" />

> [!code]- Quelltext anzeigen
> ```html
> <plugin src="informatikgarten/dijkstra-visualizer" lang="de" initialnodecount="7" initialspeed="2000" />
>
> <plugin src="informatikgarten/barcode-editor" />
> ```

Du brauchst ein Widget, das es noch nicht gibt? Beschreibe es einem KI-Agenten und veröffentliche es als Plugin. Beide Werkzeuge oben sind so entstanden.

## Weiter

Die vollständige Referenz für Editoren, Checks und Bewertung findest du unter [Code-Editoren und Bewertung](https://eduskript.org/c/komponenten/code-editoren-und-bewertung). Oder schau dir die anderen Fächer an: [Mathematik](https://eduskript.org/c/erste-schritte/erste-schritte-mathematik), [Chemie](https://eduskript.org/c/erste-schritte/erste-schritte-chemie).

<cta href="/auth/signup">Gratis Konto erstellen</cta>
