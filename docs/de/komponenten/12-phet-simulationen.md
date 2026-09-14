# PhET-Simulationen

[PhET](https://phet.colorado.edu) (University of Colorado Boulder) stellt rund 120 freie interaktive Simulationen für Physik, Chemie, Mathematik und Biologie bereit — Wurfbewegung, Kräfte, Stromkreise, Ableitungen, Reaktionsgleichungen. Fast alle sind auf Deutsch übersetzt.

## Simulation einfügen

Im Editor: **Insert → PhET** (auch in den Tabs Maths und Chemistry). Suche nach dem Titel in einer beliebigen Sprache («Wurf», «pendulum», «Ableitung»), filtere nach Fach, wähle die Sprache der Simulation und klicke auf ein Vorschaubild.

Das fügt eine Zeile ein:

```markdown
<phet sim="projectile-motion" locale="de" />
```

<phet sim="projectile-motion" locale="de" />

## Attribute

| Attribut | Bedeutung |
|---|---|
| `sim` | Kennung der Simulation — der letzte Teil von `phet.colorado.edu/de/simulations/<kennung>`. Pflicht. |
| `locale` | Sprache der Simulation (`de`, `en`, `fr`, `it`, …). Ist eine Simulation nicht übersetzt, erscheint sie auf Englisch. |
| `height` | Feste Höhe in px. Standardmässig behält die Simulation ihr Seitenverhältnis von 1024×618. |
| `title` | Zugänglicher Titel für die Einbettung. |

## Lizenz

Die Simulationen stehen unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Eduskript bettet sie unverändert ein und setzt die verlangte Quellenangabe («PhET Interactive Simulations, University of Colorado Boulder») automatisch unter jede Simulation.
