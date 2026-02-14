import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const { data: badge } = await client
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')
    .eq('name', 'Multisport')
    .single()

  console.log('Badge:', badge)

  const { data: reqs } = await client
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, nesting_depth, parent_requirement_id, display_order')
    .eq('merit_badge_id', badge!.id)
    .eq('version_year', badge!.requirement_version_year)
    .order('display_order')

  // Build parent ID map
  const idToNum = new Map<string, string>()
  for (const r of reqs || []) {
    idToNum.set(r.id, r.requirement_number)
  }

  // Show all requirements with their hierarchy
  console.log(`\nAll ${reqs?.length} requirements:`)
  for (const r of reqs || []) {
    const indent = '  '.repeat(r.nesting_depth || 0)
    const parentNum = r.parent_requirement_id ? idToNum.get(r.parent_requirement_id) : null
    const headerMark = r.is_header ? ' [H]' : ''
    const parentMark = parentNum ? ` (parent: ${parentNum})` : ''
    console.log(`${indent}${r.requirement_number}${headerMark}${parentMark}: ${r.description?.substring(0, 50)}...`)
  }
}

main()
