import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)
const fixturePath = path.join(
  repoRoot,
  'tests/fixtures/lint/bad-single-on-unit-memberships.ts'
)
const RULE_ID = 'custom/no-single-on-unit-memberships'

describe('custom/no-single-on-unit-memberships', () => {
  let eslint: ESLint

  beforeAll(() => {
    // The rule's fixture lives under `tests/fixtures/lint/` which is in the
    // project's ignore list. `errorOnUnmatchedPattern: false` lets us point
    // ESLint at the ignored path; `--no-ignore` semantics via the API are
    // achieved by passing `ignore: false`.
    eslint = new ESLint({
      cwd: repoRoot,
      ignore: false,
    })
  })

  it('fires on .single() on a chain that includes from(unit_memberships)', async () => {
    const results = await eslint.lintFiles([fixturePath])
    expect(results).toHaveLength(1)
    const violations = results[0].messages.filter((m) => m.ruleId === RULE_ID)
    // Two intentionally bad functions in the fixture.
    expect(violations.length).toBe(2)
    expect(violations.every((v) => v.severity === 2)).toBe(true)
    expect(violations[0].message).toMatch(/getCurrentMembership/)
  })

  it('does not fire on .single() on other tables', async () => {
    const code = `
      declare const supabase: { from(t: string): { select(c: string): { eq(k: string, v: unknown): { single(): Promise<unknown> } } } }
      export async function ok() {
        return supabase.from('profiles').select('id').eq('user_id', 'x').single()
      }
    `
    const results = await eslint.lintText(code, {
      filePath: path.join(repoRoot, 'tests/fixtures/lint/inline.ts'),
    })
    const violations = results[0].messages.filter((m) => m.ruleId === RULE_ID)
    expect(violations.length).toBe(0)
  })

  it('does not fire on from(unit_memberships) without .single()', async () => {
    const code = `
      declare const supabase: { from(t: string): { select(c: string): { eq(k: string, v: unknown): unknown } } }
      export async function ok() {
        return supabase.from('unit_memberships').select('unit_id').eq('profile_id', 'x')
      }
    `
    const results = await eslint.lintText(code, {
      filePath: path.join(repoRoot, 'tests/fixtures/lint/inline.ts'),
    })
    const violations = results[0].messages.filter((m) => m.ruleId === RULE_ID)
    expect(violations.length).toBe(0)
  })
})
