#!/usr/bin/env npx tsx
/**
 * Fix Option-Heavy Badge Descriptions
 *
 * Uses badge-specific mappings to match scraped descriptions to canonical IDs
 * for badges with complex option structures.
 *
 * Usage:
 *   npx tsx scripts/fix-option-badge-descriptions.ts --dry-run
 *   npx tsx scripts/fix-option-badge-descriptions.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadge {
  badgeName: string
  versionYear: number
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  badges: ScrapedBadge[]
}

interface CanonicalReq {
  id: string
  scoutbook_id: string
  description: string | null
  badge_version_id: string
}

// Badge-specific option mappings
// Maps scraped option letters to canonical option names
const OPTION_MAPPINGS: Record<string, Record<string, string>> = {
  'Skating': {
    'A': 'Ice',
    'B': 'Line',
    'C': 'Roll',
    'D': 'Board',
  },
  'Multisport': {
    'A': 'Triathlon',
    'B': 'Duathlon',
    'C': 'Aquathlon',
    'D': 'Aquabike',
  },
  'Snow Sports': {
    'A': 'Alpine',
    'B': 'Nordic',
    'C': 'Snowboard',
  },
  'Rifle Shooting': {
    'A': 'Opt A',
    'B': 'Opt B',
    'C': 'Opt C',
  },
  'Shotgun Shooting': {
    'A': 'Opt A',
    'B': 'Opt B',
    'C': 'Opt C',
  },
  'Archery': {
    'A': 'Opt A',
    'B': 'Opt B',
    'C': 'Opt C',
  },
  'Geology': {
    'A': 'a',  // Surface and Sedimentary
    'B': 'b',  // Energy Resources
    'C': 'c',  // Mineral Resources
    'D': 'd',  // Earth History
  },
  'Animal Science': {
    'A': 'avian',
    'B': 'beef',
    'C': 'dairy',
    'D': 'horse',
    'E': 'hog',
    'F': 'rabbit',
    'G': 'sheep',
    'H': 'goat',
  },
  'Plant Science': {
    // Plant Science uses Opt 1, Opt 2, Opt 3 structure
    '(1)': 'Opt 1',
    '(2)': 'Opt 2',
    '(3)': 'Opt 3',
  },
}

function normalizeScrapedId(id: string): string {
  return id
    .replace(/\.$/, '')           // Remove trailing period
    .replace(/\(/g, '[')          // Convert ( to [
    .replace(/\)/g, ']')          // Convert ) to ]
    .toLowerCase()
}

function normalizeCanonicalId(id: string): string {
  return id
    .replace(/\.$/, '')           // Remove trailing period
    .replace(/ (Ice|Line|Roll|Board|Alpine|Nordic|Snowboard|Triathlon|Duathlon|Aquathlon|Aquabike|avian|beef|dairy|horse|hog|rabbit|sheep|goat)$/i, '')
    .replace(/ Opt [A-H]$/i, '')
    .replace(/ Option [A-H]$/i, '')
    .replace(/ Option$/i, '')
    .toLowerCase()
}

function extractOptionLetter(scrapedId: string): string | null {
  // Match patterns like "2Aa", "4Ba(1)", "5Aa(1)"
  const match = scrapedId.match(/^\d+([A-H])/i)
  return match ? match[1].toUpperCase() : null
}

function convertScrapedToCanonical(
  scrapedId: string,
  badgeName: string
): string[] {
  const candidates: string[] = []
  const optionLetter = extractOptionLetter(scrapedId)
  const mapping = OPTION_MAPPINGS[badgeName]

  // Remove trailing period from scraped
  let normalized = scrapedId.replace(/\.$/, '')

  // If there's an option letter, try to map it
  if (optionLetter && mapping && mapping[optionLetter]) {
    const optionName = mapping[optionLetter]

    // For Skating-style: "2Aa(1)" -> "2a[1] Ice"
    // Remove the option letter and convert
    const withoutOption = normalized.replace(/^(\d+)[A-H]/i, '$1')
    const converted = withoutOption.replace(/\((\d+)\)/g, '[$1]')

    // Try multiple candidate formats
    candidates.push(`${converted} ${optionName}`)
    candidates.push(`${converted}${optionName}`)

    // For pre-2026 format with brackets
    const bracketFormat = normalized
      .replace(/^(\d+)[A-H]([a-z])/i, '$1$2')
      .replace(/\((\d+)\)/g, '[$1]')
    candidates.push(`${bracketFormat} ${optionName}`)
  }

  // Add trailing period versions
  const baseCandidates = [...candidates]
  for (const c of baseCandidates) {
    candidates.push(c + '.')
  }

  // Add the normalized version
  candidates.push(normalized)
  candidates.push(normalized + '.')

  // Convert parentheses to brackets
  const bracketVersion = normalized.replace(/\((\d+)\)/g, '[$1]')
  candidates.push(bracketVersion)
  candidates.push(bracketVersion + '.')

  return [...new Set(candidates)]
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load scraped data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))

  // Target badges with high unmatched counts
  const targetBadges = [
    'Skating',
    'Multisport',
    'Snow Sports',
    'Rifle Shooting',
    'Shotgun Shooting',
    'Archery',
    'Geology',
    'Animal Science',
    'Plant Science',
    'Cycling',
  ]

  console.log(dryRun ? 'DRY RUN - No changes will be made\n' : 'LIVE RUN\n')
  console.log('='.repeat(70))

  let totalFixed = 0
  let totalAttempted = 0

  for (const badgeName of targetBadges) {
    // Get all versions for this badge
    const { data: versions } = await supabase
      .from('merit_badge_versions')
      .select('id, badge_name, version_year')
      .eq('badge_name', badgeName)
      .order('version_year')

    if (!versions || versions.length === 0) continue

    for (const version of versions) {
      // Get canonical requirements without descriptions
      const { data: canonicalReqs } = await supabase
        .from('merit_badge_requirements')
        .select('id, scoutbook_id, description')
        .eq('badge_version_id', version.id)
        .is('description', null) as { data: CanonicalReq[] | null }

      if (!canonicalReqs || canonicalReqs.length === 0) continue

      // Get scraped requirements
      const scrapedBadge = scrapedData.badges.find(
        b => b.badgeName === badgeName && b.versionYear === version.version_year
      )

      if (!scrapedBadge) continue

      // Build lookup from scraped descriptions
      const scrapedByNumber = new Map<string, ScrapedRequirement>()
      for (const req of scrapedBadge.requirements) {
        if (req.description && req.description.length > 10) {
          scrapedByNumber.set(req.number, req)
          scrapedByNumber.set(req.number.toLowerCase(), req)
          scrapedByNumber.set(normalizeScrapedId(req.number), req)
        }
      }

      let fixed = 0
      const updates: { id: string; description: string }[] = []

      for (const canonical of canonicalReqs) {
        totalAttempted++

        // Try to find matching scraped requirement
        let matched: ScrapedRequirement | undefined

        // 1. Try direct match
        matched = scrapedByNumber.get(canonical.scoutbook_id)

        // 2. Try normalized match
        if (!matched) {
          matched = scrapedByNumber.get(normalizeCanonicalId(canonical.scoutbook_id))
        }

        // 3. Try reverse conversion: generate candidate scraped IDs from canonical
        if (!matched) {
          // Extract the base number and option name from canonical
          const canonicalLower = canonical.scoutbook_id.toLowerCase()

          // For each scraped requirement, check if it could match
          for (const [scrapedNum, scrapedReq] of scrapedByNumber) {
            const candidates = convertScrapedToCanonical(scrapedNum, badgeName)

            for (const candidate of candidates) {
              if (candidate.toLowerCase() === canonicalLower ||
                  normalizeCanonicalId(candidate) === normalizeCanonicalId(canonical.scoutbook_id)) {
                matched = scrapedReq
                break
              }
            }
            if (matched) break
          }
        }

        // 4. Try structural matching for bracket notation
        if (!matched) {
          // "5a[1]" in canonical should match "5Aa(1)" in scraped
          const bracketMatch = canonical.scoutbook_id.match(/^(\d+)([a-z])\[(\d+)\](.*)$/i)
          if (bracketMatch) {
            const [, mainNum, section, item, suffix] = bracketMatch
            // Try each option letter
            for (const optLetter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
              const scrapedCandidate = `${mainNum}${optLetter}${section}(${item})`
              matched = scrapedByNumber.get(scrapedCandidate) ||
                       scrapedByNumber.get(scrapedCandidate.toLowerCase())

              // Check if the option mapping matches the suffix
              if (matched && suffix) {
                const mapping = OPTION_MAPPINGS[badgeName]
                if (mapping && mapping[optLetter]) {
                  const expectedSuffix = mapping[optLetter].toLowerCase()
                  if (!suffix.toLowerCase().includes(expectedSuffix)) {
                    matched = undefined
                    continue
                  }
                }
              }
              if (matched) break
            }
          }
        }

        // 5. Try inverted option matching for shooting badges
        // Canonical: "2d Opt a" -> Scraped: "2A(d)"
        // Canonical format: {mainNum}{subReq} Opt {optLetter}
        // Scraped format: {mainNum}{OptLetter}({subReq})
        if (!matched) {
          const optMatch = canonical.scoutbook_id.match(/^(\d+)([a-z]) Opt ([a-c])$/i)
          if (optMatch) {
            const [, mainNum, subReq, optLetter] = optMatch
            // Convert lowercase opt letter to uppercase for scraped format
            const scrapedCandidate = `${mainNum}${optLetter.toUpperCase()}(${subReq})`
            matched = scrapedByNumber.get(scrapedCandidate) ||
                     scrapedByNumber.get(scrapedCandidate.toLowerCase())
          }
        }

        // 6. Try Multisport-style matching
        // Canonical: "4a1 Triathlon Option" -> Scraped: "4Aa(1)"
        if (!matched && badgeName === 'Multisport') {
          const multiMatch = canonical.scoutbook_id.match(/^(\d+)([a-z])(\d+) (\w+) Option$/i)
          if (multiMatch) {
            const [, mainNum, section, item, optionName] = multiMatch
            // Find the option letter for this option name
            const mapping = OPTION_MAPPINGS['Multisport']
            let optLetter: string | null = null
            for (const [letter, name] of Object.entries(mapping)) {
              if (name.toLowerCase() === optionName.toLowerCase()) {
                optLetter = letter
                break
              }
            }
            if (optLetter) {
              const scrapedCandidate = `${mainNum}${optLetter}${section}(${item})`
              matched = scrapedByNumber.get(scrapedCandidate) ||
                       scrapedByNumber.get(scrapedCandidate.toLowerCase())
            }
          }
        }

        if (matched && matched.description) {
          updates.push({
            id: canonical.id,
            description: matched.description
          })
          fixed++
        }
      }

      if (updates.length > 0) {
        console.log(`${badgeName} ${version.version_year}: ${fixed} descriptions to update`)

        if (!dryRun) {
          // Update in batches
          for (const update of updates) {
            const { error } = await supabase
              .from('merit_badge_requirements')
              .update({ description: update.description })
              .eq('id', update.id)

            if (error) {
              console.error(`  Error updating ${update.id}:`, error.message)
            }
          }
        }

        totalFixed += fixed
      }
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`Total attempted: ${totalAttempted}`)
  console.log(`Total fixed: ${totalFixed}`)
  console.log(`${dryRun ? '(DRY RUN - no changes made)' : 'Changes applied'}`)
}

main().catch(console.error)
