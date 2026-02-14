#!/usr/bin/env npx tsx
/**
 * Test Scraper on a Single Badge
 *
 * Tests the improved extraction logic on a specific badge without
 * doing a full scrape. Validates constructed IDs against canonical CSV data.
 *
 * Usage:
 *   npx tsx scripts/test-scraper-single-badge.ts
 *
 * Then navigate to a badge (e.g., Multisport, Archery) and press Enter.
 */

import { chromium, Page } from 'playwright'
import * as readline from 'readline'
import * as fs from 'fs'

// ============================================
// Types
// ============================================

interface HierarchyPosition {
  mainReq: string
  option?: string
  optionLetter?: string
  section?: string
  item?: string
}

interface ScrapedRequirement {
  id: string
  displayLabel: string
  description: string
  parentNumber: string | null
  depth: number
  isHeader?: boolean
  position?: HierarchyPosition
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

// ============================================
// ID Construction (same as main scraper)
// ============================================

function constructScoutbookId(
  position: HierarchyPosition,
  versionYear: number,
  badgeName: string
): string {
  const { mainReq, option, optionLetter, section, item } = position
  const is2026Format = versionYear >= 2026

  // Main requirement only
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
    if (/^\d+$/.test(item)) {
      return `${mainReq}${section}[${item}]`
    }
    return `${mainReq}${section}${item}`
  }

  // With options
  if (option) {
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

    // Pre-2026 named options
    const namedOptions = ['Triathlon', 'Duathlon', 'Aquathlon', 'Aquabike', 'Ice', 'Inline', 'Alpine', 'Snowboard', 'Nordic', 'Snow']
    const isNamedOption = namedOptions.some(n => option.includes(n))

    if (isNamedOption) {
      if (section && item) {
        return `${mainReq}${section}${item} ${option} Option`
      }
      if (section) {
        return `${mainReq}${section} ${option}`
      }
    }

    // Opt A/B style
    if (optionLetter && section) {
      if (item) {
        return `${mainReq}${section}[${item}] Opt ${optionLetter}`
      }
      return `${mainReq}${section} Opt ${optionLetter}`
    }

    // Fallback
    if (section && item) {
      return `${mainReq}${section}${item} ${option}`
    }
    if (section) {
      return `${mainReq}${section} ${option}`
    }
  }

  return mainReq
}

// ============================================
// Extraction
// ============================================

async function extractRequirements(page: Page, versionYear: number, badgeName: string): Promise<ScrapedRequirement[]> {
  const rawRequirements = await page.evaluate(`
    (function() {
      var requirements = [];
      var panels = document.querySelectorAll('.ant-collapse-item');
      var OPTION_LETTERS = 'ABCDEFGH';

      for (var p = 0; p < panels.length; p++) {
        var panel = panels[p];

        var circleLabel = panel.querySelector('[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]');
        var mainReqNum = circleLabel ? circleLabel.textContent.trim() : '';

        var firstContent = panel.querySelector('[class*="requirementContent"]');
        var parentDescription = firstContent ? firstContent.textContent.trim() : '';

        if (!mainReqNum) continue;

        requirements.push({
          displayLabel: mainReqNum,
          description: parentDescription.substring(0, 500),
          parentNumber: null,
          depth: 0,
          isHeader: false,
          position: { mainReq: mainReqNum }
        });

        var currentOption = null;
        var currentOptionLetter = null;
        var currentSection = null;
        var optionIndex = 0;
        var inOptionBlock = false;

        var items = panel.querySelectorAll('[class*="requirementItemContainer"]');

        for (var i = 0; i < items.length; i++) {
          var item = items[i];

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

          if (description.includes('Select All') || description === parentDescription) {
            continue;
          }

          // Detect option headers
          var isOptionHeader = !displayedLabel && (
            /Option\\s*[A-H]?\\s*[-—:]/.test(description) ||
            /(Triathlon|Duathlon|Aquathlon|Aquabike)\\s*(Option)?/i.test(description) ||
            /^Option\\s+[A-H]/i.test(description) ||
            /(Ice|Inline)\\s+(Skating)?/i.test(description) ||
            /(Alpine|Snowboard|Nordic|Cross-Country)/i.test(description)
          );

          if (isOptionHeader) {
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
              isHeader: true,
              position: {
                mainReq: mainReqNum,
                option: currentOption,
                optionLetter: currentOptionLetter
              }
            });
            continue;
          }

          if (!displayedLabel) continue;

          var labelContent = displayedLabel.replace(/[()\\[\\]]/g, '').trim();
          var letterMatch = displayedLabel.match(/^\\(?([a-z])\\)?$/i);
          var numberMatch = displayedLabel.match(/^\\(?([0-9]+)\\)?$/);

          var isSectionHeader = /(Swimming|Biking|Running|Cycling)\\.?\\.?\\.?$/i.test(description);

          var depth = 1;
          if (inOptionBlock) {
            depth = currentSection ? 3 : 2;
          }

          if (isSectionHeader || (!currentSection && inOptionBlock)) {
            if (letterMatch) {
              currentSection = letterMatch[1].toLowerCase();
            } else if (numberMatch) {
              currentSection = numberMatch[1];
            }
            if (isSectionHeader) {
              depth = inOptionBlock ? 2 : 1;
            }
          }

          var position = { mainReq: mainReqNum };

          if (currentOption) {
            position.option = currentOption;
            position.optionLetter = currentOptionLetter;
          }

          if (isSectionHeader) {
            position.section = labelContent.toLowerCase();
          } else if (currentSection && inOptionBlock) {
            position.section = currentSection;
            position.item = labelContent.toLowerCase();
          } else if (!inOptionBlock) {
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
            isHeader: isSectionHeader,
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
    isHeader: boolean
    position: HierarchyPosition
  }>

  return rawRequirements.map(req => ({
    id: constructScoutbookId(req.position, versionYear, badgeName),
    displayLabel: req.displayLabel,
    description: req.description,
    parentNumber: req.parentNumber,
    depth: req.depth,
    isHeader: req.isHeader,
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
      const selected = versionSelector.querySelector('.ant-select-selection-item, .ant-select-selection-selected-value')
      return selected?.textContent?.trim() || selected?.getAttribute('title') || 'Unknown'
    }
    return 'Unknown'
  })
}

function extractYearFromVersion(versionLabel: string): number {
  const match = versionLabel.match(/(\d{4})/)
  return match ? parseInt(match[1], 10) : new Date().getFullYear()
}

// ============================================
// Validation
// ============================================

function loadCanonicalIds(): Record<string, Record<string, string[]>> {
  const path = 'data/scoutbook-requirement-ids.json'
  if (fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, 'utf-8'))
  }
  return {}
}

function validateAgainstCanonical(
  badgeName: string,
  versionYear: number,
  constructedIds: string[],
  canonicalData: Record<string, Record<string, string[]>>
): { matched: string[], missing: string[], extra: string[] } {
  const canonical = canonicalData[badgeName]?.[String(versionYear)] || []
  const canonicalSet = new Set(canonical)
  const constructedSet = new Set(constructedIds)

  const matched = constructedIds.filter(id => canonicalSet.has(id))
  const extra = constructedIds.filter(id => !canonicalSet.has(id))
  const missing = canonical.filter(id => !constructedSet.has(id))

  return { matched, missing, extra }
}

// ============================================
// Main Test
// ============================================

async function testBadge(page: Page, canonicalData: Record<string, Record<string, string[]>>): Promise<void> {
  const badgeName = await getBadgeName(page)
  const versionLabel = await getCurrentVersion(page)
  const versionYear = extractYearFromVersion(versionLabel)

  const requirements = await extractRequirements(page, versionYear, badgeName)

  console.log(`\n${'='.repeat(70)}`)
  console.log(`Badge: ${badgeName}`)
  console.log(`Version: ${versionLabel} (Year: ${versionYear})`)
  console.log(`Total items: ${requirements.length}`)
  console.log(`${'='.repeat(70)}\n`)

  // Display requirements with constructed IDs
  for (const req of requirements) {
    const indent = '  '.repeat(req.depth)
    const pos = req.position

    if (req.isHeader && !req.displayLabel) {
      // Option header
      console.log(`${indent}=== ${req.description.substring(0, 50)} ===`)
      console.log(`${indent}    (option: ${pos?.option}, letter: ${pos?.optionLetter})`)
    } else {
      console.log(`${indent}[${req.displayLabel || '?'}] ID: "${req.id}"`)
      console.log(`${indent}     "${req.description.substring(0, 40)}..."`)
      if (pos?.option || pos?.section) {
        console.log(`${indent}     pos: opt=${pos?.option || '-'}, sec=${pos?.section || '-'}, item=${pos?.item || '-'}`)
      }
    }
  }

  // Extract constructed IDs (excluding headers and main reqs)
  const constructedIds = requirements
    .filter(r => r.id && !r.isHeader && r.parentNumber)
    .map(r => r.id)

  // Validate against canonical data
  console.log(`\n${'='.repeat(70)}`)
  console.log('VALIDATION AGAINST CANONICAL CSV DATA')
  console.log(`${'='.repeat(70)}`)

  const { matched, missing, extra } = validateAgainstCanonical(
    badgeName,
    versionYear,
    constructedIds,
    canonicalData
  )

  const canonicalCount = canonicalData[badgeName]?.[String(versionYear)]?.length || 0

  if (canonicalCount === 0) {
    console.log(`\n⚠️  No canonical data found for ${badgeName} ${versionYear}`)
    console.log(`   Constructed ${constructedIds.length} IDs (cannot validate)`)
  } else {
    console.log(`\nCanonical IDs in CSV: ${canonicalCount}`)
    console.log(`Constructed IDs: ${constructedIds.length}`)
    console.log(`Matched: ${matched.length}`)
    console.log(`Missing from scrape: ${missing.length}`)
    console.log(`Extra (not in CSV): ${extra.length}`)

    if (matched.length === canonicalCount && extra.length === 0) {
      console.log(`\n✅ PERFECT MATCH! All IDs validated.`)
    } else {
      if (missing.length > 0) {
        console.log(`\n❌ Missing IDs (in CSV but not scraped):`)
        missing.slice(0, 10).forEach(id => console.log(`   - ${id}`))
        if (missing.length > 10) console.log(`   ... and ${missing.length - 10} more`)
      }
      if (extra.length > 0) {
        console.log(`\n⚠️  Extra IDs (scraped but not in CSV):`)
        extra.slice(0, 10).forEach(id => console.log(`   + ${id}`))
        if (extra.length > 10) console.log(`   ... and ${extra.length - 10} more`)
      }
    }
  }

  // Check for duplicates
  const idCounts = new Map<string, number>()
  constructedIds.forEach(id => idCounts.set(id, (idCounts.get(id) || 0) + 1))
  const duplicates = [...idCounts.entries()].filter(([_, count]) => count > 1)

  if (duplicates.length > 0) {
    console.log(`\n⚠️  DUPLICATE IDs detected:`)
    duplicates.forEach(([id, count]) => console.log(`   ${id}: ${count} times`))
  } else {
    console.log(`\n✅ No duplicate IDs`)
  }
}

async function main() {
  console.log('Test Scraper on Single Badge')
  console.log('='.repeat(60))
  console.log('')

  // Load canonical data for validation
  const canonicalData = loadCanonicalIds()
  const badgeCount = Object.keys(canonicalData).length
  console.log(`Loaded canonical data for ${badgeCount} badges`)
  console.log('')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  })

  const page = await context.newPage()

  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  console.log('Browser launched!')
  console.log('')
  console.log('Please:')
  console.log('1. Log in to Scoutbook')
  console.log('2. Navigate to a badge (e.g., Multisport or Archery)')
  console.log('3. Select the version you want to test')
  console.log('4. Make sure requirements are visible')
  console.log('')

  let continueTest = true
  while (continueTest) {
    await waitForKeypress('Press Enter when ready to test...\n')
    await testBadge(page, canonicalData)

    const answer = await waitForKeypress('\nTest another badge/version? (y/n) ')
    continueTest = answer.toLowerCase() === 'y'

    if (continueTest) {
      console.log('\nNavigate to the next badge or switch version...')
    }
  }

  await waitForKeypress('\nPress Enter to close browser...\n')
  await browser.close()
}

main().catch(console.error)
