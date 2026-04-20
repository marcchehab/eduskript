import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { config } from 'dotenv'

describe('Database Migrations', () => {
  // Spawns `prisma migrate diff` as a subprocess; cold start + CPU contention
  // from parallel test files regularly exceeds Vitest's 5s default.
  it('migrations are in sync with schema', { timeout: 30_000 }, () => {
    const rootDir = resolve(__dirname, '../..')
    const migrationsDir = resolve(rootDir, 'prisma/migrations')
    const schemaPath = resolve(rootDir, 'prisma/schema.prisma')

    // Load real .env or .env.local (not the test mock)
    const envResult = config({ path: resolve(rootDir, '.env') })
    const envLocalResult = config({ path: resolve(rootDir, '.env.local') })
    const dbUrl = envResult.parsed?.DATABASE_URL || envLocalResult.parsed?.DATABASE_URL

    if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
      throw new Error(
        'DATABASE_URL must be set in .env and must be a PostgreSQL URL.\n' +
        'This test requires a real database to verify migrations.'
      )
    }

    // Derive shadow URL from DATABASE_URL
    const shadowUrl = dbUrl.replace(/\/[^/]+$/, '/eduskript_shadow')

    try {
      // Ensure shadow database exists.
      // Try psql first; if not installed (common in CI/dev without pg client),
      // fall back to docker exec against the local dev container.
      const baseUrl = dbUrl.replace(/\/[^/]+$/, '/postgres')
      const urlMatch = dbUrl.match(/:(\d+)\//)
      const port = urlMatch ? urlMatch[1] : '5432'
      try {
        execSync(
          `psql "${baseUrl}" -c "CREATE DATABASE eduskript_shadow" 2>/dev/null || true`,
          { cwd: rootDir, stdio: 'pipe' }
        )
      } catch {
        // psql not available — try docker exec using the container exposed on this port
        const containerName = process.env.POSTGRES_CONTAINER_NAME ||
          `eduskript-postgres-${port}`
        execSync(
          `docker exec "${containerName}" psql -U postgres -c "CREATE DATABASE eduskript_shadow" 2>/dev/null || true`,
          { cwd: rootDir, stdio: 'pipe' }
        )
      }

      // Compare migrations to schema
      // Exit code 0 = in sync, exit code 2 = differences found
      execSync(
        `DATABASE_URL="${dbUrl}" SHADOW_DATABASE_URL="${shadowUrl}" pnpm prisma migrate diff --from-migrations "${migrationsDir}" --to-schema "${schemaPath}" --exit-code`,
        {
          cwd: rootDir,
          stdio: 'pipe',
          encoding: 'utf-8',
        }
      )
      // If we get here, migrations are in sync
    } catch (error) {
      const execError = error as { status?: number; stdout?: string; stderr?: string }

      if (execError.status === 2) {
        // Get the diff for the error message
        let diff = ''
        try {
          diff = execSync(
            `DATABASE_URL="${dbUrl}" SHADOW_DATABASE_URL="${shadowUrl}" pnpm prisma migrate diff --from-migrations "${migrationsDir}" --to-schema "${schemaPath}"`,
            {
              cwd: rootDir,
              stdio: 'pipe',
              encoding: 'utf-8',
            }
          )
        } catch {
          diff = execError.stdout || execError.stderr || 'Could not get diff'
        }

        expect.fail(
          `Migrations are out of sync with schema!\n\n` +
          `Create a migration with:\n` +
          `  pnpm prisma migrate dev --name <migration_name>\n\n` +
          `Or manually create one in prisma/migrations/\n\n` +
          `Diff:\n${diff}`
        )
      }

      // Other error (exit code 1)
      throw error
    }
  })
})
