// Fixture file for the custom ESLint rule
// `custom/no-single-on-unit-memberships`. This file is intentionally
// excluded from the project's normal lint pass via `tests/fixtures/lint/*`
// in `eslint.config.mjs` ignores. It is only ever linted by the unit test
// at `tests/unit/lint/no-single-on-unit-memberships.test.ts`, which uses
// the ESLint API directly to assert the rule fires.

interface FixtureFilterChain {
  eq(col: string, val: unknown): FixtureFilterChain
  single(): Promise<unknown>
}

declare const supabase: {
  from(table: string): {
    select(columns: string): FixtureFilterChain
  }
}

export async function bad() {
  // This must trip the rule.
  return supabase.from('unit_memberships').select('unit_id').eq('profile_id', 'x').single()
}

export async function alsoBad() {
  // Multi-step chain — rule must walk down the object chain to find `.from`.
  return supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', 'x')
    .eq('status', 'active')
    .single()
}

export async function ok1() {
  // .single() on a different table is fine.
  return supabase.from('profiles').select('id').eq('user_id', 'x').single()
}

export async function ok2() {
  // .from('unit_memberships') without .single() is fine — that's the
  // helper's pattern (fetch all, then filter in JS).
  return supabase.from('unit_memberships').select('unit_id').eq('profile_id', 'x')
}
