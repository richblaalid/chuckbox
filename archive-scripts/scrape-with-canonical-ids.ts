#!/usr/bin/env npx tsx
/**
 * Canonical-Aware Merit Badge Scraper
 *
 * This scraper uses the canonical requirement IDs from our database
 * to assign correct Scoutbook IDs to scraped requirements.
 *
 * Strategy:
 * 1. Load canonical IDs from data/scoutbook-requirement-ids.json
 * 2. For each scraped requirement, match to canonical by:
 *    - Sort order position (most reliable)
 *    - Display label similarity
 *    - Description text matching (fallback)
 * 3. Use canonical ID when matched, construct fallback ID otherwise
 *
 * Usage:
 *   npx tsx scripts/scrape-with-canonical-ids.ts
 */

import { chromium, Page } from 'playwright'
import * as fs from 'fs'
import * as readline from 'readline'

// ============================================
// Types
// ============================================

interface CanonicalData {
  [badgeName: string]: {
    [year: string]: string[]
  }
}

interface RawScrapedItem {
  displayLabel: string
  description: string
  parentNumber: string | null
  depth: number
  isHeader: boolean
  sortOrder: number
}

interface ScrapedRequirement {
  number: string           // The canonical Scoutbook ID (or constructed fallback)
  description: string
  parentNumber: string | null
  depth: number
  isHeader?: boolean
  matchType?: 'canonical' | 'constructed' | 'header'
}

interface ScrapedBadgeVersion {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
  matchStats: {
    canonical: number
    constructed: number
    headers: number
  }
  scrapedAt: string
}

interface ScrapeProgress {
  totalBadges: number
  completedBadges: number
  currentBadge: string | null
  badges: ScrapedBadgeVersion[]
  errors: string[]
  startedAt: string
  lastUpdatedAt: string
}

// ============================================
// Canonical ID Matching
// ============================================

/**
 * Normalize a display label for matching
 */
function normalizeLabel(label: string): string {
  return label
    .replace(/[()[\].]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Extract the "shape" of an ID for fuzzy matching
 * e.g., "4a1 Triathlon Option" -> "4a1"
 *       "7 Option A (1)" -> "7a1"
 *       "2a[1] Ice" -> "2a1"
 */
function extractIdShape(id: string): string {
  // Remove option names and suffixes
  let shape = id
    .replace(/ (Triathlon|Duathlon|Aquathlon|Aquabike|Ice|Inline|Alpine|Snowboard|Nordic|Board|Roll|Line|avian|beef|dairy|hog|horse|rabbit|sheep|goat)( Option)?/gi, '')
    .replace(/ Option [A-H]/gi, '')
    .replace(/ Opt [A-H]/gi, '')

  // Extract just numbers and letters
  const match = shape.match(/(\d+)([a-z])?(\d+)?/i)
  if (match) {
    return (match[1] + (match[2] || '') + (match[3] || '')).toLowerCase()
  }
  return normalizeLabel(id)
}

/**
 * Match scraped requirements to canonical IDs using positional matching.
 *
 * Key insight: Canonical IDs and scraped requirements are in the SAME ORDER
 * within each badge version. We just need to:
 * 1. Filter out headers/main-reqs from scraped (they're not in canonical)
 * 2. Match trackable scraped items to canonical IDs by position
 */
function matchToCanonical(
  scrapedItems: RawScrapedItem[],
  canonicalIds: string[],
  badgeName: string,
  versionYear: number
): ScrapedRequirement[] {
  const results: ScrapedRequirement[] = []

  // Separate items by type
  const mainReqs: RawScrapedItem[] = []   // depth 0 - main requirement headers
  const headers: RawScrapedItem[] = []     // option/section headers
  const trackable: RawScrapedItem[] = []   // actual trackable requirements

  for (const item of scrapedItems) {
    if (item.depth === 0) {
      mainReqs.push(item)
    } else if (item.isHeader || !item.displayLabel) {
      headers.push(item)
    } else {
      trackable.push(item)
    }
  }

  // POSITIONAL MATCHING: Match trackable items to canonical IDs by order
  // This works because Scoutbook displays requirements in the same order as the CSV
  const usedCanonicalIndices = new Set<number>()

  for (let i = 0; i < trackable.length; i++) {
    const item = trackable[i]
    let matchedId: string | null = null
    let matchType: 'canonical' | 'constructed' = 'constructed'

    // Try direct positional match first
    if (i < canonicalIds.length && !usedCanonicalIndices.has(i)) {
      matchedId = canonicalIds[i]
      matchType = 'canonical'
      usedCanonicalIndices.add(i)
    }

    // If positional match failed, try shape matching as fallback
    if (!matchedId) {
      const scrapedShape = extractIdShape(item.displayLabel)

      for (let j = 0; j < canonicalIds.length; j++) {
        if (usedCanonicalIndices.has(j)) continue

        const canonicalShape = extractIdShape(canonicalIds[j])
        if (scrapedShape === canonicalShape) {
          matchedId = canonicalIds[j]
          matchType = 'canonical'
          usedCanonicalIndices.add(j)
          break
        }
      }
    }

    // Fallback: use scraped label
    if (!matchedId) {
      matchedId = item.displayLabel
      matchType = 'constructed'
    }

    results.push({
      number: matchedId,
      description: item.description,
      parentNumber: item.parentNumber,
      depth: item.depth,
      isHeader: false,
      matchType
    })
  }

  // Add main requirements (depth 0) - these are trackable but often not in CSV
  // because CSV only has sub-requirements
  for (const mainReq of mainReqs) {
    results.push({
      number: mainReq.displayLabel,
      description: mainReq.description,
      parentNumber: null,
      depth: 0,
      isHeader: false,
      matchType: 'constructed' // Main reqs typically aren't in canonical CSV
    })
  }

  // Add headers (option/section labels) - not trackable, for UI display
  for (const header of headers) {
    results.push({
      number: header.displayLabel || `_header_${header.sortOrder}`,
      description: header.description,
      parentNumber: header.parentNumber,
      depth: header.depth,
      isHeader: true,
      matchType: 'header'
    })
  }

  // Re-sort by original order
  results.sort((a, b) => {
    const aIdx = scrapedItems.findIndex(s => s.description === a.description)
    const bIdx = scrapedItems.findIndex(s => s.description === b.description)
    return aIdx - bIdx
  })

  return results
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
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function extractYearFromVersion(versionLabel: string): number {
  const match = versionLabel.match(/(\d{4})/)
  return match ? parseInt(match[1], 10) : new Date().getFullYear()
}

function saveProgress(progress: ScrapeProgress, filepath: string) {
  progress.lastUpdatedAt = new Date().toISOString()
  fs.writeFileSync(filepath, JSON.stringify(progress, null, 2))
}

// ============================================
// Popup/Overlay Handling
// ============================================

async function dismissSessionPopup(page: Page): Promise<boolean> {
  const dismissSelectors = [
    '.ant-modal-confirm-btns button:has-text("No")',
    '.ant-modal button:has-text("No")',
    'button:has-text("Stay logged in")',
    'button:has-text("Continue")',
    '.ant-modal-close',
  ]

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector)
      if (button && await button.isVisible()) {
        await button.click({ force: true })
        await page.waitForTimeout(300)
        return true
      }
    } catch {
      // Ignore
    }
  }
  return false
}

async function clearOverlays(page: Page): Promise<void> {
  await dismissSessionPopup(page)
  try {
    await page.evaluate(() => {
      document.querySelectorAll('[class*="toastify"], [class*="Toast__toast"]').forEach(el => {
        (el as HTMLElement).style.display = 'none'
      })
    })
  } catch {
    // Ignore
  }
  await page.waitForTimeout(100)
}

function setupPopupHandler(page: Page): void {
  setInterval(async () => {
    try {
      await dismissSessionPopup(page)
    } catch {
      // Ignore
    }
  }, 2000)
}

// ============================================
// Extraction Logic
// ============================================

async function extractRawRequirements(page: Page): Promise<RawScrapedItem[]> {
  return await page.evaluate(() => {
    const requirements: any[] = []
    const panels = document.querySelectorAll('.ant-collapse-item')
    let globalSortOrder = 0

    for (let p = 0; p < panels.length; p++) {
      const panel = panels[p]

      // Get main requirement number
      const circleLabel = panel.querySelector('[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]')
      const mainReqNum = circleLabel ? circleLabel.textContent?.trim() || '' : ''

      // Get main requirement description
      const firstContent = panel.querySelector('[class*="requirementContent"]')
      const parentDescription = firstContent ? firstContent.textContent?.trim() || '' : ''

      if (!mainReqNum) continue

      // Add main requirement (depth 0)
      requirements.push({
        displayLabel: mainReqNum,
        description: parentDescription.substring(0, 500),
        parentNumber: null,
        depth: 0,
        isHeader: false,
        sortOrder: globalSortOrder++
      })

      // Get sub-requirements
      const items = panel.querySelectorAll('[class*="requirementItemContainer"]')

      for (let i = 0; i < items.length; i++) {
        const item = items[i]

        // Get displayed label
        const itemNumber = item.querySelector('[class*="itemListNumber"]')
        const displayedLabel = itemNumber ? itemNumber.textContent?.trim() || '' : ''

        // Get description
        const contentDiv = item.querySelector('[class*="requirementContent"]')
        let description = ''
        if (contentDiv) {
          for (let n = 0; n < contentDiv.childNodes.length; n++) {
            const node = contentDiv.childNodes[n]
            if (node.nodeType === Node.TEXT_NODE || (node as Element).tagName === 'DIV') {
              description += (node.textContent || '') + ' '
            }
          }
        }
        description = description.trim()

        // Skip duplicates and "Select All"
        if (description.includes('Select All') || description === parentDescription) {
          continue
        }

        // Detect headers (no label, or option/section descriptions)
        const isOptionHeader = !displayedLabel && (
          /Option\s*[A-H]?\s*[-—:]/i.test(description) ||
          /(Triathlon|Duathlon|Aquathlon|Aquabike)\s*(Option)?/i.test(description) ||
          /^Option\s+[A-H]/i.test(description) ||
          /(Ice|Inline)\s+(Skating)?/i.test(description) ||
          /(Alpine|Snowboard|Nordic|Cross-Country)/i.test(description) ||
          /(Swimming|Biking|Running|Cycling)\.?\.?\.?$/i.test(description) ||
          /(avian|beef|dairy|hog|horse|rabbit|sheep|goat)\.?$/i.test(description)
        )

        // Detect section headers (short descriptions ending with sport name)
        const isSectionHeader = description.length < 30 && /(Swimming|Biking|Running|Cycling)\.?$/i.test(description)

        // Calculate depth based on label format
        let depth = 1
        if (displayedLabel.match(/^\(\d+\)$/) || displayedLabel.match(/^\d+$/)) {
          depth = 2 // Nested number like (1), (2)
        }
        if (displayedLabel.match(/^\([a-z]\)$/i)) {
          depth = displayedLabel.length === 3 ? 1 : 2 // (a) could be either
        }

        requirements.push({
          displayLabel: displayedLabel,
          description: description.substring(0, 500),
          parentNumber: mainReqNum,
          depth: isOptionHeader || isSectionHeader ? 1 : depth,
          isHeader: isOptionHeader || isSectionHeader || !displayedLabel,
          sortOrder: globalSortOrder++
        })
      }
    }

    return requirements
  })
}

async function getBadgeName(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const breadcrumb = document.querySelector('[class*="Breadcrumbs__current"]')
    if (breadcrumb) return breadcrumb.textContent?.trim() || ''
    const summaryName = document.querySelector('[class*="AdvSummary__advName"]')
    return summaryName?.textContent?.trim() || 'Unknown'
  })
}

async function getCurrentVersion(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const versionSelector = document.querySelector('[class*="VersionSelector__versionSelect"]')
    if (versionSelector) {
      const selectedValue = versionSelector.querySelector('.ant-select-selection-selected-value')
      return selectedValue?.getAttribute('title') || selectedValue?.textContent?.trim() || ''
    }
    return ''
  })
}

async function getAvailableVersions(page: Page): Promise<string[]> {
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) return []

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  const versions = await page.evaluate(() => {
    const options: string[] = []
    document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option').forEach(opt => {
      const text = opt.textContent?.trim()
      if (text && !options.includes(text)) {
        options.push(text)
      }
    })
    return options
  })

  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  return versions
}

async function selectVersion(page: Page, versionLabel: string): Promise<boolean> {
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) return false

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  const clicked = await page.evaluate((targetVersion) => {
    const options = Array.from(document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option'))
    for (const opt of options) {
      if (opt.textContent?.trim() === targetVersion) {
        (opt as HTMLElement).click()
        return true
      }
    }
    return false
  }, versionLabel)

  if (clicked) {
    await page.waitForTimeout(800)
  } else {
    await page.keyboard.press('Escape')
  }

  return clicked
}

// ============================================
// Main Scraping
// ============================================

async function scrapeBadgeVersion(
  page: Page,
  badgeName: string,
  versionLabel: string,
  canonicalData: CanonicalData
): Promise<ScrapedBadgeVersion> {
  const versionYear = extractYearFromVersion(versionLabel)

  // Get canonical IDs for this badge/version
  const canonicalIds = canonicalData[badgeName]?.[String(versionYear)] || []

  // Extract raw requirements from page
  const rawItems = await extractRawRequirements(page)

  // Match to canonical IDs
  const requirements = matchToCanonical(rawItems, canonicalIds, badgeName, versionYear)

  // Calculate stats
  const stats = {
    canonical: requirements.filter(r => r.matchType === 'canonical').length,
    constructed: requirements.filter(r => r.matchType === 'constructed').length,
    headers: requirements.filter(r => r.matchType === 'header').length
  }

  // Remove matchType from final output (it was for internal tracking)
  const cleanRequirements: ScrapedRequirement[] = requirements.map(r => ({
    number: r.number,
    description: r.description,
    parentNumber: r.parentNumber,
    depth: r.depth,
    ...(r.isHeader ? { isHeader: true } : {})
  }))

  return {
    badgeName,
    badgeSlug: slugify(badgeName),
    versionYear,
    versionLabel,
    requirements: cleanRequirements,
    matchStats: stats,
    scrapedAt: new Date().toISOString()
  }
}

async function scrapeBadge(
  page: Page,
  progress: ScrapeProgress,
  canonicalData: CanonicalData,
  outputPath: string
): Promise<void> {
  const badgeName = await getBadgeName(page)

  console.log(`\n  Badge: ${badgeName}`)
  progress.currentBadge = badgeName

  await clearOverlays(page)

  const versions = await getAvailableVersions(page)
  console.log(`  Versions available: ${versions.length > 0 ? versions.join(', ') : 'default only'}`)

  if (versions.length === 0) {
    const currentVersion = await getCurrentVersion(page) || 'Current'

    // Check duplicate
    if (progress.badges.some(b => b.badgeName === badgeName && b.versionLabel === currentVersion)) {
      console.log(`    ${currentVersion}: SKIPPED (duplicate)`)
      return
    }

    const badgeVersion = await scrapeBadgeVersion(page, badgeName, currentVersion, canonicalData)
    progress.badges.push(badgeVersion)

    const { matchStats } = badgeVersion
    console.log(`    ${currentVersion}: ${badgeVersion.requirements.length} reqs (${matchStats.canonical} canonical, ${matchStats.constructed} constructed, ${matchStats.headers} headers)`)
    return
  }

  for (const versionLabel of versions) {
    // Check duplicate
    if (progress.badges.some(b => b.badgeName === badgeName && b.versionLabel === versionLabel)) {
      console.log(`    ${versionLabel}: SKIPPED (duplicate)`)
      continue
    }

    await clearOverlays(page)

    const selected = await selectVersion(page, versionLabel)
    if (!selected) {
      console.log(`    Failed to select: ${versionLabel}`)
      continue
    }

    await page.waitForTimeout(500)

    const badgeVersion = await scrapeBadgeVersion(page, badgeName, versionLabel, canonicalData)
    progress.badges.push(badgeVersion)

    const { matchStats } = badgeVersion
    console.log(`    ${versionLabel}: ${badgeVersion.requirements.length} reqs (${matchStats.canonical} canonical, ${matchStats.constructed} constructed, ${matchStats.headers} headers)`)
  }
}

async function scrapeAllBadges(
  page: Page,
  canonicalData: CanonicalData,
  outputPath: string
): Promise<ScrapeProgress> {
  const progress: ScrapeProgress = {
    totalBadges: 0,
    completedBadges: 0,
    currentBadge: null,
    badges: [],
    errors: [],
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString()
  }

  // Get badge cards
  const badgeElements = await page.$$('[class*="MeritBadgeCard"], [class*="AdvancementCardItem"], .ant-card')

  const badgeNames: string[] = []
  for (const el of badgeElements) {
    const name = await el.evaluate(node => {
      const nameEl = node.querySelector('[class*="name"], [class*="Name"], .ant-card-meta-title')
      return nameEl?.textContent?.trim() || ''
    })
    if (name && !badgeNames.includes(name)) {
      badgeNames.push(name)
    }
  }

  progress.totalBadges = badgeNames.length
  console.log(`\nFound ${badgeNames.length} merit badges to scrape`)

  for (let i = 0; i < badgeNames.length; i++) {
    const badgeName = badgeNames[i]

    try {
      await clearOverlays(page)

      const nameEl = await page.$(`[class*="AdvancementCardItem__name"]:text-is("${badgeName}")`)
      if (!nameEl) {
        console.log(`  Could not find card for: "${badgeName}"`)
        continue
      }

      const card = await nameEl.evaluateHandle(el => el.closest('[class*="AdvancementCardItem"]'))
      if (!card) continue

      await (card as any).click({ force: true })
      await page.waitForSelector('[class*="VersionSelector"], [class*="AdvRequirements"]', { timeout: 20000 })
      await page.waitForTimeout(500)

      await scrapeBadge(page, progress, canonicalData, outputPath)
      progress.completedBadges++

      if (progress.completedBadges % 5 === 0) {
        saveProgress(progress, outputPath)
        console.log(`\n  Progress saved: ${progress.completedBadges} badges complete`)
      }

      await page.goBack()
      await page.waitForTimeout(500)

    } catch (err) {
      const errorMsg = `Error on ${badgeName}: ${err instanceof Error ? err.message : String(err)}`
      console.error(`  ${errorMsg}`)
      progress.errors.push(errorMsg)

      try {
        await page.goBack()
        await page.waitForTimeout(500)
      } catch {
        // Ignore
      }
    }
  }

  saveProgress(progress, outputPath)
  return progress
}

// ============================================
// Main
// ============================================

async function main() {
  const outputPath = 'data/merit-badge-requirements-canonical.json'
  const canonicalPath = 'data/scoutbook-requirement-ids.json'

  console.log('='.repeat(60))
  console.log('Canonical-Aware Merit Badge Scraper')
  console.log('='.repeat(60))
  console.log('')

  // Load canonical data
  if (!fs.existsSync(canonicalPath)) {
    console.error(`Canonical data not found: ${canonicalPath}`)
    console.error('Run: npx tsx scripts/analyze-csv-coverage.ts')
    process.exit(1)
  }

  const canonicalData: CanonicalData = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))
  const badgeCount = Object.keys(canonicalData).length
  console.log(`Loaded canonical data for ${badgeCount} badges`)
  console.log('')

  // Ensure data directory
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data', { recursive: true })
  }

  console.log('Starting browser...')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  })

  const page = await context.newPage()
  setupPopupHandler(page)

  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  console.log('')
  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook')
  console.log('2. Navigate to the Merit Badges list')
  console.log('')

  await waitForKeypress('Press Enter when ready...\n')

  try {
    const progress = await scrapeAllBadges(page, canonicalData, outputPath)

    console.log('')
    console.log('='.repeat(60))
    console.log('SCRAPING COMPLETE')
    console.log('='.repeat(60))
    console.log(`Total badges: ${progress.completedBadges}`)
    console.log(`Total versions: ${progress.badges.length}`)

    // Summary stats
    let totalCanonical = 0
    let totalConstructed = 0
    let totalHeaders = 0
    for (const badge of progress.badges) {
      totalCanonical += badge.matchStats.canonical
      totalConstructed += badge.matchStats.constructed
      totalHeaders += badge.matchStats.headers
    }

    console.log('')
    console.log('Match Statistics:')
    console.log(`  Canonical matches: ${totalCanonical}`)
    console.log(`  Constructed IDs:   ${totalConstructed}`)
    console.log(`  Headers:           ${totalHeaders}`)
    console.log('')
    console.log(`Output: ${outputPath}`)

  } catch (err) {
    console.error('Fatal error:', err)
  }

  await waitForKeypress('\nPress Enter to close browser...\n')
  await browser.close()
}

main().catch(console.error)
