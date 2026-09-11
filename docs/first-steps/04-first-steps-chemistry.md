# First Steps: Chemistry

Structural formulas from SMILES, reaction equations, mechanisms sketched by hand and checked by AI, quiz questions, curves, and calculations in Python. Try each one. The source is one click away under each example.

## Structural formulas

<molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Caffeine" />

> [!code]- Show source
> ```html
> <molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Caffeine" />
> ```

Copy the SMILES string from PubChem or ChemDraw. The result is a plain image, so students can draw on it with a pen.

## Reaction equations

$$\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}$$

$$\ce{2 H2O(l) <=> H3O+ + OH-}$$

> [!code]- Show source
> ```markdown
> $$\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}$$
>
> $$\ce{2 H2O(l) <=> H3O+ + OH-}$$
> ```

Arrows, states of matter, charges, all inside `\ce{}`. Regular math works the same way: inline like pH $= -\log_{10}[\text{H}^+]$, or on its own line:

$$c = \frac{n}{V}$$

## Label a structural formula, checked by AI

**Mark the carboxylic acid and the ester group** on the aspirin molecule with a pen, then press the button. The AI sees your drawing together with the exercise text.

<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />

<ai-feedback label="Check my labels" prompt="Check whether the carboxylic acid and ester groups on this structural formula of aspirin are correctly marked. Point out what is wrong without marking the groups yourself." />

> [!code]- Show source
> ```html
> <molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />
>
> <ai-feedback label="Check my labels" prompt="Check whether the carboxylic acid and ester groups on this structural formula of aspirin are correctly marked. Point out what is wrong without marking the groups yourself." />
> ```

## Sketch a reaction mechanism, checked by AI

**Sketch the SN2 mechanism** for bromoethane reacting with hydroxide ions in the area below, then press the button.

<spacer id="sn2-work" pattern="checkered" height="240" />

<ai-feedback label="Check my mechanism" prompt="Check whether the electron-pushing arrows for the SN2 reaction of bromoethane with hydroxide ions are correct and whether the mechanism leads to ethanol as the product. Point out the first error without drawing the mechanism yourself." />

> [!code]- Show source
> ```html
> <spacer pattern="checkered" height="240" />
>
> <ai-feedback label="Check my mechanism" prompt="Check whether the electron-pushing arrows for the SN2 reaction of bromoethane with hydroxide ions are correct and whether the mechanism leads to ethanol as the product." />
> ```

The prompt is yours. Students never see it, only the feedback.

## Quiz questions

<question id="caffeine-n" type="single" points="1">
How many nitrogen atoms does caffeine contain?
<answer feedback="Count the N atoms in the ring system again.">2</answer>
<answer correct="true">4</answer>
<answer feedback="That is more than the structure has.">6</answer>
</question>

> [!code]- Show source
> ```html
> <question id="caffeine-n" type="single" points="1">
> How many nitrogen atoms does caffeine contain?
> <answer feedback="Count the N atoms in the ring system again.">2</answer>
> <answer correct="true">4</answer>
> <answer feedback="That is more than the structure has.">6</answer>
> </question>
> ```

The student picks, presses Check, sees the result, and the question locks. Add `attempts="3"` for three tries. On an exam page there is no Check button; answers are handed in with the exam and marked on return.

## A number, graded with a tolerance

<question id="ph-hcl" type="number" points="2" attempts="2" minValue="0" maxValue="14" step="0.1" expected="2" tolerance="0.2">
What is the pH of a 0.01 mol/l hydrochloric acid solution?
<answer from="1" feedback="Correct. HCl is a strong acid, so $[\text{H}^+] = 0.01$ and pH $= -\log_{10}(0.01) = 2$."></answer>
<answer from="0.6" feedback="Close. HCl dissociates completely, so $[\text{H}^+] = 0.01$ mol/l."></answer>
<answer feedback="Not yet. pH $= -\log_{10}[\text{H}^+]$, and HCl dissociates completely."></answer>
</question>

> [!code]- Show source
> ```html
> <question id="ph-hcl" type="number" points="2" attempts="2" minValue="0" maxValue="14" step="0.1" expected="2" tolerance="0.2">
> What is the pH of a 0.01 mol/l hydrochloric acid solution?
> <answer from="1" feedback="Correct. HCl is a strong acid, so $[\text{H}^+] = 0.01$ and pH $= -\log_{10}(0.01) = 2$."></answer>
> <answer from="0.6" feedback="Close. HCl dissociates completely, so $[\text{H}^+] = 0.01$ mol/l."></answer>
> <answer feedback="Not yet. pH $= -\log_{10}[\text{H}^+]$, and HCl dissociates completely."></answer>
> </question>
> ```

## Curves

Titration curves, reaction rates, decay curves. Written the way you would write them on paper.

```plot
f(x) = 14 - 14/(1+e^(-(x-25)))
x: 0..50
y: 0..14
caption: Titration curve, strong acid with strong base
```

> [!code]- Show source
> ````markdown
> ```plot
> f(x) = 14 - 14/(1+e^(-(x-25)))
> x: 0..50
> y: 0..14
> caption: Titration curve, strong acid with strong base
> ```
> ````

## Calculations in Python

Stoichiometry that checks itself. Complete the function, then press **Run** and **Check**.

```python editor id="molar-mass"
def molar_mass_water():
    # H2O: 2 x H (1.008) + 1 x O (15.999)
    pass

print(molar_mass_water())
```

```python-check for="molar-mass" points="5"
assert abs(molar_mass_water() - 18.015) < 0.01, "molar mass of water should be about 18.015 g/mol"
```

> [!code]- Show source
> ````markdown
> ```python editor id="molar-mass"
> def molar_mass_water():
>     pass
> ```
>
> ```python-check for="molar-mass" points="5"
> assert abs(molar_mass_water() - 18.015) < 0.01, "molar mass of water should be about 18.015 g/mol"
> ```
> ````

## Next

The full list of components is in the [Components overview](https://eduskript.org/en/components/overview). Or look at the other subjects: [Computer Science](https://eduskript.org/en/first-steps/first-steps-computer-science), [Mathematics](https://eduskript.org/en/first-steps/first-steps-mathematics).

<cta href="/auth/signup">Create free account</cta>
