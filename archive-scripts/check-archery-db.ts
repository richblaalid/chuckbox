#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

async function main() {
  // Find Archery badge
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id, name')
    .eq('name', 'Archery')
    .single()
  
  if (!badge) {
    console.log('Archery badge not found')
    return
  }
  
  console.log('Badge:', badge.name, 'ID:', badge.id)
  console.log()
  
  // Get v2025 requirements
  const { data: reqs, error } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2025)
    .order('display_order')
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  console.log('v2025 Total requirements:', reqs?.length)
  console.log()
  
  // Build a map for parent lookup
  const reqMap = new Map(reqs?.map(r => [r.id, r]))
  
  // Show all requirements
  console.log('All v2025 requirements:')
  console.log('-'.repeat(80))
  for (const r of reqs || []) {
    const indent = '  '.repeat(Math.max(0, r.nesting_depth))
    const marker = r.is_header ? '[H]' : '   '
    const parentName = r.parent_requirement_id ? reqMap.get(r.parent_requirement_id)?.requirement_number : 'ROOT'
    const descPreview = r.description?.substring(0, 40).replace(/\n/g, ' ')
    console.log(`${indent}${marker} ${r.requirement_number} (depth:${r.nesting_depth}, parent:${parentName})`)
    console.log(`${indent}    scoutbook: ${r.scoutbook_requirement_number}`)
    console.log(`${indent}    desc: ${descPreview}`)
  }
}

main().catch(console.error)
