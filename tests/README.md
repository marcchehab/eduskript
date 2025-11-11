# Test Infrastructure

This directory contains the automated test suite for Eduskript.

## Overview

We use **Vitest** as our test runner with **@testing-library/react** for component testing. The test infrastructure is designed to be fast, reliable, and easy to extend.

## Test Structure

```
tests/
├── setup.ts              # Global test setup and mocks
├── lib/                  # Unit tests for utility functions
│   ├── utils.test.ts
│   └── permissions.test.ts
├── components/           # Component tests
│   └── ui/
│       └── button.test.tsx
└── api/                  # API route tests
    └── health.test.ts
```

## Running Tests

```bash
# Run tests in watch mode
pnpm test

# Run tests once
pnpm test:run

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

## Writing Tests

### Unit Tests

Test utility functions and business logic in isolation:

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from '@/lib/myModule'

describe('myModule', () => {
  it('should do something', () => {
    expect(myFunction()).toBe(expected)
  })
})
```

### Component Tests

Test React components using @testing-library/react:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MyComponent } from '@/components/MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

### API Tests

Test API routes with mocked requests:

```typescript
import { describe, it, expect } from 'vitest'

describe('API /api/myroute', () => {
  it('should return expected data', async () => {
    // Test implementation
  })
})
```

## Test Coverage

Coverage reports are generated in the `coverage/` directory. Aim for:
- **80%+ overall coverage**
- **100% coverage for critical paths** (permissions, authentication, data mutations)

## Mocks and Setup

Global mocks are configured in `tests/setup.ts`:
- Next.js router
- NextAuth
- Environment variables
- Next/Image component

## Best Practices

1. **Test behavior, not implementation** - Focus on what the code does, not how it does it
2. **Write descriptive test names** - Use "should..." format
3. **Keep tests independent** - Each test should run in isolation
4. **Use data-testid sparingly** - Prefer accessible queries (getByRole, getByText)
5. **Mock external dependencies** - Don't make real API calls or database queries
6. **Test edge cases** - Include tests for error states and boundary conditions

## CI/CD Integration

Tests run automatically on:
- Every push to main/develop branches
- Every pull request

The CI workflow (.github/workflows/ci.yml) runs:
1. Linting
2. Type checking
3. Unit tests
4. Build verification

## Adding New Tests

1. Create a test file next to the code you're testing (or in the tests/ directory)
2. Import necessary testing utilities
3. Write your tests following the existing patterns
4. Run tests locally to verify
5. Commit and push - CI will run tests automatically

## Troubleshooting

**Tests failing with "Cannot find module"**
- Check your import paths use the `@/` alias
- Ensure vitest.config.ts has correct path aliases

**Component tests failing**
- Check that you've imported from '@testing-library/react'
- Verify global mocks in setup.ts are correct

**Async tests timing out**
- Use `await waitFor()` for async operations
- Increase timeout if needed: `it('test', async () => {...}, 10000)`
