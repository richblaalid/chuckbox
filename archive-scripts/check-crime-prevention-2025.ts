#!/usr/bin/env npx tsx
/**
 * Check Crime Prevention 2025 requirements structure
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('name', 'Crime Prevention')
    .single()

  if (!badge) {
    console.log('Badge not found')
    return
  }

  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, parent_requirement_id, display_order')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2025)
    .order('display_order')

  if (!reqs) {
    console.log('No requirements found')
    return
  }

  // Build a map for parent lookups
  const reqMap = new Map(reqs.map(r => [r.id, r]))

  console.log('Crime Prevention 2025 Requirements:')
  console.log('='.repeat(100))

  for (const r of reqs) {
    const h = r.is_header ? ' [HEADER]' : ''
    const parent = r.parent_requirement_id ? reqMap.get(r.parent_requirement_id) : null
    const parentNum = parent ? ` (parent: ${parent.requirement_number})` : ''
    console.log(`${r.display_order.toString().padStart(2)} | ${r.requirement_number.padEnd(8)} | ${r.description?.substring(0, 60)}...${h}${parentNum}`)
  }

  console.log('\n')
  console.log('Requirement 4 hierarchy analysis:')
  console.log('='.repeat(100))

  const req4Family = reqs.filter(r => r.requirement_number.startsWith('4'))
  for (const r of req4Family) {
    const parent = r.parent_requirement_id ? reqMap.get(r.parent_requirement_id) : null
    const flags: string[] = []
    if (r.is_header) flags.push('HEADER')

    // Check for header phrases
    const desc = (r.description || '').toLowerCase()
    if (desc.includes('discuss the following') ||
        desc.includes('do the following') ||
        desc.includes('complete the following')) {
      if (!r.is_header) flags.push('SHOULD_BE_HEADER')
    }

    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
    const parentStr = parent ? ` → parent: "${parent.requirement_number}"` : ' → NO PARENT'

    console.log(`${r.requirement_number.padEnd(8)} ${r.description?.substring(0, 50)}...${flagStr}${parentStr}`)
  }
}

main().catch(console.error)
