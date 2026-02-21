#!/usr/bin/env npx tsx
/**
 * Scrape Requirement Resource Links from Scoutbook
 *
 * This script extracts resource URLs (videos, websites, PDFs) from
 * merit badge requirement pages on Scoutbook.
 *
 * Based on the existing scrape-all-merit-badges.ts architecture but
 * focused specifically on extracting resource link URLs that were
 * missed in the original scrape.
 *
 * Usage:
 *   npx tsx scripts/scrape-requirement-resources.ts
 *
 * Workflow:
 * 1. Browser launches - you log into Scoutbook manually
 * 2. Navigate to a scout's Merit Badges list
 * 3. Press Enter - scraper auto-navigates all badges
 * 4. Results saved to data/requirement-resources-scraped.json
 *
 * Press Ctrl+C to stop at any time (progress is saved every 5 badges).
 */

import { chromium, Page } from 'playwright'
import * as fs from 'fs'
import * as readline from 'readline'

// ============================================
// Types
// ============================================

interface ResourceLink {
  name: string           // Display text: "How to Use a Field Guide"
  url: string            // Full URL: "https://youtube.com/..."
  type: 'video' | 'website' | 'pdf' | 'external'
}

interface RequirementResources {
  requirementNumber: string   // The displayed requirement number (1, 2a, etc.)
  description: string         // First 100 chars of requirement text (for matching)
  resources: ResourceLink[]
}

interface BadgeVersionResources {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirements: RequirementResources[]
  totalResources: number
  scrapedAt: string
}

interface ScrapeProgress {
  totalBadges: number
  completedBadges: number
  skippedBadges: number
  currentBadge: string | null
  badges: BadgeVersionResources[]
  errors: string[]
  startedAt: string
  lastUpdatedAt: string
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

function extractYearFromVersion(versionLabel: string): number {
  const match = versionLabel.match(/(\d{4})/)
  return match ? parseInt(match[1], 10) : new Date().getFullYear()
}

function classifyLinkType(url: string, text: string): ResourceLink['type'] {
  const lowerUrl = url.toLowerCase()
  const lowerText = text.toLowerCase()

  if (lowerUrl.includes('.pdf') || lowerText.includes('(pdf)')) {
    return 'pdf'
  }
  if (lowerUrl.includes('youtube') || lowerUrl.includes('youtu.be') ||
      lowerUrl.includes('vimeo') || lowerText.includes('(video)')) {
    return 'video'
  }
  if (lowerText.includes('(website)')) {
    return 'website'
  }
  return 'external'
}

function saveProgress(progress: ScrapeProgress, filepath: string) {
  progress.lastUpdatedAt = new Date().toISOString()
  fs.writeFileSync(filepath, JSON.stringify(progress, null, 2))
}

// ============================================
// Popup Handling (from existing scraper)
// ============================================

async function dismissSessionPopup(page: Page): Promise<boolean> {
  const dismissSelectors = [
    '.ant-modal-confirm-btns button:has-text("No")',
    '.ant-modal button:has-text("No")',
    'button:has-text("Stay logged in")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    '.ant-modal-confirm-btns button.ant-btn-primary',
    '.ant-modal-close',
  ]

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector)
      if (button && await button.isVisible()) {
        await button.click({ force: true })
        console.log('  [Dismissed session popup]')
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
// Resource Extraction
// ============================================

/**
 * Extract resource links from all requirement panels on the current page.
 *
 * Strategy: For each requirement panel (.ant-collapse-item), find ALL <a> tags
 * with external hrefs. Resource links are typically rendered alongside or below
 * the requirement text, sometimes in the panel header, sometimes in the body.
 *
 * We search broadly within each panel rather than only in [class*="requirementContent"]
 * because resource links may be rendered in different DOM positions.
 */
async function extractResourceLinks(page: Page): Promise<RequirementResources[]> {
  return await page.evaluate(() => {
    const results: Array<{
      requirementNumber: string
      description: string
      resources: Array<{ name: string; url: string }>
    }> = []

    const panels = document.querySelectorAll('.ant-collapse-item')

    panels.forEach((panel) => {
      // Get the main requirement number
      const circleLabel = panel.querySelector(
        '[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]'
      )
      const mainReqNum = circleLabel?.textContent?.trim() || ''
      if (!mainReqNum) return

      // Get main requirement description (for matching)
      const firstContent = panel.querySelector('[class*="requirementContent"]')
      const description = (firstContent?.textContent?.trim() || '').substring(0, 100)

      // Find ALL anchor tags in the entire panel (broad search)
      const anchors = panel.querySelectorAll('a[href]')
      const panelResources: Array<{ name: string; url: string }> = []

      anchors.forEach((a) => {
        const href = (a as HTMLAnchorElement).getAttribute('href') || ''
        const text = a.textContent?.trim() || ''

        // Skip internal/navigation links
        if (!href || href.startsWith('javascript:') || href === '#') return
        if (href.startsWith('/') && !href.startsWith('//')) return
        if (!href.startsWith('http') && !href.startsWith('//')) return

        // Skip pamphlet/shop links (captured at badge level already)
        const lowerHref = href.toLowerCase()
        if (lowerHref.includes('scoutshop.org')) return
        if (lowerHref.includes('filestore.scouting.org') && lowerHref.includes('pamphlet')) return

        // Skip empty text links
        if (!text || text.length < 3) return

        // Avoid duplicates within this panel
        if (panelResources.some(r => r.url === href)) return

        panelResources.push({ name: text, url: href })
      })

      if (panelResources.length > 0) {
        results.push({
          requirementNumber: mainReqNum,
          description,
          resources: panelResources,
        })
      }

      // Also check sub-requirements within this panel for their own links
      // Sub-requirements are in [class*="requirementItemContainer"]
      const subItems = panel.querySelectorAll('[class*="requirementItemContainer"]')
      subItems.forEach((item) => {
        const itemNumber = item.querySelector('[class*="itemListNumber"]')
        const displayLabel = itemNumber?.textContent?.trim() || ''
        if (!displayLabel) return

        // Build full requirement number (e.g., "4" + "(a)" = "4a")
        const cleanLabel = displayLabel.replace(/[()[\]]/g, '').trim()
        const fullReqNum = `${mainReqNum}${cleanLabel}`

        const itemContent = item.querySelector('[class*="requirementContent"]')
        const itemDesc = (itemContent?.textContent?.trim() || '').substring(0, 100)

        const itemAnchors = item.querySelectorAll('a[href]')
        const itemResources: Array<{ name: string; url: string }> = []

        itemAnchors.forEach((a) => {
          const href = (a as HTMLAnchorElement).getAttribute('href') || ''
          const text = a.textContent?.trim() || ''

          if (!href || href.startsWith('javascript:') || href === '#') return
          if (href.startsWith('/') && !href.startsWith('//')) return
          if (!href.startsWith('http') && !href.startsWith('//')) return
          if (href.toLowerCase().includes('scoutshop.org')) return
          if (href.toLowerCase().includes('filestore.scouting.org') &&
              href.toLowerCase().includes('pamphlet')) return
          if (!text || text.length < 3) return
          if (itemResources.some(r => r.url === href)) return

          // Also skip if already captured at the panel level for this requirement
          if (results.some(r =>
            r.requirementNumber === mainReqNum &&
            r.resources.some(res => res.url === href)
          )) return

          itemResources.push({ name: text, url: href })
        })

        if (itemResources.length > 0) {
          results.push({
            requirementNumber: fullReqNum,
            description: itemDesc,
            resources: itemResources,
          })
        }
      })
    })

    return results
  }) as RequirementResources[]
}

// ============================================
// Navigation Helpers
// ============================================

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
    const options = Array.from(
      document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option')
    )
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
// Badge Scraping
// ============================================

async function scrapeBadgeResources(
  page: Page,
  progress: ScrapeProgress,
): Promise<void> {
  const badgeName = await getBadgeName(page)
  console.log(`\n  Badge: ${badgeName}`)
  progress.currentBadge = badgeName

  await clearOverlays(page)

  // Expand all collapsed panels first so links are in the DOM
  await page.evaluate(() => {
    document.querySelectorAll('.ant-collapse-item:not(.ant-collapse-item-active)').forEach(panel => {
      const header = panel.querySelector('.ant-collapse-header') as HTMLElement
      if (header) header.click()
    })
  })
  await page.waitForTimeout(500)

  const versions = await getAvailableVersions(page)

  if (versions.length === 0) {
    // Single version badge
    const currentVersion = await getCurrentVersion(page) || 'Current'
    const versionYear = extractYearFromVersion(currentVersion)

    const requirements = await extractResourceLinks(page)

    // Classify link types
    const classified = requirements.map(req => ({
      ...req,
      resources: req.resources.map(r => ({
        ...r,
        type: classifyLinkType(r.url, r.name),
      })),
    }))

    const totalResources = classified.reduce((sum, r) => sum + r.resources.length, 0)

    if (totalResources > 0) {
      progress.badges.push({
        badgeName,
        versionYear,
        versionLabel: currentVersion,
        requirements: classified,
        totalResources,
        scrapedAt: new Date().toISOString(),
      })
      console.log(`    ${currentVersion}: ${totalResources} resources found`)
    } else {
      console.log(`    ${currentVersion}: no resources`)
      progress.skippedBadges++
    }
    return
  }

  // Scrape only the ACTIVE version (most recent) — that's what we display
  // The active version is typically the first or has "(Active)" in the label
  const activeVersion = versions.find(v => v.includes('Active')) || versions[0]

  // Check if already scraped
  const isDuplicate = progress.badges.some(
    b => b.badgeName === badgeName && b.versionLabel === activeVersion
  )
  if (isDuplicate) {
    console.log(`    SKIPPED (already scraped)`)
    progress.skippedBadges++
    return
  }

  await clearOverlays(page)
  const selected = await selectVersion(page, activeVersion)
  if (!selected) {
    console.log(`    Failed to select version: ${activeVersion}`)
    return
  }

  await page.waitForTimeout(500)

  // Expand all panels after version switch
  await page.evaluate(() => {
    document.querySelectorAll('.ant-collapse-item:not(.ant-collapse-item-active)').forEach(panel => {
      const header = panel.querySelector('.ant-collapse-header') as HTMLElement
      if (header) header.click()
    })
  })
  await page.waitForTimeout(500)

  const requirements = await extractResourceLinks(page)
  const classified = requirements.map(req => ({
    ...req,
    resources: req.resources.map(r => ({
      ...r,
      type: classifyLinkType(r.url, r.name),
    })),
  }))

  const totalResources = classified.reduce((sum, r) => sum + r.resources.length, 0)

  if (totalResources > 0) {
    progress.badges.push({
      badgeName,
      versionYear: extractYearFromVersion(activeVersion),
      versionLabel: activeVersion,
      requirements: classified,
      totalResources,
      scrapedAt: new Date().toISOString(),
    })
    console.log(`    ${activeVersion}: ${totalResources} resources found`)
  } else {
    console.log(`    ${activeVersion}: no resources`)
    progress.skippedBadges++
  }
}

async function scrapeAllBadges(page: Page, outputPath: string): Promise<ScrapeProgress> {
  // Load existing progress if available (resume support)
  let progress: ScrapeProgress
  if (fs.existsSync(outputPath)) {
    progress = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
    console.log(`\nResuming from previous run: ${progress.completedBadges} badges already scraped`)
  } else {
    progress = {
      totalBadges: 0,
      completedBadges: 0,
      skippedBadges: 0,
      currentBadge: null,
      badges: [],
      errors: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    }
  }

  // Get badge names from already-scraped data to skip
  const alreadyScraped = new Set(progress.badges.map(b => b.badgeName))

  // Find all badge cards on the list page
  const badgeNames: string[] = await page.evaluate(() => {
    const names: string[] = []
    document.querySelectorAll('[class*="AdvancementCardItem__name"]').forEach(el => {
      const name = el.textContent?.trim()
      if (name && !names.includes(name)) names.push(name)
    })
    return names
  })

  // Fallback: try badge links
  if (badgeNames.length === 0) {
    const links = await page.$$('a[href*="meritBadges/"]')
    console.log(`Found ${links.length} badge links (fallback mode)`)
  }

  progress.totalBadges = badgeNames.length
  console.log(`\nFound ${badgeNames.length} merit badges`)
  console.log(`Already scraped: ${alreadyScraped.size}`)
  console.log(`Remaining: ${badgeNames.length - alreadyScraped.size}`)

  for (let i = 0; i < badgeNames.length; i++) {
    const badgeName = badgeNames[i]

    // Skip if already scraped in a previous run
    if (alreadyScraped.has(badgeName)) {
      continue
    }

    try {
      await clearOverlays(page)

      // Find and click the badge card
      const nameEl = await page.$(
        `[class*="AdvancementCardItem__name"]:text-is("${badgeName}")`
      )
      if (!nameEl) {
        console.log(`  Could not find card for: "${badgeName}"`)
        continue
      }

      const card = await nameEl.evaluateHandle(
        el => el.closest('[class*="AdvancementCardItem"]')
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (card as any).click({ force: true })

      await page.waitForSelector(
        '[class*="VersionSelector"], [class*="AdvRequirements"]',
        { timeout: 20000 }
      )
      await page.waitForTimeout(500)

      await scrapeBadgeResources(page, progress)
      progress.completedBadges++

      // Save progress every 5 badges
      if (progress.completedBadges % 5 === 0) {
        saveProgress(progress, outputPath)
        console.log(`\n  [Progress saved: ${progress.completedBadges}/${progress.totalBadges}]`)
      }

      // Go back to list
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
        // Ignore recovery errors
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
  const outputPath = 'data/requirement-resources-scraped.json'

  console.log('='.repeat(60))
  console.log('Scoutbook Requirement Resource Links Scraper')
  console.log('='.repeat(60))
  console.log('')
  console.log('This script extracts resource URLs (videos, websites, PDFs)')
  console.log('from merit badge requirement pages on Scoutbook.')
  console.log('')
  console.log(`Output: ${outputPath}`)
  console.log('')

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

  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook')
  console.log('2. Navigate to a scout\'s Merit Badges list')
  console.log('   (The page should show a grid of all merit badges)')
  console.log('')

  await waitForKeypress('Press Enter when you\'re on the Merit Badges list page...\n')

  const currentUrl = page.url()
  console.log(`Starting scrape from: ${currentUrl}`)

  try {
    const progress = await scrapeAllBadges(page, outputPath)

    const totalResources = progress.badges.reduce((sum, b) => sum + b.totalResources, 0)

    console.log('')
    console.log('='.repeat(60))
    console.log('SCRAPING COMPLETE')
    console.log('='.repeat(60))
    console.log(`Badges scraped: ${progress.completedBadges}`)
    console.log(`Badges with resources: ${progress.badges.length}`)
    console.log(`Total resource links: ${totalResources}`)
    console.log(`Badges without resources: ${progress.skippedBadges}`)
    console.log(`Errors: ${progress.errors.length}`)
    console.log(`Output: ${outputPath}`)

    if (progress.errors.length > 0) {
      console.log('')
      console.log('Errors:')
      progress.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`))
    }

  } catch (err) {
    console.error('Fatal error:', err)
  }

  console.log('')
  await waitForKeypress('Press Enter to close the browser...\n')
  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
