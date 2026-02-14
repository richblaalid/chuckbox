#!/usr/bin/env npx tsx
/**
 * Interactive Manual Description Entry
 *
 * Shows each missing requirement and lets you paste in the description.
 *
 * Usage:
 *   npx tsx scripts/fill-manual-descriptions.ts
 *   npx tsx scripts/fill-manual-descriptions.ts --badge "Environmental Science"
 *   npx tsx scripts/fill-manual-descriptions.ts --skip-no-scraped
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer)
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const badgeFilter = args.find(a => a.startsWith('--badge='))?.split('=')[1] ||
                      (args.includes('--badge') ? args[args.indexOf('--badge') + 1] : undefined)

  // Get all missing requirements
  const { data: missing } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, badge_version_id, main_req, section, item, option_name, option_letter')
    .is('description', null)
    .order('badge_version_id')

  if (!missing || missing.length === 0) {
    console.log('No missing descriptions!')
    return
  }

  // Get version info
  const versionIds = [...new Set(missing.map(m => m.badge_version_id))]
  const { data: versions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .in('id', versionIds)

  const versionMap = new Map<string, { badge_name: string; version_year: number }>()
  for (const v of versions || []) {
    versionMap.set(v.id, v)
  }

  // Filter if badge specified
  let filtered = missing
  if (badgeFilter) {
    filtered = missing.filter(m => {
      const v = versionMap.get(m.badge_version_id)
      return v && v.badge_name.toLowerCase().includes(badgeFilter.toLowerCase())
    })
  }

  console.log('Manual Description Entry')
  console.log('='.repeat(60))
  console.log(`Total missing: ${filtered.length}`)
  console.log('')
  console.log('Commands:')
  console.log('  [paste description] - Set description for current requirement')
  console.log('  skip                - Skip this requirement')
  console.log('  quit                - Exit')
  console.log('='.repeat(60))

  const rl = createRL()
  let completed = 0
  let skipped = 0

  for (let i = 0; i < filtered.length; i++) {
    const req = filtered[i]
    const version = versionMap.get(req.badge_version_id)
    if (!version) continue

    console.log('')
    console.log(`[${i + 1}/${filtered.length}] ${version.badge_name} ${version.version_year}`)
    console.log(`Requirement ID: ${req.scoutbook_id}`)

    // Show structure info
    const parts = []
    if (req.main_req) parts.push(`main: ${req.main_req}`)
    if (req.section) parts.push(`section: ${req.section}`)
    if (req.item) parts.push(`item: ${req.item}`)
    if (req.option_name) parts.push(`option: ${req.option_name}`)
    if (req.option_letter) parts.push(`letter: ${req.option_letter}`)
    if (parts.length > 0) {
      console.log(`Structure: ${parts.join(', ')}`)
    }
    console.log('')

    const input = await prompt(rl, 'Description (or skip/quit): ')

    if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
      break
    }

    if (input.toLowerCase() === 'skip' || input.trim() === '') {
      skipped++
      continue
    }

    // Update database
    const { error } = await supabase
      .from('merit_badge_requirements')
      .update({ description: input.trim() })
      .eq('id', req.id)

    if (error) {
      console.log(`  ERROR: ${error.message}`)
    } else {
      console.log('  ✓ Saved')
      completed++
    }
  }

  rl.close()

  console.log('')
  console.log('='.repeat(60))
  console.log(`Completed: ${completed}`)
  console.log(`Skipped: ${skipped}`)

  // Show new coverage
  const { count: total } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  const { count: withDesc } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .not('description', 'is', null)

  console.log(`Coverage: ${withDesc}/${total} (${((withDesc || 0)/(total || 1)*100).toFixed(1)}%)`)
}

main().catch(console.error)
