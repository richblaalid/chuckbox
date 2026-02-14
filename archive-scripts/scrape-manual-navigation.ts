#!/usr/bin/env npx tsx
/**
 * Manual Navigation Scraper for Missing Descriptions
 *
 * Opens a browser and lets you manually navigate to each badge.
 * Press Enter to scrape the current page and update the database.
 *
 * Usage:
 *   npx tsx scripts/scrape-manual-navigation.ts
 */

import { chromium, Page } from 'playwright'
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
}

interface BadgeVersion {
  id: string
  badge_name: string
  version_year: number
}

interface ScrapedItem {
  label: string
  description: string
}

// ============================================
// Utilities
// ============================================

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

// ============================================
// Database Functions
// ============================================

async function findBadgeVersion(
  supabase: SupabaseClient,
  badgeName: string,
  versionYear: number
): Promise<BadgeVersion | null> {
  const { data } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .ilike('badge_name', `%${badgeName}%`)
    .eq('version_year', versionYear)
    .single()

  return data
}

async function getRequirementsForVersion(
  supabase: SupabaseClient,
  versionId: string
): Promise<CanonicalRequirement[]> {
  const { data } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, description, sort_order')
    .eq('badge_version_id', versionId)
    .order('sort_order')

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

async function getMissingCount(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .is('description', null)

  return count || 0
}

// ============================================
// Scraping Functions
// ============================================

async function scrapeCurrentPage(page: Page): Promise<ScrapedItem[]> {
  return await page.evaluate(() => {
    const results: ScrapedItem[] = []

    // Try multiple selectors for different UI structures
    const selectors = [
      // Advancements.scouting.org style
      '[class*="requirement"]',
      '[class*="Requirement"]',
      // Generic list items
      'li[class*="req"]',
      // Table rows
      'tr[class*="req"]',
      // Divs with requirement content
      'div[class*="reqItem"]',
      'div[class*="RequirementItem"]',
    ]

    // Try to find requirement elements
    let elements: Element[] = []
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector)
      if (found.length > 0) {
        elements = Array.from(found)
        break
      }
    }

    // If no specific elements found, try to find any numbered list
    if (elements.length === 0) {
      // Look for numbered items in the page
      const allText = document.body.innerText
      const lines = allText.split('\n')

      let currentLabel = ''
      let currentDesc = ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Check if this looks like a requirement number
        const labelMatch = trimmed.match(/^(\d+[a-z]?\.?\s*\([a-z0-9]+\)?\.?|\d+[a-z]?\.?|\([a-z0-9]+\)\.?)\s*/i)
        if (labelMatch) {
          // Save previous if exists
          if (currentLabel && currentDesc) {
            results.push({ label: currentLabel, description: currentDesc })
          }
          currentLabel = labelMatch[1].replace(/\.$/, '').trim()
          currentDesc = trimmed.substring(labelMatch[0].length).trim()
        } else if (currentLabel && trimmed.length > 10) {
          // Continuation of description
          currentDesc += ' ' + trimmed
        }
      }

      // Don't forget the last one
      if (currentLabel && currentDesc) {
        results.push({ label: currentLabel, description: currentDesc })
      }

      return results
    }

    // Process found elements
    for (const el of elements) {
      // Try to find label
      const labelEl = el.querySelector('[class*="label"], [class*="number"], .req-num')
      const label = labelEl?.textContent?.trim() || ''

      // Get description
      const descEl = el.querySelector('[class*="text"], [class*="desc"], [class*="content"]')
      const description = (descEl?.textContent || el.textContent || '').trim()

      if (description && description.length > 5) {
        results.push({
          label: label || '',
          description: description.substring(0, 1500)
        })
      }
    }

    return results
  })
}

async function detectBadgeInfo(page: Page): Promise<{ name: string; year: number } | null> {
  return await page.evaluate(() => {
    // Try to find badge name from page
    const titleSelectors = [
      'h1', 'h2',
      '[class*="badgeName"]',
      '[class*="BadgeName"]',
      '[class*="title"]',
      '.breadcrumb-item.active',
    ]

    let name = ''
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector)
      if (el?.textContent) {
        const text = el.textContent.trim()
        // Filter out generic titles
        if (text.length > 2 && text.length < 100 && !text.includes('Merit Badge')) {
          name = text
          break
        }
      }
    }

    // Try to find version/year
    const versionSelectors = [
      '[class*="version"]',
      '[class*="Version"]',
      'select[class*="version"]',
    ]

    let year = new Date().getFullYear()
    for (const selector of versionSelectors) {
      const el = document.querySelector(selector)
      const text = el?.textContent || ''
      const yearMatch = text.match(/20\d{2}/)
      if (yearMatch) {
        year = parseInt(yearMatch[0], 10)
        break
      }
    }

    // Also check URL for year
    const urlMatch = window.location.href.match(/20\d{2}/)
    if (urlMatch) {
      year = parseInt(urlMatch[0], 10)
    }

    return name ? { name, year } : null
  })
}

// ============================================
// Main
// ============================================

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const rl = createReadlineInterface()

  console.log('Manual Navigation Scraper')
  console.log('='.repeat(60))

  const missingCount = await getMissingCount(supabase)
  console.log(`Currently missing ${missingCount} descriptions\n`)

  // Launch browser
  console.log('Launching browser...')
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  })

  const page = await context.newPage()

  // Navigate to site
  console.log('Opening advancements.scouting.org...')
  await page.goto('https://advancements.scouting.org/', { timeout: 60000 })

  console.log('\n' + '='.repeat(60))
  console.log('INSTRUCTIONS:')
  console.log('1. Log in if needed')
  console.log('2. Navigate to a Scout\'s merit badge requirements page')
  console.log('3. Come back here and enter the badge name and year')
  console.log('4. The script will scrape and match to canonical data')
  console.log('')
  console.log('Commands:')
  console.log('  [badge name] [year] - Scrape current page for that badge')
  console.log('  status              - Show current missing count')
  console.log('  quit                - Exit')
  console.log('='.repeat(60))

  let running = true
  while (running) {
    const input = await prompt(rl, '\nEnter badge name and year (e.g., "Camping 2024"): ')

    if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
      running = false
      continue
    }

    if (input.toLowerCase() === 'status') {
      const count = await getMissingCount(supabase)
      console.log(`Currently missing ${count} descriptions`)
      continue
    }

    // Parse badge name and year
    const match = input.match(/^(.+?)\s+(\d{4})$/)
    if (!match) {
      console.log('Invalid format. Use: "Badge Name YYYY" (e.g., "Camping 2024")')
      continue
    }

    const [, badgeName, yearStr] = match
    const year = parseInt(yearStr, 10)

    console.log(`\nLooking up ${badgeName} ${year}...`)

    // Find badge version in database
    const version = await findBadgeVersion(supabase, badgeName, year)
    if (!version) {
      console.log(`  Badge version not found in database: ${badgeName} ${year}`)
      continue
    }

    console.log(`  Found: ${version.badge_name} ${version.version_year}`)

    // Get canonical requirements
    const canonical = await getRequirementsForVersion(supabase, version.id)
    const missing = canonical.filter(c => !c.description)
    console.log(`  ${canonical.length} total requirements, ${missing.length} missing descriptions`)

    if (missing.length === 0) {
      console.log('  No missing descriptions for this badge!')
      continue
    }

    // Scrape current page
    console.log('  Scraping current page...')
    const scraped = await scrapeCurrentPage(page)
    console.log(`  Found ${scraped.length} items on page`)

    if (scraped.length === 0) {
      console.log('  No requirements found on page. Make sure you\'re on the requirements page.')
      continue
    }

    // Show what was scraped
    console.log('\n  Scraped items:')
    for (const item of scraped.slice(0, 5)) {
      const desc = item.description.substring(0, 60)
      console.log(`    ${item.label || '?'}: ${desc}...`)
    }
    if (scraped.length > 5) {
      console.log(`    ... and ${scraped.length - 5} more`)
    }

    // Match by position
    console.log('\n  Matching to canonical requirements...')
    let updated = 0

    // Strategy: Match scraped items to canonical by position
    for (let i = 0; i < Math.min(scraped.length, canonical.length); i++) {
      const scr = scraped[i]
      const can = canonical[i]

      if (can && !can.description && scr.description && scr.description.length > 10) {
        const success = await updateDescription(supabase, can.id, scr.description)
        if (success) {
          updated++
        }
      }
    }

    console.log(`  Updated ${updated} descriptions`)

    // Show new status
    const newMissing = await getMissingCount(supabase)
    console.log(`  Total missing now: ${newMissing}`)
  }

  console.log('\nClosing browser...')
  await browser.close()
  rl.close()

  const finalCount = await getMissingCount(supabase)
  console.log(`\nFinal missing count: ${finalCount}`)
}

main().catch(console.error)
