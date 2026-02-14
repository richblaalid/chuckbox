#!/usr/bin/env npx tsx

/**
 * Post-Seed BSA Requirements Fix
 *
 * Runs all enabled fixes from the requirement-fixes.json registry.
 * These fixes correct hierarchy and naming issues that exist in the scraped
 * canonical data but need database-level corrections.
 *
 * Usage:
 *   npx tsx scripts/fix-bsa-requirements.ts
 *   npx tsx scripts/fix-bsa-requirements.ts --dry-run
 *   npx tsx scripts/fix-bsa-requirements.ts --badge Cycling
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

interface FixEntry {
  badge: string
  version: number
  script: string
  description: string
  issueTypes: string[]
  enabled: boolean
  lastRun: string | null
}

interface FixRegistry {
  description: string
  lastUpdated: string
  fixes: FixEntry[]
  knownIssues: Array<{
    badge: string
    version: number
    description: string
    status: string
  }>
}

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const badgeFilterIndex = args.indexOf('--badge')
const badgeFilter = badgeFilterIndex !== -1 ? args[badgeFilterIndex + 1] : null

console.log('══════════════════════════════════════════════════════════════')
console.log('             POST-SEED BSA REQUIREMENTS FIXES')
console.log('══════════════════════════════════════════════════════════════')
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (applying changes)'}`)
if (badgeFilter) {
  console.log(`Filter: ${badgeFilter}`)
}
console.log('')

// Load registry
const registryPath = path.join(process.cwd(), 'data', 'requirement-fixes.json')
let registry: FixRegistry

try {
  registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
} catch (error) {
  console.error(`Failed to load registry from ${registryPath}:`, (error as Error).message)
  console.log('Falling back to hardcoded fix list...')

  // Fallback to hardcoded list if registry doesn't exist
  registry = {
    description: 'Fallback registry',
    lastUpdated: new Date().toISOString(),
    fixes: [
      {
        badge: 'Cycling',
        version: 2026,
        script: 'scripts/fix-cycling-2026-requirements.ts',
        description: 'Fix requirement 6 option nesting',
        issueTypes: ['inconsistent_nesting'],
        enabled: true,
        lastRun: null,
      },
      {
        badge: 'Multisport',
        version: 2026,
        script: 'scripts/fix-multisport-2026-requirements.ts',
        description: 'Fix requirement 4 option structure',
        issueTypes: ['inconsistent_nesting'],
        enabled: true,
        lastRun: null,
      },
    ],
    knownIssues: [],
  }
}

// Filter fixes
let fixesToRun = registry.fixes.filter((fix) => fix.enabled)
if (badgeFilter) {
  fixesToRun = fixesToRun.filter((fix) =>
    fix.badge.toLowerCase().includes(badgeFilter.toLowerCase())
  )
}

console.log(`Found ${fixesToRun.length} enabled fix(es) to run\n`)

let successCount = 0
let errorCount = 0
const runResults: Array<{ fix: FixEntry; success: boolean; timestamp: string }> = []

for (const fix of fixesToRun) {
  console.log(`\n▶ Running: ${fix.badge} v${fix.version}`)
  console.log(`  Script: ${fix.script}`)
  console.log(`  Description: ${fix.description}`)

  const timestamp = new Date().toISOString()

  try {
    const scriptArgs = ['tsx', fix.script]
    if (isDryRun) {
      scriptArgs.push('--dry-run')
    }

    const output = execFileSync('npx', scriptArgs, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Show relevant output lines (skip env injection message)
    const lines = output.split('\n').filter(
      (line) => !line.includes('[dotenv@') && line.trim()
    )
    for (const line of lines.slice(0, 20)) {
      console.log(`  ${line}`)
    }
    if (lines.length > 20) {
      console.log(`  ... (${lines.length - 20} more lines)`)
    }

    successCount++
    runResults.push({ fix, success: true, timestamp })
    console.log(`  ✅ ${fix.badge} v${fix.version} completed`)
  } catch (error) {
    errorCount++
    runResults.push({ fix, success: false, timestamp })
    console.error(`  ❌ ${fix.badge} v${fix.version} failed:`, (error as Error).message)
  }
}

// Update registry with run timestamps (only if not dry run)
if (!isDryRun && runResults.length > 0) {
  for (const result of runResults) {
    const registryFix = registry.fixes.find(
      (f) => f.badge === result.fix.badge && f.version === result.fix.version
    )
    if (registryFix && result.success) {
      registryFix.lastRun = result.timestamp
    }
  }
  registry.lastUpdated = new Date().toISOString()

  try {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    console.log(`\n📋 Registry updated: ${registryPath}`)
  } catch (error) {
    console.warn(`Warning: Could not update registry: ${(error as Error).message}`)
  }
}

// Show known issues that still need fix scripts
const pendingIssues = registry.knownIssues.filter((i) => i.status === 'needs_fix_script')
if (pendingIssues.length > 0) {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log('                    KNOWN ISSUES (no fix yet)')
  console.log('══════════════════════════════════════════════════════════════')
  for (const issue of pendingIssues) {
    console.log(`  ${issue.badge} v${issue.version}: ${issue.description}`)
  }
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('                           SUMMARY')
console.log('══════════════════════════════════════════════════════════════')
console.log(`✅ Successful: ${successCount}`)
console.log(`❌ Failed: ${errorCount}`)
console.log(`⚠️  Pending (needs fix script): ${pendingIssues.length}`)
console.log('')

if (errorCount > 0) {
  process.exit(1)
}
