#!/usr/bin/env npx tsx
/**
 * Targeted Scraper for Missing Descriptions
 *
 * Uses canonical data from the database to scrape only the descriptions
 * we're missing. Matches by positional order within each badge version.
 *
 * Usage:
 *   npx tsx scripts/scrape-missing-descriptions.ts
 *   npx tsx scripts/scrape-missing-descriptions.ts --badge "Archery"
 *   npx tsx scripts/scrape-missing-descriptions.ts --dry-run
 *
 * Requirements:
 *   - Playwright installed (npm install playwright)
 *   - You'll need to manually log in to Scoutbook when the browser opens
 */

import { chromium, Page, Browser } from 'playwright'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as readline from 'readline'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ============================================
// Types
// ============================================

interface CanonicalRequirement {
  id: string
  scoutbook_id: string
  description: string | null
  sort_order: number
  badge_version_id: string
}

interface BadgeVersion {
  id: string
  badge_name: string
  version_year: number
}

interface ScrapedItem {
  index: number
  label: string
  description: string
  depth: number
}

// ============================================
// Utilities
// ============================================

function waitForKeypress(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ============================================
// Database Functions
// ============================================

async function getBadgesWithMissingDescriptions(
  supabase: SupabaseClient,
  specificBadge?: string
): Promise<Map<string, { version: BadgeVersion; missing: CanonicalRequirement[] }>> {
  // Get all requirements missing descriptions
  let query = supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, description, sort_order, badge_version_id')
    .is('description', null)
    .order('sort_order')

  const { data: missingReqs, error } = await query

  if (error) throw error
  if (!missingReqs || missingReqs.length === 0) {
    console.log('No missing descriptions found!')
    return new Map()
  }

  // Get version info for all missing requirements
  const versionIds = [...new Set(missingReqs.map(r => r.badge_version_id))]
  const { data: versions, error: vError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .in('id', versionIds)

  if (vError) throw vError

  // Filter by specific badge if requested
  let filteredVersions = versions || []
  if (specificBadge) {
    filteredVersions = filteredVersions.filter(v =>
      v.badge_name.toLowerCase().includes(specificBadge.toLowerCase())
    )
  }

  // Group missing requirements by version
  const result = new Map<string, { version: BadgeVersion; missing: CanonicalRequirement[] }>()

  for (const version of filteredVersions) {
    const missing = missingReqs.filter(r => r.badge_version_id === version.id)
    if (missing.length > 0) {
      result.set(version.id, { version, missing })
    }
  }

  return result
}

async function getAllRequirementsForVersion(
  supabase: SupabaseClient,
  versionId: string
): Promise<CanonicalRequirement[]> {
  const { data, error } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, description, sort_order, badge_version_id')
    .eq('badge_version_id', versionId)
    .order('sort_order')

  if (error) throw error
  return data || []
}

async function updateDescription(
  supabase: SupabaseClient,
  reqId: string,
  description: string
): Promise<boolean> {
  const { error } = await supabase
    .from('merit_badge_requirements')
    .update({ description })
    .eq('id', reqId)

  return !error
}

// ============================================
// Browser Navigation
// ============================================

async function dismissPopups(page: Page): Promise<void> {
  const dismissSelectors = [
    '.ant-modal-confirm-btns button:has-text("No")',
    'button:has-text("Stay logged in")',
    'button:has-text("OK")',
    '.ant-modal-close',
  ]

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector)
      if (button && await button.isVisible()) {
        await button.click({ force: true })
        await page.waitForTimeout(300)
      }
    } catch {
      // Ignore
    }
  }
}

async function navigateToBadge(
  page: Page,
  badgeName: string
): Promise<boolean> {
  // Click on the sidebar to find the badge
  // First, look for the badge in the current view
  try {
    // Try to find badge by name in the merit badges list
    const badgeLink = await page.$(`text="${badgeName}"`)
    if (badgeLink) {
      await badgeLink.click()
      await page.waitForTimeout(1000)
      await dismissPopups(page)
      return true
    }

    // Try scrolling through the list
    const sidebar = await page.$('[class*="MeritBadgesList"]')
    if (sidebar) {
      // Scroll to find the badge
      for (let i = 0; i < 10; i++) {
        const link = await page.$(`text="${badgeName}"`)
        if (link) {
          await link.click()
          await page.waitForTimeout(1000)
          await dismissPopups(page)
          return true
        }
        await sidebar.evaluate(el => el.scrollBy(0, 200))
        await page.waitForTimeout(200)
      }
    }

    console.log(`  Could not find badge: ${badgeName}`)
    return false
  } catch (e) {
    console.log(`  Error navigating to badge: ${e}`)
    return false
  }
}

async function selectVersion(
  page: Page,
  versionYear: number
): Promise<boolean> {
  try {
    // Look for version selector
    const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
    if (!versionSelector) {
      // No version selector - might be single version badge
      return true
    }

    await versionSelector.click({ force: true })
    await page.waitForTimeout(500)

    // Find and click the version that contains the year
    const clicked = await page.evaluate((year) => {
      const options = Array.from(document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option'))
      for (const opt of options) {
        const text = opt.textContent || ''
        if (text.includes(String(year))) {
          (opt as HTMLElement).click()
          return true
        }
      }
      return false
    }, versionYear)

    if (clicked) {
      await page.waitForTimeout(1000)
      await dismissPopups(page)
      return true
    }

    // Close dropdown if not clicked
    await page.keyboard.press('Escape')
    return false
  } catch (e) {
    console.log(`  Error selecting version: ${e}`)
    return false
  }
}

// ============================================
// Requirement Scraping
// ============================================

async function scrapeRequirements(page: Page): Promise<ScrapedItem[]> {
  return await page.evaluate(() => {
    const results: ScrapedItem[] = []
    let index = 0

    // Find all requirement items
    const requirementItems = document.querySelectorAll('[class*="RequirementsList__requirementItem"]')

    for (const item of requirementItems) {
      // Get the label (requirement number)
      const labelEl = item.querySelector('[class*="RequirementItem__reqLabel"]')
      const label = labelEl?.textContent?.trim() || ''

      // Get the description
      const descEl = item.querySelector('[class*="RequirementItem__requirement"]')
      let description = ''
      if (descEl) {
        // Get text content, but preserve structure for lists
        description = descEl.textContent?.trim() || ''
        // Limit length
        description = description.substring(0, 1000)
      }

      // Determine depth based on CSS classes or indentation
      const classList = item.className || ''
      let depth = 0
      if (classList.includes('subReq') || classList.includes('sub-req')) {
        depth = 1
      }
      if (classList.includes('subSubReq') || classList.includes('sub-sub')) {
        depth = 2
      }

      if (description && description.length > 5) {
        results.push({
          index,
          label,
          description,
          depth
        })
        index++
      }
    }

    return results
  })
}

// ============================================
// Matching Logic
// ============================================

function matchScrapedToCanonical(
  scraped: ScrapedItem[],
  canonical: CanonicalRequirement[]
): Map<string, string> {
  const matches = new Map<string, string>()

  // Filter canonical to only those missing descriptions
  const missing = canonical.filter(c => !c.description)

  // Strategy 1: Direct positional match if counts are close
  if (scraped.length >= missing.length * 0.8) {
    // Build index mapping based on sort_order
    const canonicalByIndex = new Map<number, CanonicalRequirement>()
    let idx = 0
    for (const c of canonical) {
      canonicalByIndex.set(idx, c)
      idx++
    }

    // Match by position
    for (let i = 0; i < scraped.length && i < canonical.length; i++) {
      const scr = scraped[i]
      const can = canonical[i]

      if (can && !can.description && scr.description) {
        matches.set(can.id, scr.description)
      }
    }
  }

  // Strategy 2: Match by label similarity for remaining
  const usedScraped = new Set<number>()
  for (const can of missing) {
    if (matches.has(can.id)) continue

    // Try to find matching scraped item by label
    const canLabel = can.scoutbook_id.replace(/[^a-z0-9]/gi, '').toLowerCase()

    for (let i = 0; i < scraped.length; i++) {
      if (usedScraped.has(i)) continue
      const scr = scraped[i]
      const scrLabel = scr.label.replace(/[^a-z0-9]/gi, '').toLowerCase()

      if (canLabel === scrLabel || canLabel.includes(scrLabel) || scrLabel.includes(canLabel)) {
        matches.set(can.id, scr.description)
        usedScraped.add(i)
        break
      }
    }
  }

  return matches
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const badgeArg = args.find(a => a.startsWith('--badge='))?.split('=')[1] ||
                   (args.includes('--badge') ? args[args.indexOf('--badge') + 1] : undefined)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log('Targeted Scraper for Missing Descriptions')
  console.log('='.repeat(60))
  console.log(dryRun ? 'DRY RUN MODE - No changes will be made\n' : '')

  // Get badges with missing descriptions
  console.log('Loading canonical data...')
  const badgesWithMissing = await getBadgesWithMissingDescriptions(supabase, badgeArg)

  if (badgesWithMissing.size === 0) {
    console.log('No badges with missing descriptions found!')
    return
  }

  // Summarize what we'll scrape
  console.log(`\nFound ${badgesWithMissing.size} badge versions with missing descriptions:`)
  let totalMissing = 0
  for (const [, { version, missing }] of badgesWithMissing) {
    console.log(`  ${version.badge_name} ${version.version_year}: ${missing.length} missing`)
    totalMissing += missing.length
  }
  console.log(`\nTotal missing: ${totalMissing}`)

  if (dryRun) {
    console.log('\nDry run complete. Use without --dry-run to actually scrape.')
    return
  }

  // Launch browser
  console.log('\nLaunching browser...')
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  })

  const page = await context.newPage()

  // Navigate to Scouting Advancements
  console.log('Navigating to advancements.scouting.org...')
  await page.goto('https://advancements.scouting.org/', { timeout: 60000 })

  // Wait for manual login
  console.log('\n' + '='.repeat(60))
  console.log('Please log in manually.')
  console.log('Then navigate to any Scout\'s Merit Badges list.')
  console.log('='.repeat(60))

  await waitForKeypress('\nPress Enter when ready to start scraping...')

  // Process each badge with missing descriptions
  let updated = 0
  let failed = 0

  for (const [versionId, { version, missing }] of badgesWithMissing) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`${version.badge_name} ${version.version_year} (${missing.length} missing)`)
    console.log('='.repeat(60))

    // Navigate to badge
    const foundBadge = await navigateToBadge(page, version.badge_name)
    if (!foundBadge) {
      console.log(`  SKIPPED - Could not find badge`)
      failed += missing.length
      continue
    }

    // Select version
    const selectedVersion = await selectVersion(page, version.version_year)
    if (!selectedVersion) {
      console.log(`  SKIPPED - Could not select version ${version.version_year}`)
      failed += missing.length
      continue
    }

    await page.waitForTimeout(1000)
    await dismissPopups(page)

    // Scrape requirements
    const scraped = await scrapeRequirements(page)
    console.log(`  Scraped ${scraped.length} requirements`)

    // Get all canonical requirements for this version
    const allCanonical = await getAllRequirementsForVersion(supabase, versionId)
    console.log(`  Canonical has ${allCanonical.length} requirements (${missing.length} missing descriptions)`)

    // Match scraped to canonical
    const matches = matchScrapedToCanonical(scraped, allCanonical)
    console.log(`  Matched ${matches.size} descriptions`)

    // Update database
    let versionUpdated = 0
    for (const [reqId, description] of matches) {
      const success = await updateDescription(supabase, reqId, description)
      if (success) {
        versionUpdated++
        updated++
      }
    }

    console.log(`  Updated ${versionUpdated} descriptions in database`)

    // Small delay between badges
    await page.waitForTimeout(500)
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SCRAPING COMPLETE')
  console.log('='.repeat(60))
  console.log(`Updated: ${updated}`)
  console.log(`Failed/Skipped: ${failed}`)

  // Close browser
  await waitForKeypress('\nPress Enter to close browser...')
  await browser.close()
}

main().catch(console.error)
