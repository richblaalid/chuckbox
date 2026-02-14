/**
 * Automated Scoutbook Merit Badge Requirements Scraper
 *
 * Usage:
 *   npx tsx scripts/scrape-all-merit-badges.ts
 *
 * This script will:
 * 1. Launch a browser - you log in to Scoutbook manually
 * 2. Navigate to a scout's Merit Badges list
 * 3. Automatically scrape all badges with up to 3 versions each
 * 4. Save results to data/merit-badge-requirements-scraped.json
 *
 * Press Ctrl+C to stop the script at any time.
 */

import { chromium, Page, ElementHandle } from 'playwright'
import * as fs from 'fs'
import * as readline from 'readline'

// ============================================
// Types
// ============================================

interface HierarchyPosition {
  mainReq: string              // Main requirement number (1, 2, 3...)
  option?: string              // Option name (e.g., "Triathlon", "Option A")
  optionLetter?: string        // Option letter for 2026 format (A, B, C, D)
  section?: string             // Section identifier (a, b, 1, 2...)
  item?: string                // Item identifier within section
}

interface ScrapedLink {
  url: string                  // Full href
  text: string                 // Link text
  context: string              // Surrounding text
  type: 'pamphlet' | 'worksheet' | 'video' | 'external'  // Inferred type
}

interface ScrapedRequirement {
  id: string                   // Constructed canonical Scoutbook ID
  displayLabel: string         // The displayed label exactly as shown (e.g., "(a)", "(1)")
  description: string          // The requirement text
  parentNumber: string | null  // The main requirement number this belongs to
  depth: number                // Nesting depth for display (0 = main, 1+ = sub-requirements)
  visualDepth: number          // Actual DOM nesting depth (0-4)
  isHeader?: boolean           // True if this is an option/section header
  hasCheckbox: boolean         // True if item has a checkbox (completable)
  links: ScrapedLink[]         // Extracted links from content
  rawHtml?: string             // Raw HTML for debugging complex cases
  position?: HierarchyPosition // Full hierarchy position for ID construction
}

interface ScrapedBadgeVersion {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
  scrapedAt: string
  totalLinks: number           // Count of all links extracted
  totalCheckboxes: number      // Count of items with checkboxes
  maxDepth: number             // Maximum visual depth observed
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
// ID Construction
// ============================================

/**
 * Construct canonical Scoutbook ID based on version year and hierarchy position.
 *
 * Pre-2026 formats:
 *   - Simple: 1a, 2b, 3c
 *   - Bracket: 2b[1], 5a[3]
 *   - Named option: 4a1 Triathlon Option, 5a Opt B
 *
 * 2026+ formats:
 *   - Simple: 1(a), 2(b), 3(c)
 *   - Nested: 2(a)(1), 4(b)(3)
 *   - Option: 4 Option A (1)(a), 5 Option B (2)
 */
function constructScoutbookId(
  position: HierarchyPosition,
  versionYear: number,
  badgeName: string
): string {
  const { mainReq, option, optionLetter, section, item } = position
  const is2026Format = versionYear >= 2026

  // Main requirement only (no sub-requirements)
  if (!section && !item && !option) {
    return mainReq
  }

  // Simple sub-requirement (no options)
  if (!option && section && !item) {
    if (is2026Format) {
      return `${mainReq}(${section})`
    }
    return `${mainReq}${section}`
  }

  // Nested sub-requirement (no options)
  if (!option && section && item) {
    if (is2026Format) {
      return `${mainReq}(${section})(${item})`
    }
    // Pre-2026: bracket notation for some badges, concatenated for others
    // Check if item is numeric (uses bracket) or letter (concatenated)
    if (/^\d+$/.test(item)) {
      return `${mainReq}${section}[${item}]`
    }
    return `${mainReq}${section}${item}`
  }

  // With options - this is where it gets badge-specific
  if (option) {
    // 2026 format uses "Option A", "Option B" etc
    if (is2026Format) {
      const optLetter = optionLetter || 'A'
      if (section && item) {
        return `${mainReq} Option ${optLetter} (${section})(${item})`
      }
      if (section) {
        return `${mainReq} Option ${optLetter} (${section})`
      }
      return `${mainReq} Option ${optLetter}`
    }

    // Pre-2026 formats vary by badge
    // Multisport: 4a1 Triathlon Option
    // Archery: 5a Opt B
    // Skating: 2a[1] Ice

    // Check if it's a named option (Triathlon, Ice, Alpine, etc)
    const namedOptions = ['Triathlon', 'Duathlon', 'Aquathlon', 'Aquabike', 'Ice', 'Inline', 'Alpine', 'Snowboard', 'Nordic', 'Snow']
    const isNamedOption = namedOptions.some(n => option.includes(n))

    if (isNamedOption) {
      // Multisport style: 4a1 Triathlon Option
      if (section && item) {
        return `${mainReq}${section}${item} ${option} Option`
      }
      // Skating style: 2a[1] Ice
      if (section) {
        return `${mainReq}${section} ${option}`
      }
    }

    // Opt A/B style (Archery, Shotgun)
    if (optionLetter && section) {
      if (item) {
        return `${mainReq}${section}[${item}]${optionLetter && item ? '' : ''} Opt ${optionLetter}`
      }
      return `${mainReq}${section} Opt ${optionLetter}`
    }

    // Fallback: concatenate what we have
    if (section && item) {
      return `${mainReq}${section}${item} ${option}`
    }
    if (section) {
      return `${mainReq}${section} ${option}`
    }
  }

  // Fallback: just return main requirement
  return mainReq
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

function isDuplicate(progress: ScrapeProgress, badgeName: string, versionLabel: string): boolean {
  return progress.badges.some(b => b.badgeName === badgeName && b.versionLabel === versionLabel)
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

// ============================================
// Popup Handling
// ============================================

async function dismissSessionPopup(page: Page): Promise<boolean> {
  // Look for session timeout modal - clicking "No" keeps session alive
  // Also handle other common modal dismiss buttons
  const dismissSelectors = [
    // Session timeout specific - "No" to stay logged in
    '.ant-modal-confirm-btns button:has-text("No")',
    '.ant-modal button:has-text("No")',
    'button:has-text("No")',
    // Other common dismiss options
    'button:has-text("Stay logged in")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    'button:has-text("Extend")',
    '.ant-modal-confirm-btns button.ant-btn-primary',
    '.ant-modal-close',
    '[class*="modal"] button[class*="primary"]',
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
      // Ignore errors, try next selector
    }
  }
  return false
}

async function dismissToasts(page: Page): Promise<void> {
  // Dismiss any visible toast notifications that might block clicks
  try {
    await page.evaluate(() => {
      // Remove toast containers entirely
      document.querySelectorAll('[class*="toastify"], [class*="Toast__toast"]').forEach(el => {
        (el as HTMLElement).style.display = 'none'
      })
    })
  } catch {
    // Ignore errors
  }
}

async function clearOverlays(page: Page): Promise<void> {
  // Dismiss popups and toasts before clicking
  await dismissSessionPopup(page)
  await dismissToasts(page)
  await page.waitForTimeout(100)
}

function setupPopupHandler(page: Page): void {
  // Periodically check for and dismiss popups
  setInterval(async () => {
    try {
      await dismissSessionPopup(page)
    } catch {
      // Ignore errors in background handler
    }
  }, 2000)
}

// ============================================
// Extraction Logic
// ============================================

async function extractRequirements(page: Page, versionYear: number, badgeName: string): Promise<ScrapedRequirement[]> {
  // Extract requirements with enhanced data: visual depth, checkbox detection, links.
  // This captures everything needed to merge with CSV data later.

  const rawRequirements = await page.evaluate(`
    (function() {
      var requirements = [];
      var panels = document.querySelectorAll('.ant-collapse-item');
      var OPTION_LETTERS = 'ABCDEFGH';

      // Helper to calculate visual depth from DOM structure
      function getVisualDepth(element) {
        var depth = 0;
        var current = element.parentElement;
        while (current) {
          // Count nested collapse content and requirement containers
          if (current.matches && (
            current.matches('[class*="ant-collapse-content"]') ||
            current.matches('[class*="requirementItemContainer"]') ||
            current.matches('[class*="NestedRequirement"]')
          )) {
            depth++;
          }
          current = current.parentElement;
        }
        return Math.min(depth, 4); // Cap at 4 levels
      }

      // Helper to detect checkbox
      function hasCheckbox(element) {
        return !!(
          element.querySelector('input[type="checkbox"]') ||
          element.querySelector('[class*="ant-checkbox"]') ||
          element.querySelector('[class*="Checkbox"]') ||
          element.querySelector('[class*="checkmark"]')
        );
      }

      // Helper to extract links
      function extractLinks(element) {
        var links = [];
        var anchors = element.querySelectorAll('a[href]');
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i];
          var href = a.getAttribute('href') || '';
          var text = a.textContent?.trim() || '';
          // Skip empty or javascript links
          if (!href || href.startsWith('javascript:') || href === '#') continue;
          // Get surrounding context (parent text minus link text)
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

        // Get main requirement number (the circled number like "1", "2", etc.)
        var circleLabel = panel.querySelector('[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]');
        var mainReqNum = circleLabel ? circleLabel.textContent.trim() : '';

        // Get main requirement description and content element
        var firstContent = panel.querySelector('[class*="requirementContent"]');
        var parentDescription = firstContent ? firstContent.textContent.trim() : '';

        if (!mainReqNum) continue;

        // Get raw HTML for main requirement header
        var headerElement = panel.querySelector('[class*="ant-collapse-header"]');
        var mainRawHtml = headerElement ? headerElement.innerHTML.substring(0, 1000) : '';

        // Extract links from main requirement
        var mainLinks = firstContent ? extractLinks(firstContent) : [];

        // Check for checkbox on main requirement
        var mainHasCheckbox = hasCheckbox(panel);

        // Add the main requirement
        requirements.push({
          displayLabel: mainReqNum,
          description: parentDescription.substring(0, 500),
          parentNumber: null,
          depth: 0,
          visualDepth: 0,
          isHeader: !mainHasCheckbox, // Main numbers without checkboxes are headers
          hasCheckbox: mainHasCheckbox,
          links: mainLinks,
          rawHtml: mainRawHtml,
          position: { mainReq: mainReqNum }
        });

        // Context tracking for hierarchy position
        var currentOption = null;
        var currentOptionLetter = null;
        var currentSection = null;
        var optionIndex = 0;
        var inOptionBlock = false;

        var items = panel.querySelectorAll('[class*="requirementItemContainer"]');

        for (var i = 0; i < items.length; i++) {
          var item = items[i];

          // Get visual depth from DOM
          var visualDepth = getVisualDepth(item);

          // Get the displayed requirement number/label
          var itemNumber = item.querySelector('[class*="itemListNumber"]');
          var displayedLabel = itemNumber ? itemNumber.textContent.trim() : '';

          // Get the requirement description and content element
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

          // Extract links from this item
          var itemLinks = contentDiv ? extractLinks(contentDiv) : [];

          // Check for checkbox
          var itemHasCheckbox = hasCheckbox(item);

          // Get raw HTML for debugging complex cases
          var itemRawHtml = item.innerHTML ? item.innerHTML.substring(0, 1000) : '';

          // Detect option headers (no label, description contains option name)
          var isOptionHeader = !displayedLabel && (
            /Option\\s*[A-H]?\\s*[-—:]/.test(description) ||
            /(Triathlon|Duathlon|Aquathlon|Aquabike)\\s*(Option)?/i.test(description) ||
            /^Option\\s+[A-H]/i.test(description) ||
            /(Ice|Inline)\\s+(Skating)?/i.test(description) ||
            /(Alpine|Snowboard|Nordic|Cross-Country)/i.test(description)
          );

          if (isOptionHeader) {
            // Extract option name from description
            var namedOptMatch = description.match(/(Triathlon|Duathlon|Aquathlon|Aquabike|Ice|Inline|Alpine|Snowboard|Nordic|Cross-Country)/i);
            if (namedOptMatch) {
              currentOption = namedOptMatch[1];
              currentOptionLetter = OPTION_LETTERS[optionIndex];
            } else {
              var letterMatch = description.match(/Option\\s+([A-H])/i);
              if (letterMatch) {
                currentOptionLetter = letterMatch[1].toUpperCase();
                currentOption = 'Option ' + currentOptionLetter;
              } else {
                currentOptionLetter = OPTION_LETTERS[optionIndex];
                currentOption = 'Option ' + currentOptionLetter;
              }
            }
            optionIndex++;
            currentSection = null;
            inOptionBlock = true;

            requirements.push({
              displayLabel: '',
              description: description.substring(0, 500),
              parentNumber: mainReqNum,
              depth: 1,
              visualDepth: visualDepth,
              isHeader: true,
              hasCheckbox: itemHasCheckbox,
              links: itemLinks,
              rawHtml: itemRawHtml,
              position: {
                mainReq: mainReqNum,
                option: currentOption,
                optionLetter: currentOptionLetter
              }
            });
            continue;
          }

          // Items without checkboxes are headers (section labels, option names, etc.)
          // The merge script will use CSV to make final determination
          var isNoCheckboxHeader = !itemHasCheckbox;

          // Skip if truly empty
          if (!displayedLabel && !description) continue;

          // Parse the displayed label
          var labelContent = displayedLabel.replace(/[()\\[\\]]/g, '').trim();
          var letterMatch = displayedLabel.match(/^\\(?([a-z])\\)?$/i);
          var numberMatch = displayedLabel.match(/^\\(?([0-9]+)\\)?$/);

          // Detect section headers by content or lack of checkbox
          var isSectionHeader = /(Swimming|Biking|Running|Cycling)\\.?\\.?\\.?$/i.test(description) || isNoCheckboxHeader;

          // Calculate logical depth based on context
          var depth = 1;
          if (inOptionBlock) {
            depth = currentSection ? 3 : 2;
          }

          // Update section tracking
          if ((isSectionHeader || (!currentSection && inOptionBlock)) && displayedLabel) {
            if (letterMatch) {
              currentSection = letterMatch[1].toLowerCase();
            } else if (numberMatch) {
              currentSection = numberMatch[1];
            }
            if (isSectionHeader) {
              depth = inOptionBlock ? 2 : 1;
            }
          }

          // Build the position object
          var position = { mainReq: mainReqNum };

          if (currentOption) {
            position.option = currentOption;
            position.optionLetter = currentOptionLetter;
          }

          if (isSectionHeader && displayedLabel) {
            position.section = labelContent.toLowerCase();
          } else if (currentSection && inOptionBlock) {
            position.section = currentSection;
            position.item = labelContent.toLowerCase();
          } else if (!inOptionBlock && displayedLabel) {
            if (letterMatch) {
              position.section = letterMatch[1].toLowerCase();
            } else if (numberMatch) {
              position.section = numberMatch[1];
            } else {
              var complexMatch = labelContent.match(/^([0-9]*)([a-z]?)([0-9]*)$/i);
              if (complexMatch) {
                if (complexMatch[2]) position.section = complexMatch[2].toLowerCase();
                if (complexMatch[3]) position.item = complexMatch[3];
              } else {
                position.section = labelContent;
              }
            }
          }

          requirements.push({
            displayLabel: displayedLabel,
            description: description.substring(0, 500),
            parentNumber: mainReqNum,
            depth: depth,
            visualDepth: visualDepth,
            isHeader: isSectionHeader || isNoCheckboxHeader,
            hasCheckbox: itemHasCheckbox,
            links: itemLinks,
            rawHtml: itemRawHtml,
            position: position
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
    position: HierarchyPosition
  }>

  // Process and classify links, then construct canonical IDs
  return rawRequirements.map(req => ({
    id: constructScoutbookId(req.position, versionYear, badgeName),
    displayLabel: req.displayLabel,
    description: req.description,
    parentNumber: req.parentNumber,
    depth: req.depth,
    visualDepth: req.visualDepth,
    isHeader: req.isHeader,
    hasCheckbox: req.hasCheckbox,
    links: req.links.map(link => ({
      ...link,
      type: classifyLinkType(link.url, link.text)
    })),
    rawHtml: req.rawHtml,
    position: req.position
  }))
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
  // Click the version dropdown to open it
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) {
    console.log('  No version selector found')
    return []
  }

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  // Get all options from the dropdown
  const versions = await page.evaluate(() => {
    const options: string[] = []
    // Ant Design dropdown options appear in a portal
    document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option').forEach(opt => {
      const text = opt.textContent?.trim()
      if (text && !options.includes(text)) {
        options.push(text)
      }
    })
    return options
  })

  // Close dropdown by clicking elsewhere or pressing Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  return versions
}

async function selectVersion(page: Page, versionLabel: string): Promise<boolean> {
  // Click the version dropdown to open it
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) return false

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  // Find and click the option with matching text
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
    // Wait for content to update
    await page.waitForTimeout(800)
  } else {
    // Close dropdown
    await page.keyboard.press('Escape')
  }

  return clicked
}

// ============================================
// Main Scraping Logic
// ============================================

async function scrapeBadge(page: Page, progress: ScrapeProgress, outputPath: string): Promise<void> {
  const badgeName = await getBadgeName(page)
  const badgeSlug = slugify(badgeName)

  console.log(`\n  Badge: ${badgeName}`)
  progress.currentBadge = badgeName

  // Clear any overlays before interacting
  await clearOverlays(page)

  // Get available versions
  const versions = await getAvailableVersions(page)
  console.log(`  Versions available: ${versions.length > 0 ? versions.join(', ') : 'default only'}`)

  // If no version dropdown, just scrape current
  if (versions.length === 0) {
    const currentVersion = await getCurrentVersion(page) || 'Current'

    // Check for duplicate
    if (isDuplicate(progress, badgeName, currentVersion)) {
      console.log(`    ${currentVersion}: SKIPPED (duplicate)`)
      return
    }

    const versionYear = extractYearFromVersion(currentVersion)
    let requirements = await extractRequirements(page, versionYear, badgeName)

    // Retry once if 0 requirements found
    if (requirements.length === 0) {
      console.log(`    ${currentVersion}: 0 requirements, retrying...`)
      await page.waitForTimeout(1000)
      await clearOverlays(page)
      requirements = await extractRequirements(page, versionYear, badgeName)
    }

    const totalLinks = requirements.reduce((sum, r) => sum + r.links.length, 0)
    const totalCheckboxes = requirements.filter(r => r.hasCheckbox).length
    const maxDepth = Math.max(0, ...requirements.map(r => r.visualDepth))

    progress.badges.push({
      badgeName,
      badgeSlug,
      versionYear: extractYearFromVersion(currentVersion),
      versionLabel: currentVersion,
      requirements,
      scrapedAt: new Date().toISOString(),
      totalLinks,
      totalCheckboxes,
      maxDepth
    })

    console.log(`    ${currentVersion}: ${requirements.length} requirements, ${totalLinks} links, depth=${maxDepth}`)
    return
  }

  // Scrape ALL available versions
  console.log(`  Scraping ${versions.length} version(s)...`)

  for (let i = 0; i < versions.length; i++) {
    const versionLabel = versions[i]

    // Check for duplicate before scraping
    if (isDuplicate(progress, badgeName, versionLabel)) {
      console.log(`    ${versionLabel}: SKIPPED (duplicate)`)
      continue
    }

    // Clear overlays before selecting version
    await clearOverlays(page)

    // Select this version
    const selected = await selectVersion(page, versionLabel)
    if (!selected) {
      console.log(`    Failed to select version: ${versionLabel}`)
      continue
    }

    // Wait for content to load
    await page.waitForTimeout(500)

    // Extract requirements
    const versionYear = extractYearFromVersion(versionLabel)
    let requirements = await extractRequirements(page, versionYear, badgeName)

    // Retry once if 0 requirements found
    if (requirements.length === 0) {
      console.log(`    ${versionLabel}: 0 requirements, retrying...`)
      await page.waitForTimeout(1000)
      await clearOverlays(page)
      requirements = await extractRequirements(page, versionYear, badgeName)
    }

    const totalLinks = requirements.reduce((sum, r) => sum + r.links.length, 0)
    const totalCheckboxes = requirements.filter(r => r.hasCheckbox).length
    const maxDepth = Math.max(0, ...requirements.map(r => r.visualDepth))

    progress.badges.push({
      badgeName,
      badgeSlug,
      versionYear,
      versionLabel,
      requirements,
      scrapedAt: new Date().toISOString(),
      totalLinks,
      totalCheckboxes,
      maxDepth
    })

    console.log(`    ${versionLabel}: ${requirements.length} requirements, ${totalLinks} links, depth=${maxDepth}${requirements.length === 0 ? ' (FAILED)' : ''}`)
  }
}

async function scrapeAllBadges(page: Page, outputPath: string): Promise<ScrapeProgress> {
  const progress: ScrapeProgress = {
    totalBadges: 0,
    completedBadges: 0,
    currentBadge: null,
    badges: [],
    errors: [],
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString()
  }

  // Get all badge cards/links from the merit badge list
  // Note: Use AdvancementCardItem (not AdvancementCard) to match actual badge cards
  const badgeElements = await page.$$('[class*="MeritBadgeCard"], [class*="AdvancementCardItem"], .ant-card')

  // Filter to actual badge cards (they should have badge names)
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

  // Debug: Check if specific badges are in the list
  const debugBadges = ['Art', 'Safety', 'Sports']
  debugBadges.forEach(name => {
    const found = badgeNames.includes(name)
    console.log(`  Debug: "${name}" in badgeNames: ${found}`)
  })

  if (badgeNames.length === 0) {
    // Try alternative: look for any clickable badge links
    const links = await page.$$('a[href*="meritBadges/"]')
    console.log(`Found ${links.length} badge links as alternative`)

    for (let i = 0; i < links.length; i++) {
      try {
        // Clear overlays before proceeding
        await clearOverlays(page)

        // Re-query links each time since page changes
        const currentLinks = await page.$$('a[href*="meritBadges/"]')
        if (i >= currentLinks.length) break

        // Get the badge URL to navigate back
        const href = await currentLinks[i].getAttribute('href')
        if (!href) continue

        // Click to open badge (force to bypass any overlays)
        await currentLinks[i].click({ force: true })
        await page.waitForSelector('[class*="VersionSelector"], [class*="AdvRequirements"]', { timeout: 20000 })
        await page.waitForTimeout(500)

        // Scrape this badge
        await scrapeBadge(page, progress, outputPath)
        progress.completedBadges++

        // Save progress every 5 badges
        if (progress.completedBadges % 5 === 0) {
          saveProgress(progress, outputPath)
          console.log(`\n  Progress saved: ${progress.completedBadges} badges complete`)
        }

        // Go back to list
        await page.goBack()
        await page.waitForTimeout(500)

      } catch (err) {
        const errorMsg = `Error on badge ${i}: ${err instanceof Error ? err.message : String(err)}`
        console.error(`  ${errorMsg}`)
        progress.errors.push(errorMsg)

        // Try to recover by going back
        try {
          await page.goBack()
          await page.waitForTimeout(500)
        } catch {
          // Ignore recovery errors
        }
      }
    }
  } else {
    // Click each badge by name
    for (let i = 0; i < badgeNames.length; i++) {
      const badgeName = badgeNames[i]

      try {
        // Clear overlays before proceeding
        await clearOverlays(page)

        // Find the badge card by exact name match
        // Use :text-is() for exact matching to avoid "Art" matching "Graphic Arts"
        const nameEl = await page.$(`[class*="AdvancementCardItem__name"]:text-is("${badgeName}")`)
        if (!nameEl) {
          console.log(`  Could not find card for: "${badgeName}"`)
          continue
        }

        // Click the parent card container
        const card = await nameEl.evaluateHandle(el => el.closest('[class*="AdvancementCardItem"]'))
        if (!card) {
          console.log(`  Could not find parent card for: "${badgeName}"`)
          continue
        }

        await (card as any).click({ force: true })
        await page.waitForSelector('[class*="VersionSelector"], [class*="AdvRequirements"]', { timeout: 20000 })
        await page.waitForTimeout(500)

        // Scrape this badge
        await scrapeBadge(page, progress, outputPath)
        progress.completedBadges++

        // Save progress every 5 badges
        if (progress.completedBadges % 5 === 0) {
          saveProgress(progress, outputPath)
          console.log(`\n  Progress saved: ${progress.completedBadges} badges complete`)
        }

        // Go back to list
        await page.goBack()
        await page.waitForTimeout(500)

      } catch (err) {
        const errorMsg = `Error on ${badgeName}: ${err instanceof Error ? err.message : String(err)}`
        console.error(`  ${errorMsg}`)
        progress.errors.push(errorMsg)

        // Try to recover
        try {
          await page.goBack()
          await page.waitForTimeout(500)
        } catch {
          // Ignore recovery errors
        }
      }
    }
  }

  // Final save
  saveProgress(progress, outputPath)

  return progress
}

// ============================================
// Main
// ============================================

async function main() {
  const outputPath = 'data/merit-badge-requirements-scraped.json'

  console.log('='.repeat(60))
  console.log('Scoutbook Merit Badge Requirements Scraper')
  console.log('='.repeat(60))
  console.log('')
  console.log('This script will scrape all merit badge requirements')
  console.log('with ALL available versions for each badge.')
  console.log('')
  console.log(`Output will be saved to: ${outputPath}`)
  console.log('')

  // Ensure data directory exists
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

  // Set up automatic popup dismissal
  setupPopupHandler(page)

  // Navigate to Scoutbook
  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  console.log('')
  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook')
  console.log('2. Navigate to the full Merit Badges list')
  console.log('   (Or any scout\'s Merit Badges page)')
  console.log('')
  console.log('The page should show a list/grid of all merit badges.')
  console.log('')

  await waitForKeypress('Press Enter when you\'re on the Merit Badges list page...\n')

  const currentUrl = page.url()
  console.log(`\nStarting scrape from: ${currentUrl}`)

  try {
    const progress = await scrapeAllBadges(page, outputPath)

    console.log('')
    console.log('='.repeat(60))
    console.log('SCRAPING COMPLETE')
    console.log('='.repeat(60))
    console.log(`Total badges scraped: ${progress.completedBadges}`)
    console.log(`Total versions captured: ${progress.badges.length}`)
    console.log(`Errors: ${progress.errors.length}`)
    console.log(`Output saved to: ${outputPath}`)

    if (progress.errors.length > 0) {
      console.log('')
      console.log('Errors encountered:')
      progress.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`))
      if (progress.errors.length > 10) {
        console.log(`  ... and ${progress.errors.length - 10} more`)
      }
    }

  } catch (err) {
    console.error('Fatal error during scraping:', err)
  }

  console.log('')
  await waitForKeypress('Press Enter to close the browser...\n')

  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
