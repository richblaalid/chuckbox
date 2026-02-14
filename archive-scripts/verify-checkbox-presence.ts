#!/usr/bin/env npx tsx
/**
 * Verify Checkbox Presence for Parent Requirements
 *
 * This script checks Scoutbook's UI to determine if requirements
 * have checkboxes (approvable) or not (description/header only).
 *
 * Usage:
 *   npx tsx scripts/verify-checkbox-presence.ts
 *
 * You'll need to:
 * 1. Log in to Scoutbook manually
 * 2. Navigate to a scout's Merit Badges page
 * 3. Press Enter to start verification
 */

import { chromium, Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

interface RequirementToVerify {
  badgeName: string
  versionYear: number
  requirementNumber: string
  description: string
}

interface VerificationResult {
  badgeName: string
  versionYear: number
  requirementNumber: string
  description: string
  hasCheckbox: boolean | null
  error?: string
}

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

async function dismissPopups(page: Page): Promise<void> {
  const dismissSelectors = [
    '.ant-modal-confirm-btns button:has-text("No")',
    'button:has-text("No")',
    'button:has-text("Stay logged in")',
    '.ant-modal-close',
  ]

  for (const selector of dismissSelectors) {
    try {
      const button = await page.$(selector)
      if (button && (await button.isVisible())) {
        await button.click({ force: true })
        await page.waitForTimeout(300)
      }
    } catch {
      // Ignore
    }
  }
}

async function selectVersion(page: Page, versionYear: number): Promise<boolean> {
  const versionSelector = await page.$('[class*="VersionSelector__versionSelect"]')
  if (!versionSelector) return false

  await versionSelector.click({ force: true })
  await page.waitForTimeout(300)

  // Find and click the option containing the year
  const clicked = await page.evaluate((year) => {
    const options = Array.from(
      document.querySelectorAll('.ant-select-dropdown-menu-item, .ant-select-item-option')
    )
    for (const opt of options) {
      if (opt.textContent?.includes(String(year))) {
        ;(opt as HTMLElement).click()
        return true
      }
    }
    return false
  }, versionYear)

  if (clicked) {
    await page.waitForTimeout(800)
  } else {
    await page.keyboard.press('Escape')
  }

  return clicked
}

/**
 * Check if a specific requirement has a checkbox in the UI
 */
async function checkRequirementForCheckbox(
  page: Page,
  requirementNumber: string
): Promise<{ hasCheckbox: boolean; details: string }> {
  // This evaluates in the browser context to find the requirement and check for checkbox
  const result = await page.evaluate((reqNum) => {
    // Find all requirement panels
    const panels = document.querySelectorAll('.ant-collapse-item')

    for (const panel of panels) {
      // Get the main requirement number
      const circleLabel = panel.querySelector(
        '[class*="CircleLabel__circle"], [class*="requirementGroupListNumber"]'
      )
      const mainReqNum = circleLabel?.textContent?.trim() || ''

      // Check if this is the requirement we're looking for
      if (mainReqNum === reqNum) {
        // Look for checkbox in the main requirement header area
        // Scoutbook uses ant-checkbox for approvable requirements
        const headerArea = panel.querySelector('.ant-collapse-header')
        const checkbox = headerArea?.querySelector('.ant-checkbox, input[type="checkbox"]')

        // Also check for the requirement content area
        const contentArea = panel.querySelector('.ant-collapse-content')
        const contentCheckbox = contentArea?.querySelector(
          '.ant-checkbox:not([class*="select-all"]), input[type="checkbox"]:not([class*="select-all"])'
        )

        // Check if "Select All" is the only checkbox (meaning parent has no checkbox)
        const selectAllText = contentArea?.textContent?.includes('Select All')
        const allCheckboxes = panel.querySelectorAll('.ant-checkbox, input[type="checkbox"]')

        return {
          found: true,
          hasCheckbox: checkbox !== null,
          hasContentCheckbox: contentCheckbox !== null,
          checkboxCount: allCheckboxes.length,
          hasSelectAll: selectAllText || false,
          details: `mainReq=${mainReqNum}, headerCheckbox=${checkbox !== null}, contentCheckbox=${contentCheckbox !== null}, total=${allCheckboxes.length}, selectAll=${selectAllText}`,
        }
      }
    }

    return {
      found: false,
      hasCheckbox: false,
      details: `Requirement ${reqNum} not found on page`,
    }
  }, requirementNumber)

  // A requirement is approvable if it has a checkbox that's NOT just "Select All"
  // If there's only 1 checkbox and it's "Select All", parent is NOT approvable
  const isApprovable = result.hasCheckbox || ((result.checkboxCount ?? 0) > 1 && !result.hasSelectAll)

  return {
    hasCheckbox: isApprovable,
    details: result.details,
  }
}

async function getSampleRequirementsToVerify(): Promise<RequirementToVerify[]> {
  // Get parent requirements from BSA table (those with children)
  const { data: allReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select(
      `
      id,
      requirement_number,
      description,
      parent_requirement_id,
      version_year,
      bsa_merit_badges(name)
    `
    )
    .order('id')

  if (!allReqs) return []

  // Find parent IDs
  const parentIds = new Set<string>()
  for (const req of allReqs) {
    if (req.parent_requirement_id) {
      parentIds.add(req.parent_requirement_id)
    }
  }

  // Get sample of parent requirements
  const parents: RequirementToVerify[] = []
  const seenBadges = new Set<string>()

  for (const req of allReqs) {
    if (!parentIds.has(req.id)) continue

    const badgeName = (req.bsa_merit_badges as unknown as { name: string })?.name
    const key = `${badgeName}|${req.version_year}`

    // Only take one requirement per badge/version for the sample
    if (seenBadges.has(key)) continue
    seenBadges.add(key)

    parents.push({
      badgeName,
      versionYear: req.version_year || 2026,
      requirementNumber: req.requirement_number,
      description: req.description || '',
    })

    // Limit sample size
    if (parents.length >= 10) break
  }

  return parents
}

async function main() {
  console.log('='.repeat(60))
  console.log('Checkbox Presence Verification')
  console.log('='.repeat(60))
  console.log('')
  console.log('This script verifies which requirements have checkboxes')
  console.log('(approvable) vs which are description-only (headers).')
  console.log('')

  // Get sample requirements to verify
  console.log('Loading sample requirements to verify...')
  const toVerify = await getSampleRequirementsToVerify()
  console.log(`Found ${toVerify.length} sample requirements to verify`)

  if (toVerify.length === 0) {
    console.log('No requirements to verify')
    return
  }

  // Show what we'll verify
  console.log('\nRequirements to verify:')
  for (const req of toVerify) {
    console.log(`  ${req.badgeName} ${req.versionYear} req ${req.requirementNumber}`)
    console.log(`    "${req.description.substring(0, 60)}..."`)
  }

  console.log('\nStarting browser...')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  })

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  })

  const page = await context.newPage()

  // Navigate to Scoutbook
  await page.goto('https://advancements.scouting.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  console.log('')
  console.log('Browser launched! Please:')
  console.log('1. Log in to Scoutbook')
  console.log("2. Navigate to any scout's Merit Badges page")
  console.log('')

  await waitForKeypress('Press Enter when ready to start verification...\n')

  const results: VerificationResult[] = []

  // Group by badge for efficient navigation
  const byBadge = new Map<string, RequirementToVerify[]>()
  for (const req of toVerify) {
    const key = `${req.badgeName}|${req.versionYear}`
    const existing = byBadge.get(key) || []
    existing.push(req)
    byBadge.set(key, existing)
  }

  for (const [key, reqs] of byBadge) {
    const [badgeName, yearStr] = key.split('|')
    const versionYear = parseInt(yearStr, 10)

    console.log(`\nVerifying: ${badgeName} ${versionYear}`)

    try {
      // Dismiss any popups
      await dismissPopups(page)

      // Find and click the badge card
      const nameEl = await page.$(`[class*="AdvancementCardItem__name"]:text-is("${badgeName}")`)
      if (!nameEl) {
        console.log(`  Could not find badge card for: ${badgeName}`)
        for (const req of reqs) {
          results.push({
            ...req,
            hasCheckbox: null,
            error: 'Badge not found on page',
          })
        }
        continue
      }

      const card = await nameEl.evaluateHandle((el) => el.closest('[class*="AdvancementCardItem"]'))
      await (card as any).click({ force: true })
      await page.waitForSelector('[class*="VersionSelector"], [class*="AdvRequirements"]', {
        timeout: 20000,
      })
      await page.waitForTimeout(500)

      // Select the correct version
      await selectVersion(page, versionYear)

      // Check each requirement
      for (const req of reqs) {
        const { hasCheckbox, details } = await checkRequirementForCheckbox(
          page,
          req.requirementNumber
        )

        console.log(
          `  Req ${req.requirementNumber}: ${hasCheckbox ? '✓ HAS CHECKBOX' : '✗ NO CHECKBOX'}`
        )
        console.log(`    ${details}`)

        results.push({
          ...req,
          hasCheckbox,
        })
      }

      // Go back to list
      await page.goBack()
      await page.waitForTimeout(500)
    } catch (err) {
      console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      for (const req of reqs) {
        results.push({
          ...req,
          hasCheckbox: null,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Try to recover
      try {
        await page.goBack()
        await page.waitForTimeout(500)
      } catch {
        // Ignore
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('VERIFICATION RESULTS')
  console.log('='.repeat(60))

  const withCheckbox = results.filter((r) => r.hasCheckbox === true)
  const withoutCheckbox = results.filter((r) => r.hasCheckbox === false)
  const errors = results.filter((r) => r.hasCheckbox === null)

  console.log(`\nWith checkbox (approvable): ${withCheckbox.length}`)
  for (const r of withCheckbox) {
    console.log(`  ${r.badgeName} ${r.versionYear} req ${r.requirementNumber}`)
  }

  console.log(`\nWithout checkbox (header/description): ${withoutCheckbox.length}`)
  for (const r of withoutCheckbox) {
    console.log(`  ${r.badgeName} ${r.versionYear} req ${r.requirementNumber}`)
    console.log(`    "${r.description.substring(0, 60)}..."`)
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`)
    for (const r of errors) {
      console.log(`  ${r.badgeName}: ${r.error}`)
    }
  }

  // Save results
  const outputPath = 'data/checkbox-verification-results.json'
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`\nResults saved to: ${outputPath}`)

  await waitForKeypress('\nPress Enter to close the browser...\n')
  await browser.close()
}

main().catch(console.error)
