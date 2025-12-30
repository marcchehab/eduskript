# Debugging

Namespaced logging system for development and production debugging.

## Quick Start

```typescript
import { createLogger } from '@/lib/logger'

const log = createLogger('myfeature:component')

log('Operation started', { param1, param2 })
log.debug('Debug info')
log.error('Error occurred', error)  // Always shown
```

## Enabling Logs

### Browser

```javascript
// In console:
localStorage.setItem('debug', 'annotations:*')
// Refresh page

// Or use helpers:
enableDebug('annotations:*')
disableDebug()
```

### Server

```bash
DEBUG=annotations:* pnpm dev
```

## Pattern Matching

| Pattern | Matches |
|---------|---------|
| `annotations:*` | All annotation logs |
| `userdata:*` | All user data logs |
| `*` | Everything |
| `a:layer,b:sync` | Multiple specific namespaces |

## Log Levels

| Level | Behavior |
|-------|----------|
| `log()` / `debug()` | Only if namespace enabled |
| `info()` / `warn()` | Only if namespace enabled |
| `error()` | **Always shown** |

## Current Namespaces

| Namespace | Description |
|-----------|-------------|
| `annotations:layer` | Canvas operations, sync |
| `annotations:toolbar` | Toolbar interactions |
| `userdata:provider` | User data context |
| `userdata:sync` | Cloud sync operations |

## Best Practices

- Hierarchical names: `feature:subfeature`
- Log start/end of async operations
- Include context as second argument
- Use `log.error()` for actual errors
- Never log sensitive data

## Annotation Telemetry

Track drawing performance across devices:

| Metric | Meaning |
|--------|---------|
| `durationPerPoint` | Time between samples (lower = smoother) |
| `lengthPerPoint` | Distance between points (lower = denser) |

**Target:** ~200+ Hz sampling (~5ms per point) for good experience.

**View telemetry:**
```bash
curl -s http://localhost:3000/api/debug | jq
curl -s -X DELETE http://localhost:3000/api/debug  # Clear
```

**Current smoothing:** 3-point moving average applied in real-time. Configurable via `REALTIME_SMOOTHING_WINDOW` in `simple-canvas.tsx`.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/logger.ts` | Logger implementation |
| `src/app/api/debug/route.ts` | Debug/telemetry API |
| `src/components/annotations/simple-canvas.tsx` | Stroke telemetry collection |
