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
    .eq('name', 'Cycling')
    .single()

  console.log('Badge:', badge)

  // Get requirements for the active version
  const { data: reqs } = await client
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, nesting_depth, parent_requirement_id, display_order')
    .eq('merit_badge_id', badge!.id)
    .eq('version_year', badge!.requirement_version_year)
    .order('display_order')

  console.log(`\nRequirements for version ${badge!.requirement_version_year}:`)

  // Build parent ID map for display
  const idToNum = new Map<string, string>()
  for (const r of reqs || []) {
    idToNum.set(r.id, r.requirement_number)
  }

  // Show requirements around 6
  const relevantReqs = (reqs || []).filter(r => {
    const num = r.requirement_number
    return num.startsWith('5') || num.startsWith('6') || num.startsWith('7')
  })

  console.log('\nRequirements 5, 6, 7:')
  for (const r of relevantReqs) {
    const indent = '  '.repeat(r.nesting_depth || 0)
    const parentNum = r.parent_requirement_id ? idToNum.get(r.parent_requirement_id) : null
    const headerMark = r.is_header ? ' [H]' : ''
    const parentMark = parentNum ? ` (parent: ${parentNum})` : ''
    console.log(`${indent}${r.requirement_number}${headerMark}${parentMark}: ${r.description?.substring(0, 60)}...`)
  }
}

main()
