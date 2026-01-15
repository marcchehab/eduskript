## Erklärvideo

![](sql-joins.mp4)

## Datenbank-Schema

Stellen wir uns im Folgenden vor, wir hätten zwei Tabellen mit folgenden Daten, die wir anhand der Gebäudenamen zusammenführen möchten.

<flex>
<flex-item>

### `buildings`

|building_name|capacity|
|---|---|
|1e|24|
|1w|32|
|2e|16|
|2w|20|

</flex-item>

<flex-item>

### `employees`

|role|name|building|years_employed|
|---|---|---|---|
|Engineer|Becky A.|1e|4|
|Engineer|Dan B.|1e|2|
|Engineer|Sharon F.|1e|6|
|Manager|Shirlee M.|1e|3|
|Artist|Sherman D.|2w|8|
|Manager|Daria O.|2w|6|
|Artist|Jakob J.|3e|6|
|Artist|Brandon J.|3e|7|

</flex-item>
</flex>

Bei Datenbanken hat jede dieser Spalten einen **fixen Datentypen**. Man würde diese in einem sogenannten Schema darstellen, das so aussehen könnte:

<image src="schema-employees-buildings.excalidraw" width="50%" />

Einige Beobachtungen, damit Sie sehen, was hier alles dargestellt ist:
- Boxen: Es gibt eine Tabelle `buildings` mit den Spalten `building_name` und `capacity`, sowie eine Tabelle `employees` mit den Spalten `role`, `name`, `building` und `years_employed`.
- Datentypen rechts: Die Spalte `capacity` hat den Datentyp `INTEGER` und enthält demnach Ganzzahlen. Die Spalte `building_name` hat den Datentyp `TEXT` und speichert Zeichenketten. (Sie müssen die SQL-Datentypen nicht lernen.)
- Pfeil: Die Tabelle `employees` hat eine Relation mit der Tabelle `buildings`. Genauer: Die Daten in der Spalte `building` in der Tabelle `employees` entsprechen den Daten in der Spalte `building_name` in der Tabelle `buildings`. Das Datenbanksystem kann solche Beziehungen überwachen und je nach Konfiguration sicherstellen, dass es keine Mitarbeiter geben kann, die einem Gebäude zugeordnet sind, das in der Tabelle `buildings` gar nicht existiert.
- Schlüssel: Die Tabelle `buildings` hat eine Spalte `building_name` als **Primärschlüssel**. Das bedeutet, dass jeder Datensatz der Tabelle anhand von `building_name` eindeutig identifiziert werden kann. Ebenso hat `employees` die Spalte `name` als Primärschlüssel definiert. Das Datenbanksystem garantiert uns, dass es keine zwei Gebäude mit dem gleichen Namen oder zwei Angestellte mit exakt demselben Namen geben wird. (Das ist ganz offensichtlich keine sehr intelligente Wahl des Primärschlüssels...)
- Beziehungstyp: Die Beziehung zwischen `buildings` und `employees` ist eine **1:n-Beziehung** (one-to-many). Ein Gebäude kann mehrere Mitarbeiter haben, aber jeder Mitarbeiter arbeitet in genau einem Gebäude (oder in keinem, falls NULL erlaubt ist).

Mit SQL können Sie dem Datenbanksystem die mühselige Arbeit überlassen, diese Daten zusammenzuführen. Dazu brauchen Sie die JOIN-Befehlen, von denen es mehrere Varianten gibt. Ein Tipp: Wenn Sie sich die Gebäudenamen in einem Venn-Diagramm vorstellen, sind die Befehle einfacher verständlich.

<tabs-container data-items='["JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN"]'>
<tab-item>

<image src="02-joins-inner.excalidraw" width="50%" />

Gibt nur die Zeilen zurück, bei denen es in **beiden Tabellen** eine Übereinstimmung gibt. `INNER` ist optional und ist nur vorhanden, damit Datenbanken auch mit früheren Versionen von SQL kompatibel bleiben.

```sql
SELECT *
FROM buildings
JOIN employees ON building_name = building;
```

</tab-item>
<tab-item>

<image src="02-joins-left.excalidraw" width="50%" />

Gibt alle **Zeilen aus `buildings`** zurück und ergänzt sie mit `employees`. Falls keine Übereinstimmung existiert, wird `NULL` eingetragen.

```sql
SELECT *
FROM buildings
LEFT JOIN employees ON building_name = building;
```

</tab-item>
<tab-item>

<image src="02-joins-right.excalidraw" width="50%" />

Gibt alle **Zeilen aus `employees`** zurück und ergänzt sie mit `buildings`. Falls keine Übereinstimmung existiert, wird `NULL` eingetragen.

```sql
SELECT *
FROM buildings
RIGHT JOIN employees ON building_name = building;
```

</tab-item>
<tab-item>

<image src="02-joins-full.excalidraw" width="50%" />

Gibt alle Zeilen aus **beiden Tabellen** zurück. Falls keine Übereinstimmung existiert, wird `NULL` eingetragen.

```sql
SELECT *
FROM buildings
FULL JOIN employees ON building_name = building;
```

</tab-item>
</tabs-container>
