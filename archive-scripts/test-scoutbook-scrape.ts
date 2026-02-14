/**
 * Test script for scraping Scoutbook merit badge requirements
 *
 * Usage:
 *   npx tsx scripts/test-scoutbook-scrape.ts
 *
 * This script will:
 * 1. Launch a browser (NOT headless - so you can log in)
 * 2. Wait for you to navigate to a merit badge requirements page
 * 3. Extract the requirements and version info
 * 4. Output what it found for validation
 *
 * Press Ctrl+C to stop the script.
 */

import { chromium, Page } from 'playwright'
import * as fs from 'fs'
import * as readline from 'readline'

interface ExtractedRequirement {
  number: string
  description: string
  isCompleted: boolean
  completedDate: string | null
  parentNumber: string | null
  depth: number
}

interface ExtractedBadgeData {
  badgeName: string
  currentVersion: string | null
  availableVersions: string[]
  requirements: ExtractedRequirement[]
  pageUrl: string
  extractedAt: string
  rawHtml?: string
}

async function waitForKeypress(prompt: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

async function extractMeritBadgeData(page: Page): Promise<ExtractedBadgeData> {
  const url = page.url()

  // Extract data using page.evaluate to run in browser context
  const data = await page.evaluate(() => {
    const result: {
      badgeName: string | null
      currentVersion: string | null
      availableVersions: string[]
      requirements: Array<{
        number: string
        description: string
        isCompleted: boolean
        completedDate: string | null
        parentNumber: string | null
        depth: number
      }>
      debugInfo: {
        versionSelectorHtml: string | null
        requirementsContainerHtml: string | null
        pageTitle: string
        breadcrumb: string | null
        foundClasses: string[]
      }
    } = {
      badgeName: null,
      currentVersion: null,
      availableVersions: [],
      requirements: [],
      debugInfo: {
        versionSelectorHtml: null,
        requirementsContainerHtml: null,
        pageTitle: document.title,
        breadcrumb: null,
        foundClasses: []
      }
    }

    // Find badge name from Scoutbook-specific selectors
    // 1. Breadcrumb (most reliable)
    const breadcrumb = document.querySelector('[class*="Breadcrumbs__current"]')
    if (breadcrumb) {
      result.badgeName = breadcrumb.textContent?.trim() || null
      result.debugInfo.breadcrumb = breadcrumb.textContent?.trim() || null
    }

    // 2. Summary section fallback
    if (!result.badgeName) {
      const summaryName = document.querySelector('[class*="AdvSummary__advName"]')
      result.badgeName = summaryName?.textContent?.trim() || null
    }

    // Find version selector - Scoutbook uses VersionSelector component
    const versionSelector = document.querySelector('[class*="VersionSelector__versionSelect"]')
    if (versionSelector) {
      result.debugInfo.versionSelectorHtml = versionSelector.outerHTML.substring(0, 500)

      // Get selected value
      const selectedValue = versionSelector.querySelector('.ant-select-selection-selected-value')
      if (selectedValue) {
        const versionText = selectedValue.getAttribute('title') || selectedValue.textContent
        result.currentVersion = versionText?.trim() || null
      }
    }

    // Find all elements with "Requirement" in class name for debugging
    document.querySelectorAll('[class*="Requirement"], [class*="requirement"]').forEach(el => {
      const classes = el.className
      if (typeof classes === 'string' && !result.debugInfo.foundClasses.includes(classes.split(' ')[0])) {
        result.debugInfo.foundClasses.push(classes.split(' ')[0].substring(0, 50))
      }
    })

    // Look for the requirements list/table container
    // Scoutbook likely uses a custom component - let's find it
    const possibleContainers = [
      '[class*="RequirementsList"]',
      '[class*="RequirementsTable"]',
      '[class*="AdvRequirements"]',
      '[class*="requirements"]',
      '.ant-collapse',  // Ant Design collapse/accordion
      '.ant-list',
    ]

    let reqContainer: Element | null = null
    for (const selector of possibleContainers) {
      reqContainer = document.querySelector(selector)
      if (reqContainer) {
        result.debugInfo.requirementsContainerHtml = `Found: ${selector} - ` + reqContainer.outerHTML.substring(0, 1000)
        break
      }
    }

    // Try to find requirement rows
    // Look for elements that have requirement numbers (1, 1a, 2, etc.)
    const allText = document.body.innerText
    const reqMatches = allText.match(/^(\d+[a-z]?)\.\s+[A-Z]/gm)
    if (reqMatches) {
      result.debugInfo.foundClasses.push(`Found ${reqMatches.length} req-like patterns in text`)
    }

    // Scoutbook uses Ant Collapse panels with custom requirement structure
    // Main requirements are in collapse headers with CircleLabel
    // Sub-requirements are in requirementItemContainer divs
    //
    // For Option A/B badges (like Cycling req 6), we need to track context:
    // - "6A" = Option A header
    // - "6A(a)" = sub-requirement (a) under Option A
    // - "6A(a)(1)" = detail (1) under 6A(a)

    document.querySelectorAll('.ant-collapse-item').forEach((panel) => {
      // Get main requirement number from CircleLabel
      const circleLabel = panel.querySelector('[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]')
      const mainReqNum = circleLabel?.textContent?.trim() || ''

      // Get status from the header
      const statusLabel = panel.querySelector('[class*="StatusLabel-styles__statusLabel"]')
      const statusText = statusLabel?.textContent?.trim() || ''
      const mainIsCompleted = statusText.includes('APPROVED') || statusText.includes('COMPLETED') || statusText.includes('AWARDED')

      // Get the first requirement content (the parent "Do the following:" type)
      const firstContent = panel.querySelector('[class*="requirementContent"]')
      const parentDescription = firstContent?.textContent?.trim() || ''

      if (mainReqNum) {
        // Add main requirement
        result.requirements.push({
          number: mainReqNum,
          description: parentDescription.substring(0, 300),
          isCompleted: mainIsCompleted,
          completedDate: null,
          parentNumber: null,
          depth: 0
        })

        // Context tracking for Option A/B structure
        let currentOption: string | null = null  // "A" or "B"
        let currentSubReq: string | null = null  // "(a)", "(b)", etc.
        let lastParentNumber = mainReqNum

        // Find all sub-requirements within this panel
        panel.querySelectorAll('[class*="requirementItemContainer"]').forEach((item) => {
          // Get sub-requirement letter/number from the item
          const itemNumber = item.querySelector('[class*="itemListNumber"]')
          const rawSubReqLabel = itemNumber?.textContent?.trim() || '' // e.g., "(a)", "(b)", "(1)", "(2)"

          // Get description
          const contentDiv = item.querySelector('[class*="requirementContent"]')
          let description = ''
          contentDiv?.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE || (node as Element).tagName === 'DIV') {
              description += (node.textContent || '') + ' '
            }
          })
          description = description.trim()

          // Skip if this is the parent "Do the following:" or "Select All" type
          if (!rawSubReqLabel || description.includes('Select All') || description === parentDescription) {
            return
          }

          // Check completion status
          const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null
          const isChecked = checkbox?.checked || false

          // Look for completion date
          const dateMatch = item.textContent?.match(/\d{1,2}\/\d{1,2}\/\d{4}/)

          // Detect Option A/B headers
          const isOptionA = description.includes('Option A') || description.match(/^Option A[—\-\s]/i)
          const isOptionB = description.includes('Option B') || description.match(/^Option B[—\-\s]/i)

          if (isOptionA || isOptionB) {
            // This is an Option header (e.g., "Option A—Road Biking")
            currentOption = isOptionA ? 'A' : 'B'
            currentSubReq = null // Reset sub-requirement context

            const fullNumber = mainReqNum + currentOption // e.g., "6A"
            lastParentNumber = fullNumber

            result.requirements.push({
              number: fullNumber,
              description: description.substring(0, 300),
              isCompleted: isChecked,
              completedDate: dateMatch?.[0] || null,
              parentNumber: mainReqNum,
              depth: 1
            })
            return
          }

          // Determine if this is a letter sub-req (a, b, c) or a number detail (1, 2, 3)
          const letterMatch = rawSubReqLabel.match(/^\(([a-z])\)$/i)
          const numberMatch = rawSubReqLabel.match(/^\((\d+)\)$/)

          let fullNumber: string
          let parentNum: string
          let depth: number

          if (letterMatch) {
            // This is a letter sub-requirement like (a), (b), (c)
            const letter = letterMatch[1].toLowerCase()
            currentSubReq = letter

            if (currentOption) {
              // Under an Option: "6" + "A" + "(a)" = "6A(a)"
              fullNumber = mainReqNum + currentOption + '(' + letter + ')'
              parentNum = mainReqNum + currentOption
              depth = 2
            } else {
              // No option context: "1" + "a" = "1a" (simple sub-requirement)
              fullNumber = mainReqNum + letter
              parentNum = mainReqNum
              depth = 1
            }
            lastParentNumber = fullNumber

          } else if (numberMatch) {
            // This is a number detail like (1), (2), (3)
            const num = numberMatch[1]

            if (currentOption && currentSubReq) {
              // Under Option + sub-req: "6A(a)" + "(1)" = "6A(a)(1)"
              fullNumber = mainReqNum + currentOption + '(' + currentSubReq + ')(' + num + ')'
              parentNum = mainReqNum + currentOption + '(' + currentSubReq + ')'
              depth = 3
            } else if (currentOption) {
              // Under Option only: "6A" + "(1)" = "6A(1)"
              fullNumber = mainReqNum + currentOption + '(' + num + ')'
              parentNum = mainReqNum + currentOption
              depth = 2
            } else {
              // No option context - might be simple numbered sub-req
              fullNumber = mainReqNum + '(' + num + ')'
              parentNum = mainReqNum
              depth = 1
            }

          } else {
            // Fallback: just append whatever we got
            const cleanLabel = rawSubReqLabel.replace(/[()]/g, '')
            fullNumber = mainReqNum + cleanLabel
            parentNum = lastParentNumber
            depth = 1
          }

          result.requirements.push({
            number: fullNumber,
            description: description.substring(0, 300),
            isCompleted: isChecked,
            completedDate: dateMatch?.[0] || null,
            parentNumber: parentNum,
            depth
          })
        })
      }
    })

    // Try table rows with requirement data
    if (result.requirements.length === 0) {
      document.querySelectorAll('tr, [class*="Row"], [class*="row"]').forEach(row => {
        const text = row.textContent?.trim() || ''
        // Look for rows that start with requirement numbers
        const match = text.match(/^(\d+[a-zA-Z]?(?:\([a-z]\))?(?:\(\d+\))?)[.\s]+(.{10,})/)
        if (match && match[2].length > 10) {
          const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null

          result.requirements.push({
            number: match[1],
            description: match[2].substring(0, 200),
            isCompleted: checkbox?.checked || false,
            completedDate: null,
            parentNumber: null,
            depth: 0
          })
        }
      })
    }

    // Last resort: parse visible text for requirement patterns
    if (result.requirements.length === 0) {
      // Get main content area
      const mainContent = document.querySelector('[class*="contentContainer"], [class*="ContentContainer"], main') as HTMLElement | null
      if (mainContent) {
        const text = mainContent.innerText
        // Split by lines and look for requirement patterns
        const lines = text.split('\n')
        let currentParent: string | null = null

        lines.forEach(line => {
          const trimmed = line.trim()
          // Match patterns like "1.", "1a.", "2.", "6A(a)(1)."
          const match = trimmed.match(/^(\d+[a-zA-Z]?(?:\([a-z]\))?(?:\(\d+\))?)[.\s]+(.+)/)
          if (match && match[2].length > 5) {
            const reqNum = match[1]
            const isSubReq = reqNum.match(/[a-z]|\(/i)

            result.requirements.push({
              number: reqNum,
              description: match[2].substring(0, 300),
              isCompleted: false,
              completedDate: null,
              parentNumber: isSubReq ? currentParent : null,
              depth: isSubReq ? 1 : 0
            })

            if (!isSubReq) {
              currentParent = reqNum
            }
          }
        })
      }
    }

    return result
  })

  // Get raw HTML for debugging - focus on requirements section
  const rawHtml = await page.evaluate(() => {
    // Try to find the requirements content specifically
    const selectors = [
      '[class*="contentContainer"]',
      '[class*="RequirementsList"]',
      '[class*="AdvRequirements"]',
      '.ant-collapse',
      'main'
    ]

    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el && el.innerHTML.length > 500) {
        return `[${selector}]\n` + el.innerHTML.substring(0, 15000)
      }
    }

    return document.body.innerHTML.substring(0, 15000)
  })

  return {
    badgeName: data.badgeName || 'Unknown',
    currentVersion: data.currentVersion,
    availableVersions: data.availableVersions,
    requirements: data.requirements,
    pageUrl: url,
    extractedAt: new Date().toISOString(),
    rawHtml,
    ...{ debugInfo: data.debugInfo } as any
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Scoutbook Merit Badge Scraper Test')
  console.log('='.repeat(60))
  console.log('')
  console.log('This script will launch a browser window.')
  console.log('1. Log in to Scoutbook')
  console.log('2. Navigate to a merit badge requirements page')
  console.log('3. Come back here and press Enter to extract')
  console.log('')
  console.log('Starting browser...')

  const browser = await chromium.launch({
    headless: false,  // Show the browser so user can log in
    slowMo: 100,      // Slow down for visibility
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  })

  const page = await context.newPage()

  // Navigate to Scoutbook
  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  console.log('')
  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook in the browser window')
  console.log('2. Navigate to a scout\'s merit badge page')
  console.log('   (e.g., click on a scout, then Merit Badges, then a specific badge)')
  console.log('')

  let continueLoop = true

  while (continueLoop) {
    await waitForKeypress('Press Enter when you\'re on a merit badge page (or type "quit" and Enter to exit)...\n')

    const currentUrl = page.url()
    console.log(`\nCurrent URL: ${currentUrl}`)
    console.log('Extracting data...\n')

    try {
      const data = await extractMeritBadgeData(page)

      console.log('='.repeat(60))
      console.log('EXTRACTED DATA')
      console.log('='.repeat(60))
      console.log(`Badge Name: ${data.badgeName}`)
      console.log(`Current Version: ${data.currentVersion || 'Not found'}`)
      console.log(`Available Versions: ${data.availableVersions.length > 0 ? data.availableVersions.join(', ') : 'Not found'}`)
      console.log(`Requirements Found: ${data.requirements.length}`)
      console.log('')

      if (data.requirements.length > 0) {
        console.log('Requirements:')
        console.log('-'.repeat(40))
        data.requirements.slice(0, 15).forEach(req => {
          const status = req.isCompleted ? '✓' : '○'
          const date = req.completedDate ? ` (${req.completedDate})` : ''
          console.log(`  ${status} ${req.number}: ${req.description.substring(0, 60)}...${date}`)
        })
        if (data.requirements.length > 15) {
          console.log(`  ... and ${data.requirements.length - 15} more`)
        }
      } else {
        console.log('No requirements found - check debug info below')
      }

      // Show debug info
      const debugInfo = (data as any).debugInfo
      if (debugInfo) {
        console.log('')
        console.log('DEBUG INFO:')
        console.log('-'.repeat(40))
        console.log(`Page Title: ${debugInfo.pageTitle}`)
        console.log(`Breadcrumb: ${debugInfo.breadcrumb || 'Not found'}`)
        console.log(`Found Classes: ${debugInfo.foundClasses?.slice(0, 5).join(', ') || 'None'}`)
        if (debugInfo.versionSelectorHtml) {
          console.log(`Version Selector: Found`)
        }
        if (debugInfo.requirementsContainerHtml) {
          console.log(`Requirements Container: ${debugInfo.requirementsContainerHtml.substring(0, 100)}...`)
        }
      }

      // Save to file for inspection
      const filename = `scraped-mb-${Date.now()}.json`
      const outputPath = `scripts/output/${filename}`

      // Ensure output directory exists
      if (!fs.existsSync('scripts/output')) {
        fs.mkdirSync('scripts/output', { recursive: true })
      }

      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2))
      console.log('')
      console.log(`Full data saved to: ${outputPath}`)

    } catch (error) {
      console.error('Error extracting data:', error)
    }

    console.log('')
    console.log('Navigate to another page and press Enter to extract again,')
    console.log('or close the browser window to exit.')
    console.log('')
  }

  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
