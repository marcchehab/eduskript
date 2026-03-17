# Workflow

How to make changes and submit them.

## Quick Version

```bash
# 1. Fork & clone
git clone https://github.com/marcchehab/eduskript

# 2. Branch
git checkout -b feature/my-feature

# 3. Code
# ... make changes ...

# 4. Test
pnpm validate

# 5. Commit
git add .
git commit -m "Add my feature"

# 6. Push & PR
git push origin feature/my-feature
# Open PR on GitHub
```

## Branch Naming

```
feature/add-quiz-component
fix/callout-rendering
docs/update-readme
refactor/simplify-permissions
```

## Before Committing

Run validation:

```bash
pnpm validate  # type-check + lint + test
```

Or the full suite (includes build):

```bash
pnpm pre-push
```

The pre-push hook runs automatically, but running manually catches issues earlier.

## Commit Messages

Keep it simple:

```
Add quiz component for interactive questions
Fix callout not rendering in dark mode
Update setup instructions for Node 22
Refactor permission checks into helper
```

- Start with verb (Add, Fix, Update, Refactor, Remove)
- Be specific
- No period at end

## Pull Request

1. Push your branch
2. Open PR against `main`
3. Fill in the template:
   - What does this change?
   - Why?
   - How to test?
4. Wait for review

## Review Process

- Maintainer reviews code
- Address feedback with new commits
- Once approved, maintainer merges

## After Merge

```bash
git checkout main
git pull
git branch -d feature/my-feature
```
