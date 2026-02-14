/**
 * Test script for single badge scraping
 *
 * Tests the enhanced scraper on a single badge to validate:
 * - Visual depth detection
 * - Checkbox detection
 * - Link extraction
 * - Raw HTML capture
 *
 * Usage:
 *   npx tsx scripts/test-single-badge-scrape.ts "First Aid" [version_year]
 *   npx tsx scripts/test-single-badge-scrape.ts "Environmental Science" 2020
 *   npx tsx scripts/test-single-badge-scrape.ts "Multisport" 2025
 *
 * Recommended test versions:
 *   - First Aid: 2022 (standard 2-level hierarchy)
 *   - Environmental Science: 2020 (bracket notation 3a[1], 3b[2])
 *   - Multisport: 2025 (4-deep nesting with named options)
 *
 * The script will:
 * 1. Launch browser - you log in manually
 * 2. Navigate to the specified badge and version
 * 3. Scrape requirements
 * 4. Compare against expected results if available
 * 5. Output detailed results for inspection
 */

import { chromium, Page } from 'playwright'
import * as fs from 'fs'
import * as readline from 'readline'

// Types (matching main scraper)
interface ScrapedLink {
  url: string
  text: string
  context: string
  type: 'pamphlet' | 'worksheet' | 'video' | 'external'
}

interface ScrapedRequirement {
  displayLabel: string
  description: string
  parentNumber: string | null
  depth: number
  visualDepth: number
  isHeader: boolean
  hasCheckbox: boolean
  links: ScrapedLink[]
  rawHtml?: string
}

interface TestResult {
  badgeName: string
  versionLabel: string
  versionYear: number
  requirements: ScrapedRequirement[]
  stats: {
    totalRequirements: number
    headersCount: number
    checkboxCount: number
    totalLinks: number
    maxVisualDepth: number
    maxLogicalDepth: number
    depthDistribution: Record<number, number>
  }
  scrapedAt: string
}

// Utilities
function waitForKeypress(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

function classifyLinkType(url: string, text: string): 'pamphlet' | 'worksheet' | 'video' | 'external' {
  const lowerUrl = url.toLowerCase()
  const lowerText = text.toLowerCase()

  if (lowerUrl.includes('pamphlet') || lowerText.includes('pamphlet')) {
    return 'pamphlet'
  }
  if (lowerUrl.includes('worksheet') || lowerText.includes('worksheet') || lowerUrl.includes('.pdf')) {
    return 'worksheet'
  }
  if (lowerUrl.includes('youtube') || lowerUrl.includes('video') || lowerText.includes('video') || lowerUrl.includes('vimeo')) {
    return 'video'
  }
  return 'external'
}

function extractYearFromVersion(versionLabel: string): number {
  const match = versionLabel.match(/(\d{4})/)
  return match ? parseInt(match[1], 10) : new Date().getFullYear()
}

// Extraction logic (same as main scraper)
async function extractRequirements(page: Page): Promise<ScrapedRequirement[]> {
  const rawRequirements = await page.evaluate(`
    (function() {
      var requirements = [];
      var panels = document.querySelectorAll('.ant-collapse-item');

      function getVisualDepth(element) {
        var depth = 0;
        var current = element.parentElement;
        while (current) {
          if (current.matches && (
            current.matches('[class*="ant-collapse-content"]') ||
            current.matches('[class*="requirementItemContainer"]') ||
            current.matches('[class*="NestedRequirement"]')
          )) {
            depth++;
          }
          current = current.parentElement;
        }
        return Math.min(depth, 4);
      }

      function hasCheckbox(element) {
        return !!(
          element.querySelector('input[type="checkbox"]') ||
          element.querySelector('[class*="ant-checkbox"]') ||
          element.querySelector('[class*="Checkbox"]') ||
          element.querySelector('[class*="checkmark"]')
        );
      }

      function extractLinks(element) {
        var links = [];
        var anchors = element.querySelectorAll('a[href]');
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i];
          var href = a.getAttribute('href') || '';
          var text = a.textContent?.trim() || '';
          if (!href || href.startsWith('javascript:') || href === '#') continue;
          var context = a.parentElement?.textContent?.trim() || '';
          links.push({
            url: href,
            text: text,
            context: context.substring(0, 200)
          });
        }
        return links;
      }

      for (var p = 0; p < panels.length; p++) {
        var panel = panels[p];

        var circleLabel = panel.querySelector('[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]');
        var mainReqNum = circleLabel ? circleLabel.textContent.trim() : '';

        var firstContent = panel.querySelector('[class*="requirementContent"]');
        var parentDescription = firstContent ? firstContent.textContent.trim() : '';

        if (!mainReqNum) continue;

        var headerElement = panel.querySelector('[class*="ant-collapse-header"]');
        var mainRawHtml = headerElement ? headerElement.innerHTML.substring(0, 500) : '';
        var mainLinks = firstContent ? extractLinks(firstContent) : [];
        var mainHasCheckbox = hasCheckbox(panel);

        requirements.push({
          displayLabel: mainReqNum,
          description: parentDescription.substring(0, 300),
          parentNumber: null,
          depth: 0,
          visualDepth: 0,
          isHeader: !mainHasCheckbox,
          hasCheckbox: mainHasCheckbox,
          links: mainLinks,
          rawHtml: mainRawHtml
        });

        var items = panel.querySelectorAll('[class*="requirementItemContainer"]');

        for (var i = 0; i < items.length; i++) {
          var item = items[i];

          var visualDepth = getVisualDepth(item);

          var itemNumber = item.querySelector('[class*="itemListNumber"]');
          var displayedLabel = itemNumber ? itemNumber.textContent.trim() : '';

          var contentDiv = item.querySelector('[class*="requirementContent"]');
          var description = '';
          if (contentDiv) {
            for (var n = 0; n < contentDiv.childNodes.length; n++) {
              var node = contentDiv.childNodes[n];
              if (node.nodeType === Node.TEXT_NODE || node.tagName === 'DIV') {
                description += (node.textContent || '') + ' ';
              }
            }
          }
          description = description.trim();

          // Skip "Select All" controls and duplicate parent descriptions
          if (description === 'Select All' || description === parentDescription) {
            continue;
          }

          // Skip items that look like "Select All" controls
          var itemClasses = item.className || '';
          if (itemClasses.includes('selectAll') || itemClasses.includes('SelectAll')) {
            continue;
          }

          var itemLinks = contentDiv ? extractLinks(contentDiv) : [];
          var itemHasCheckbox = hasCheckbox(item);
          var itemRawHtml = item.innerHTML ? item.innerHTML.substring(0, 500) : '';

          // Items without checkboxes are headers (section labels, option names, etc.)
          var isNoCheckboxHeader = !itemHasCheckbox;

          if (!displayedLabel && !description) continue;

          var depth = visualDepth > 0 ? visualDepth : 1;

          requirements.push({
            displayLabel: displayedLabel,
            description: description.substring(0, 300),
            parentNumber: mainReqNum,
            depth: depth,
            visualDepth: visualDepth,
            isHeader: isNoCheckboxHeader,
            hasCheckbox: itemHasCheckbox,
            links: itemLinks,
            rawHtml: itemRawHtml
          });
        }
      }

      return requirements;
    })()
  `) as Array<{
    displayLabel: string
    description: string
    parentNumber: string | null
    depth: number
    visualDepth: number
    isHeader: boolean
    hasCheckbox: boolean
    links: Array<{ url: string; text: string; context: string }>
    rawHtml: string
  }>

  return rawRequirements.map((req) => ({
    ...req,
    links: req.links.map((link) => ({
      ...link,
      type: classifyLinkType(link.url, link.text),
    })),
  }))
}

async function getCurrentVersion(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const versionSelector = document.querySelector('[class*="VersionSelector__versionSelect"]')
    if (versionSelector) {
      const selectedValue = versionSelector.querySelector('.ant-select-selection-selected-value')
      return selectedValue?.getAttribute('title') || selectedValue?.textContent?.trim() || ''
    }
    return 'Current'
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

// Dismiss session popups
async function dismissSessionPopup(page: Page): Promise<boolean> {
  const dismissSelectors = [
    '.ant-modal-confirm-btns button:has-text("No")',
    '.ant-modal button:has-text("No")',
    'button:has-text("No")',
    'button:has-text("Stay logged in")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    '.ant-modal-close',
  ]

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector)
      if (button && (await button.isVisible())) {
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

// Load test expectations
interface TestExpectation {
  badge_name: string
  target_version: number
  version_notes: string
  expected: {
    total_requirements_min: number
    total_requirements_max: number
    max_visual_depth: number
    headers_expected: boolean
    csv_requirement_ids: string[]
  }
  validation_checks: string[]
}

function loadExpectations(badgeName: string): TestExpectation | null {
  const expectationsPath = 'data/test-badge-expectations.json'
  if (!fs.existsSync(expectationsPath)) return null

  const data = JSON.parse(fs.readFileSync(expectationsPath, 'utf-8'))
  const expectation = data.test_badges.find(
    (t: TestExpectation) => t.badge_name.toLowerCase() === badgeName.toLowerCase()
  )
  return expectation || null
}

// Version selection
async function getAvailableVersions(page: Page): Promise<string[]> {
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) return []

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  const versions = await page.evaluate(() => {
    const options: string[] = []
    document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option').forEach((opt) => {
      const text = opt.textContent?.trim()
      if (text && !options.includes(text)) options.push(text)
    })
    return options
  })

  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  return versions
}

async function selectVersion(page: Page, targetYear: number): Promise<boolean> {
  const versions = await getAvailableVersions(page)
  const targetVersion = versions.find((v) => v.includes(String(targetYear)))

  if (!targetVersion) {
    console.log(`Version ${targetYear} not found. Available: ${versions.join(', ')}`)
    return false
  }

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
        ;(opt as HTMLElement).click()
        return true
      }
    }
    return false
  }, targetVersion)

  if (clicked) {
    await page.waitForTimeout(800)
    console.log(`Selected version: ${targetVersion}`)
  }

  return clicked
}

// Main
async function main() {
  const badgeNameArg = process.argv[2]
  const targetVersionArg = process.argv[3] ? parseInt(process.argv[3], 10) : null

  if (!badgeNameArg) {
    console.error('Usage: npx tsx scripts/test-single-badge-scrape.ts "Badge Name" [version_year]')
    console.error('')
    console.error('Examples:')
    console.error('  npx tsx scripts/test-single-badge-scrape.ts "First Aid" 2022')
    console.error('  npx tsx scripts/test-single-badge-scrape.ts "Environmental Science" 2020')
    console.error('  npx tsx scripts/test-single-badge-scrape.ts "Multisport" 2025')
    process.exit(1)
  }

  // Load expectations
  const expectations = loadExpectations(badgeNameArg)
  const targetVersion = targetVersionArg || expectations?.target_version

  if (expectations) {
    console.log(`Found test expectations for ${badgeNameArg}`)
    console.log(`  Target version: ${expectations.target_version}`)
    console.log(`  Notes: ${expectations.version_notes}`)
  }

  console.log('='.repeat(60))
  console.log(`Single Badge Scraper Test: ${badgeNameArg}`)
  console.log('='.repeat(60))
  console.log('')

  // Ensure data directory exists
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data', { recursive: true })
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  })

  const page = await context.newPage()

  // Set up periodic popup dismissal
  setInterval(async () => {
    try {
      await dismissSessionPopup(page)
    } catch {
      // Ignore
    }
  }, 2000)

  // Navigate to Scoutbook
  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook')
  console.log(`2. Navigate to the "${badgeNameArg}" merit badge page`)
  console.log('')
  console.log('The page should show the requirement list for the badge.')
  console.log('')

  await waitForKeypress(`Press Enter when you're on the "${badgeNameArg}" requirements page...\n`)

  // Verify we're on the right badge
  const actualBadgeName = await getBadgeName(page)
  console.log(`\nDetected badge: ${actualBadgeName}`)

  // Select target version if specified
  if (targetVersion) {
    console.log(`\nSelecting version ${targetVersion}...`)
    const selected = await selectVersion(page, targetVersion)
    if (!selected) {
      console.warn(`Could not select version ${targetVersion}`)
    }
    await page.waitForTimeout(500)
  }

  if (!actualBadgeName.toLowerCase().includes(badgeNameArg.toLowerCase())) {
    console.warn(`Warning: Expected "${badgeNameArg}" but found "${actualBadgeName}"`)
    const proceed = await waitForKeypress('Continue anyway? (y/n): ')
    if (proceed.toLowerCase() !== 'y') {
      await browser.close()
      process.exit(1)
    }
  }

  // Get current version
  const versionLabel = await getCurrentVersion(page)
  const versionYear = extractYearFromVersion(versionLabel)
  console.log(`Version: ${versionLabel} (year: ${versionYear})`)

  // Scrape requirements
  console.log('\nScraping requirements...')
  await page.waitForTimeout(1000) // Let page settle
  const requirements = await extractRequirements(page)

  // Calculate stats
  const stats = {
    totalRequirements: requirements.length,
    headersCount: requirements.filter((r) => r.isHeader).length,
    checkboxCount: requirements.filter((r) => r.hasCheckbox).length,
    totalLinks: requirements.reduce((sum, r) => sum + r.links.length, 0),
    maxVisualDepth: Math.max(0, ...requirements.map((r) => r.visualDepth)),
    maxLogicalDepth: Math.max(0, ...requirements.map((r) => r.depth)),
    depthDistribution: requirements.reduce(
      (acc, r) => {
        acc[r.visualDepth] = (acc[r.visualDepth] || 0) + 1
        return acc
      },
      {} as Record<number, number>
    ),
  }

  const result: TestResult = {
    badgeName: actualBadgeName,
    versionLabel,
    versionYear,
    requirements,
    stats,
    scrapedAt: new Date().toISOString(),
  }

  // Output summary
  console.log('\n' + '='.repeat(60))
  console.log('SCRAPE RESULTS')
  console.log('='.repeat(60))
  console.log(`Badge: ${actualBadgeName}`)
  console.log(`Version: ${versionLabel}`)
  console.log('')
  console.log('Statistics:')
  console.log(`  Total requirements: ${stats.totalRequirements}`)
  console.log(`  Headers: ${stats.headersCount}`)
  console.log(`  With checkbox: ${stats.checkboxCount}`)
  console.log(`  Total links: ${stats.totalLinks}`)
  console.log(`  Max visual depth: ${stats.maxVisualDepth}`)
  console.log(`  Max logical depth: ${stats.maxLogicalDepth}`)
  console.log(`  Depth distribution: ${JSON.stringify(stats.depthDistribution)}`)

  // Determine nesting level from label pattern
  function getLabelLevel(label: string, description: string): number {
    if (!label) {
      // Named headers like "Triathlon Option"
      if (/Option|Swimming|Biking|Running|Cycling|Ice|Inline|Alpine|Nordic/i.test(description)) {
        return 1
      }
      return 0
    }

    const cleanLabel = label.replace(/[()[\].]/g, '').trim()

    // Main requirement numbers: 1, 2, 3... (always level 0)
    if (/^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 20) {
      return 0
    }

    // Letter labels: a, b, c...
    if (/^[a-z]$/i.test(cleanLabel)) {
      return 2
    }

    // Sub-numbers under letters: 1, 2, 3 (context determines this is level 3)
    if (/^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 10) {
      return 3
    }

    return 1
  }

  // Check if label is a main requirement number (1, 2, 3... WITHOUT parentheses)
  // (1), (2), (3) are sub-requirements, not main headers
  function isMainRequirementNumber(label: string): boolean {
    if (!label) return false
    const trimmed = label.trim()
    // Must NOT start with parenthesis - those are sub-requirements
    if (trimmed.startsWith('(')) return false
    const cleanLabel = trimmed.replace(/[[\].]/g, '').trim()
    return /^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 20
  }

  // Show hierarchy with computed levels
  console.log('\n' + '-'.repeat(60))
  console.log('REQUIREMENT HIERARCHY')
  console.log('-'.repeat(60))

  const levelStack: { level: number; label: string }[] = []

  for (const req of requirements) {
    let displayLevel: number

    // Main requirement numbers are ALWAYS headers for hierarchy, regardless of checkbox
    const isEffectiveHeader = req.isHeader || isMainRequirementNumber(req.displayLabel)

    if (isEffectiveHeader) {
      const headerLevel = getLabelLevel(req.displayLabel, req.description)
      // Pop stack to find parent level
      while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= headerLevel) {
        levelStack.pop()
      }
      displayLevel = levelStack.length
      levelStack.push({ level: headerLevel, label: req.displayLabel || req.description })
    } else {
      // Requirements are children of current header
      displayLevel = levelStack.length
    }

    const indent = '  '.repeat(displayLevel)
    const checkbox = req.hasCheckbox && !isMainRequirementNumber(req.displayLabel) ? '[x]' : '[ ]'
    const header = isEffectiveHeader ? ' (HEADER)' : ''
    const links = req.links.length > 0 ? ` [${req.links.length} links]` : ''

    if (req.displayLabel) {
      // Has a label like (a), (1), 4, etc - show label and description
      const desc = req.description.substring(0, 60) + (req.description.length > 60 ? '...' : '')
      console.log(`${indent}${checkbox} ${req.displayLabel}${header}${links}`)
      console.log(`${indent}   ${desc}`)
    } else {
      // No label - use description as the label (for named headers like "Triathlon Option")
      const desc = req.description.substring(0, 60) + (req.description.length > 60 ? '...' : '')
      console.log(`${indent}${checkbox} ${desc}${header}${links}`)
    }
  }

  // Show links if any
  if (stats.totalLinks > 0) {
    console.log('\n' + '-'.repeat(60))
    console.log('EXTRACTED LINKS')
    console.log('-'.repeat(60))

    for (const req of requirements) {
      if (req.links.length > 0) {
        console.log(`\n${req.displayLabel || '[header]'}:`)
        for (const link of req.links) {
          console.log(`  [${link.type}] ${link.text}`)
          console.log(`    URL: ${link.url}`)
        }
      }
    }
  }

  // Save output
  const outputPath = `data/test-scrape-${actualBadgeName.toLowerCase().replace(/\s+/g, '-')}.json`
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2))
  console.log(`\nOutput saved to: ${outputPath}`)

  // Compare with CSV if available
  const csvDataPath = 'data/csv-requirement-ids.json'
  if (fs.existsSync(csvDataPath)) {
    const csvData = JSON.parse(fs.readFileSync(csvDataPath, 'utf-8'))
    const badgeVersions = csvData.badges.filter(
      (b: { badgeName: string }) => b.badgeName.toLowerCase() === actualBadgeName.toLowerCase()
    )

    if (badgeVersions.length > 0) {
      console.log('\n' + '-'.repeat(60))
      console.log('CSV COMPARISON')
      console.log('-'.repeat(60))

      const matchingVersion = badgeVersions.find((v: { versionYear: number }) => v.versionYear === versionYear)

      if (matchingVersion) {
        console.log(`Found CSV data for ${actualBadgeName} version ${versionYear}`)
        console.log(`CSV requirement IDs: ${matchingVersion.requirementIds.length}`)
        console.log(`Scraped items with checkboxes: ${stats.checkboxCount}`)

        // Find items in CSV not in scraped (excluding headers)
        const scrapedLabels = requirements.filter((r) => r.hasCheckbox && r.displayLabel).map((r) => r.displayLabel)

        console.log(`\nCSV IDs: ${matchingVersion.requirementIds.slice(0, 10).join(', ')}${matchingVersion.requirementIds.length > 10 ? '...' : ''}`)
        console.log(`Scraped labels: ${scrapedLabels.slice(0, 10).join(', ')}${scrapedLabels.length > 10 ? '...' : ''}`)
      } else {
        console.log(`No CSV data found for version ${versionYear}`)
        console.log(`Available versions: ${badgeVersions.map((v: { versionYear: number }) => v.versionYear).join(', ')}`)
      }
    } else {
      console.log(`\nNo CSV data found for badge: ${actualBadgeName}`)
    }
  }

  // Expectations comparison
  if (expectations && versionYear === expectations.target_version) {
    console.log('\n' + '-'.repeat(60))
    console.log('EXPECTATIONS COMPARISON')
    console.log('-'.repeat(60))

    const exp = expectations.expected
    const checks: { name: string; passed: boolean; details: string }[] = []

    // Check requirement count
    const countPassed =
      stats.totalRequirements >= exp.total_requirements_min &&
      stats.totalRequirements <= exp.total_requirements_max
    checks.push({
      name: 'Requirement count',
      passed: countPassed,
      details: `${stats.totalRequirements} (expected ${exp.total_requirements_min}-${exp.total_requirements_max})`,
    })

    // Check max depth
    const depthPassed = stats.maxVisualDepth <= exp.max_visual_depth + 1 // Allow +1 for flexibility
    checks.push({
      name: 'Max visual depth',
      passed: depthPassed,
      details: `${stats.maxVisualDepth} (expected ~${exp.max_visual_depth})`,
    })

    // Check headers exist
    const headersPassed = exp.headers_expected ? stats.headersCount > 0 : true
    checks.push({
      name: 'Headers detected',
      passed: headersPassed,
      details: `${stats.headersCount} headers found`,
    })

    // Check CSV ID coverage
    const scrapedIds = requirements
      .filter((r) => r.hasCheckbox || r.displayLabel)
      .map((r) => r.displayLabel)
      .filter(Boolean)
    const expectedIds = exp.csv_requirement_ids
    const matchedIds = expectedIds.filter((csvId) =>
      scrapedIds.some((scraped) => {
        const normCsv = csvId.replace(/[()[\]]/g, '').replace(/\.$/, '').toLowerCase()
        const normScraped = scraped.replace(/[()[\]]/g, '').replace(/\.$/, '').toLowerCase()
        return normCsv === normScraped || normCsv.includes(normScraped) || normScraped.includes(normCsv)
      })
    )
    const coveragePct = Math.round((matchedIds.length / expectedIds.length) * 100)
    checks.push({
      name: 'CSV ID coverage',
      passed: coveragePct >= 50, // At least 50% coverage
      details: `${matchedIds.length}/${expectedIds.length} matched (${coveragePct}%)`,
    })

    // Print results
    console.log('')
    for (const check of checks) {
      const icon = check.passed ? '✓' : '✗'
      console.log(`${icon} ${check.name}: ${check.details}`)
    }

    const allPassed = checks.every((c) => c.passed)
    console.log('')
    console.log(allPassed ? '✓ ALL CHECKS PASSED' : '✗ SOME CHECKS FAILED')

    // Print validation checklist
    console.log('')
    console.log('Manual validation checklist:')
    expectations.validation_checks.forEach((check, i) => {
      console.log(`  ${i + 1}. [ ] ${check}`)
    })
  }

  console.log('')
  await waitForKeypress('Press Enter to close the browser...\n')

  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
