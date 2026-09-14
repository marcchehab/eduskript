# PhET Simulations

[PhET](https://phet.colorado.edu) (University of Colorado Boulder) publishes around 120 free interactive simulations for physics, chemistry, maths and biology — projectile motion, forces, circuits, derivatives, chemical equations. Almost all of them are translated into German.

## Inserting a simulation

In the editor: **Insert → PhET** (also in the Maths and Chemistry tabs). Search by title in any language ("Wurf", "pendulum", "Ableitung"), filter by subject, pick the sim language and click a thumbnail.

This inserts one line:

```markdown
<phet sim="projectile-motion" locale="de" />
```

<phet sim="projectile-motion" locale="de" />

## Attributes

| Attribute | Meaning |
|---|---|
| `sim` | The sim's slug — the last part of `phet.colorado.edu/en/simulations/<slug>`. Required. |
| `locale` | Sim language (`de`, `en`, `fr`, `it`, …). An untranslated sim falls back to English. |
| `height` | Fixed height in px. By default the sim keeps its 1024×618 layout ratio. |
| `title` | Accessible title for the embed. |

## Licence

The simulations are licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Eduskript embeds them unmodified and adds the required attribution ("PhET Interactive Simulations, University of Colorado Boulder") below every sim automatically.
