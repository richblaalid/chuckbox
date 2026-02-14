/**
 * Fix CSV ID Matching Script
 *
 * This script addresses remaining unmatched CSV IDs by implementing
 * comprehensive pattern matching for complex ID formats.
 *
 * Patterns to handle:
 * 1. space_option: "6c2 hog", "6d sheep" - parent+letter+number+option
 * 2. bracket_option: "2a[1] Ice" - bracket notation with option
 * 3. bracket_only: "2d[1]", "7a[1]" - just bracket notation
 * 4. paren_nested: "3a(1)", "2(a)(1)" - parenthetical nesting
 * 5. three_part: "8a1", "2a1" - no separator between parts
 * 6. opt_format: "5f[1]b Opt A" - complex with Opt suffix
 * 7. option_format: "5 Option A(1)" - full "Option" word format
 * 8. other: "6 avian (1)" - space then option then paren
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================
// Types
// ============================================

interface ScrapedRequirement {
  displayLabel: string
  description: string
  parentNumber: string | null
  depth: number
  visualDepth: number
  isHeader: boolean
  hasCheckbox: boolean
  links: Array<{ url: string; text: string; type: string }>
  rawHtml?: string
  position?: { mainReq: string }
}

interface ScrapedBadgeVersion {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  badges: ScrapedBadgeVersion[]
}

interface CsvBadgeVersion {
  badgeName: string
  versionYear: number
  requirementIds: string[]
  totalOccurrences: number
}

interface CsvData {
  badges: CsvBadgeVersion[]
}

interface MatchResult {
  csvId: string
  matchedIndex: number | null
  matchType: string
  confidence: number
}

// ============================================
// Pattern Matching Functions
// ============================================

/**
 * Normalize an ID for comparison
 */
function normalizeId(id: string): string {
  return id
    .replace(/[()[\]]/g, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Extract components from a CSV ID
 */
function parseCSVId(csvId: string): {
  mainNum: string | null
  letter: string | null
  subNum: string | null
  subLetter: string | null
  option: string | null
  format: string
} {
  const id = csvId.trim()

  // Format: "5 Option A(1)" or "8 Option A (1)" or "5 Option A (1)(a)"
  let match = id.match(/^(\d+)\s+Option\s+([A-Z])\s*\((\d+)\)(?:\(([a-z])\))?/i)
  if (match) {
    return { mainNum: match[1], letter: null, subNum: match[3], subLetter: match[4] || null, option: `option ${match[2].toLowerCase()}`, format: 'option_format' }
  }

  // Format: "5. Opt A (1)" - with dot after number
  match = id.match(/^(\d+)\.\s*Opt\s+([A-Z])\s*\((\d+)\)/i)
  if (match) {
    return { mainNum: match[1], letter: null, subNum: match[3], subLetter: null, option: `opt ${match[2].toLowerCase()}`, format: 'opt_dot_format' }
  }

  // Format: "6 avian (1)" or "6 beef (1)" or "6 avian (4)(a)"
  match = id.match(/^(\d+)\s+(\w+)\s+\((\d+)\)(?:\(([a-z])\))?/i)
  if (match) {
    return { mainNum: match[1], letter: null, subNum: match[3], subLetter: match[4] || null, option: match[2].toLowerCase(), format: 'other' }
  }

  // Format: "6(2) hog" - number with paren then option
  match = id.match(/^(\d+)\((\d+)\)\s+(\w+)/i)
  if (match) {
    return { mainNum: match[1], letter: null, subNum: match[2], subLetter: null, option: match[3].toLowerCase(), format: 'paren_option' }
  }

  // Format: "5f[1]b Opt A" or "2a Opt a" or "5a Opt A"
  match = id.match(/^(\d+)([a-z])?(?:\[(\d+)\])?([a-z])?\s+Opt\s+([A-Za-z])/i)
  if (match) {
    return { mainNum: match[1], letter: match[2] || null, subNum: match[3] || null, subLetter: match[4] || null, option: `opt ${match[5].toLowerCase()}`, format: 'opt_format' }
  }

  // Format: "8A Opt 1" or "8A Opt 2" - uppercase letter with Opt number
  match = id.match(/^(\d+)([A-Z])\s+Opt\s+(\d+)/i)
  if (match) {
    return { mainNum: match[1], letter: match[2].toLowerCase(), subNum: null, subLetter: null, option: `opt ${match[3]}`, format: 'opt_num_format' }
  }

  // Format: "8A1 Opt 3" - letter+number with Opt
  match = id.match(/^(\d+)([A-Z])(\d+)\s+Opt\s+(\d+)/i)
  if (match) {
    return { mainNum: match[1], letter: match[2].toLowerCase(), subNum: match[3], subLetter: null, option: `opt ${match[4]}`, format: 'opt_num_format' }
  }

  // Format: "2a[1] Ice" - bracket with option
  match = id.match(/^(\d+)([a-z])\[(\d+)\]\s+(\w+)/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: match[3], subLetter: null, option: match[4].toLowerCase(), format: 'bracket_option' }
  }

  // Format: "2d[1]" - bracket only
  match = id.match(/^(\d+)([a-z])\[(\d+)\]$/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: match[3], subLetter: null, option: null, format: 'bracket_only' }
  }

  // Format: "3a(1)" or "2(a)(1)" or "6b(i)"
  match = id.match(/^(\d+)([a-z])?\(([a-z]|\d+|i+)\)(?:\((\d+)\))?/i)
  if (match) {
    const part3 = match[3]
    if (/^\d+$/.test(part3) || /^i+$/i.test(part3)) {
      // "3a(1)" or "6b(i)" format
      return { mainNum: match[1], letter: match[2] || null, subNum: part3, subLetter: null, option: null, format: 'paren_nested' }
    } else {
      // "2(a)(1)" format
      return { mainNum: match[1], letter: part3, subNum: match[4] || null, subLetter: null, option: null, format: 'paren_nested' }
    }
  }

  // Format: "6c2 hog" or "5a Grp 1" - space option with possible sub-number
  match = id.match(/^(\d+)([a-z])(\d+)?\s+(.+)$/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: match[3] || null, subLetter: null, option: match[4].toLowerCase(), format: 'space_option' }
  }

  // Format: "8a1" - three part
  match = id.match(/^(\d+)([a-z])(\d+)$/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: match[3], subLetter: null, option: null, format: 'three_part' }
  }

  // Format: "2a." or "2a" - simple (with optional dot)
  match = id.match(/^(\d+)([a-z])\.?$/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: null, subLetter: null, option: null, format: 'simple' }
  }

  // Format: "1" - just number
  match = id.match(/^(\d+)\.?$/i)
  if (match) {
    return { mainNum: match[1], letter: null, subNum: null, subLetter: null, option: null, format: 'number_only' }
  }

  return { mainNum: null, letter: null, subNum: null, subLetter: null, option: null, format: 'unknown' }
}

/**
 * Build a context stack from requirements up to a given index
 * This tracks the parent chain: mainNum -> letter -> subNum
 *
 * Key insight: When we see a letter (a, b, c) that has NO checkbox,
 * it's a header and subsequent numbered items are its children.
 */
function buildContextStack(requirements: ScrapedRequirement[], upToIndex: number): {
  mainNum: string | null
  letter: string | null
  letterIsHeader: boolean
  subLetter: string | null
  option: string | null
  letterIndex: number | null
  subLetterIndex: number | null
} {
  let mainNum: string | null = null
  let letter: string | null = null
  let letterIsHeader: boolean = false
  let subLetter: string | null = null
  let option: string | null = null
  let letterIndex: number | null = null
  let subLetterIndex: number | null = null

  for (let i = 0; i <= upToIndex; i++) {
    const req = requirements[i]
    const rawLabel = req.displayLabel || ''
    const label = rawLabel.replace(/[()[\].]/g, '').trim() || ''
    const desc = req.description?.toLowerCase() || ''

    // Check if label is wrapped in parentheses/brackets - indicates sub-item
    const isWrapped = /^[(\[]/.test(rawLabel.trim())

    // Main requirement number resets everything
    // BUT only if it's NOT wrapped in parens (i.e., "(1)" is not a main number)
    if (/^\d+$/.test(label) && parseInt(label) <= 20 && !isWrapped) {
      mainNum = label
      letter = null
      letterIsHeader = false
      subLetter = null
      option = null
      letterIndex = null
      subLetterIndex = null
      continue
    }

    // Option header (no label, description has option keyword)
    if (!req.displayLabel && desc) {
      const optMatch = extractOptionFromDesc(desc)
      if (optMatch) {
        option = optMatch
        letter = null
        letterIsHeader = false
        subLetter = null
        letterIndex = null
        subLetterIndex = null
        continue
      }
    }

    // Letter label (a, b, c) - track if it's a header (no checkbox)
    if (/^[a-z]$/i.test(label)) {
      // If we already have a letter and this is a new one, reset sub-letter
      if (letter !== null && label.toLowerCase() !== letter) {
        subLetter = null
        subLetterIndex = null
      }
      letter = label.toLowerCase()
      letterIsHeader = !req.hasCheckbox
      letterIndex = i
      continue
    }

    // Numbered item wrapped in parens like "(1)" - this is a sub-item
    // Don't reset letter context when we see these
    if (/^\d+$/.test(label) && parseInt(label) <= 10 && isWrapped) {
      // This is a sub-number, keep the current context
      continue
    }

    // Sub-letter after a letter (for formats like "5f[1]b")
    if (/^[a-z]$/i.test(label) && letterIndex !== null && i > letterIndex) {
      subLetter = label.toLowerCase()
      subLetterIndex = i
      continue
    }
  }

  return { mainNum, letter, letterIsHeader, subLetter, option, letterIndex, subLetterIndex }
}

/**
 * Extract option name from description
 */
function extractOptionFromDesc(desc: string): string | null {
  const descLower = desc.toLowerCase()

  // Check for "Option X" or "Option X—..." pattern first (e.g., "Option A—Sprinting")
  // This handles formats like "Option A", "Option B", etc. with or without description
  const optionLetterMatch = desc.match(/^Option\s+([A-Z])(?:\s*[—\-–.]|$)/i)
  if (optionLetterMatch) {
    return `option ${optionLetterMatch[1].toLowerCase()}`
  }

  // Check for "Option N" pattern (e.g., "Option 1", "Option 2")
  const optionNumberMatch = desc.match(/^Option\s+(\d+)(?:\s*[—\-–.]|$)/i)
  if (optionNumberMatch) {
    return `option ${optionNumberMatch[1]}`
  }

  // Map full names to short CSV names
  const mappings: Record<string, string> = {
    'beef cattle': 'beef',
    'dairying': 'dairy',
    'dairy cattle': 'dairy',
    'horse': 'horse',
    'sheep': 'sheep',
    'hog': 'hog',
    'swine': 'hog',
    'avian': 'avian',
    'poultry': 'avian',
    'rabbit': 'rabbit',
    'ice skating': 'ice',
    'inline skating': 'line',
    'roller skating': 'roll',
    'board skating': 'board',
    'skateboard': 'board',
    'alpine skiing': 'alpine',
    'alpine': 'alpine',
    'nordic skiing': 'nordic',
    'nordic': 'nordic',
    'snowshoe': 'shoe',
    'snowshoeing': 'shoe',
    'snowboard': 'snow',
    'triathlon': 'triathlon',
    'duathlon': 'duathlon',
    'aquathlon': 'aquathlon',
    'aquabike': 'aquabike',
    'group 1': 'grp 1',
    'group 2': 'grp 2',
    'group 3': 'grp 3',
    'group 4': 'grp 4',
    'group a': 'grp a',
    'group b': 'grp b',
    'group c': 'grp c',
    'group d': 'grp d',
    'group e': 'grp e',
    'group f': 'grp f',
    'group g': 'grp g',
    'group h': 'grp h',
    'group i': 'grp i',
    'opt 1': 'opt 1',
    'opt 2': 'opt 2',
    'opt 3': 'opt 3',
    'opt a': 'opt a',
    'opt b': 'opt b',
    'opt c': 'opt c',
  }

  for (const [pattern, shortName] of Object.entries(mappings)) {
    if (descLower.includes(pattern)) {
      return shortName
    }
  }

  // Check for "X Option" pattern (e.g., "Beef Cattle Option")
  const xOptionMatch = desc.match(/^(.+?)\s*Option$/i)
  if (xOptionMatch) {
    const name = xOptionMatch[1].trim().toLowerCase()
    // Return first word for multi-word options
    return name.split(/\s+/)[0]
  }

  return null
}

/**
 * Try to match a CSV ID to a requirement at a given index
 */
function tryMatch(
  csvId: string,
  requirements: ScrapedRequirement[],
  reqIndex: number,
  context: ReturnType<typeof buildContextStack>
): { matched: boolean; confidence: number; reason: string } {
  const req = requirements[reqIndex]
  const label = req.displayLabel?.replace(/[()[\].]/g, '').trim().toLowerCase() || ''
  const parsed = parseCSVId(csvId)

  // Build expected components from context + current label
  const hasMainNum = context.mainNum === parsed.mainNum
  const hasLetter = context.letter === parsed.letter
  const hasOption = context.option === parsed.option || (!parsed.option && !context.option)

  // For sub-numbers under letter headers, the letter context should match
  // e.g., "6c[1]" needs label="1", context.letter="c", context.mainNum="6"
  const isSubNumUnderLetter = context.letterIsHeader && /^\d+$/.test(label) && parseInt(label) <= 10

  // Check if current label matches the expected sub-component
  let labelMatches = false
  let confidence = 0
  let reason = ''

  switch (parsed.format) {
    case 'simple':
      // "2a" - should match label "a" under parent "2"
      labelMatches = label === parsed.letter && hasMainNum
      confidence = labelMatches ? 95 : 0
      reason = `simple: label=${label}, expected=${parsed.letter}, parent=${context.mainNum}`
      break

    case 'bracket_only':
      // "6c[1]" - should match label "1" under letter "c" (header) under parent "6"
      labelMatches = label === parsed.subNum && hasMainNum && hasLetter && isSubNumUnderLetter
      confidence = labelMatches ? 92 : 0
      reason = `bracket_only: label=${label}, letter=${context.letter}, letterIsHeader=${context.letterIsHeader}, expected subNum=${parsed.subNum}`
      break

    case 'bracket_option':
      // "2a[1] Ice" - should match label "1" under letter "a" under parent "2" with option "ice"
      labelMatches = label === parsed.subNum && hasMainNum && hasLetter && hasOption
      confidence = labelMatches ? 85 : 0
      reason = `bracket_option: label=${label}, option=${context.option}, expected=${parsed.option}`
      break

    case 'paren_nested':
      // "3a(1)" or "6c(1)" - should match label "1" under letter "a/c" under parent "3/6"
      if (parsed.letter && parsed.subNum) {
        // Check if this is a sub-number under a letter header
        labelMatches = label === parsed.subNum && hasMainNum && hasLetter
        // Higher confidence if the letter is a header
        confidence = labelMatches ? (context.letterIsHeader ? 92 : 88) : 0
      } else if (parsed.subNum) {
        // "2(a)(1)" style - need to check deeper nesting
        labelMatches = label === parsed.subNum && hasMainNum
        confidence = labelMatches ? 85 : 0
      }
      reason = `paren_nested: label=${label}, letter=${context.letter}, letterIsHeader=${context.letterIsHeader}, expected subNum=${parsed.subNum}`
      break

    case 'three_part':
      // "8a1" - should match label "1" under letter "a" under parent "8"
      labelMatches = label === parsed.subNum && hasMainNum && hasLetter
      confidence = labelMatches ? 90 : 0
      reason = `three_part: label=${label}, expected subNum=${parsed.subNum}`
      break

    case 'space_option':
      // "6c2 hog" - should match label "2" under letter "c" under parent "6" with option "hog"
      if (parsed.subNum) {
        labelMatches = label === parsed.subNum && hasMainNum && hasLetter && hasOption
      } else {
        // "6a hog" - just letter + option
        labelMatches = label === parsed.letter && hasMainNum && hasOption
      }
      confidence = labelMatches ? 85 : 0
      reason = `space_option: label=${label}, letter=${context.letter}, option=${context.option}, expected option=${parsed.option}`
      break

    case 'opt_format':
      // "5f[1]b Opt A" - complex
      labelMatches = hasMainNum && hasOption
      if (parsed.subLetter) {
        labelMatches = labelMatches && label === parsed.subLetter
      } else if (parsed.subNum) {
        labelMatches = labelMatches && label === parsed.subNum
      } else if (parsed.letter) {
        labelMatches = labelMatches && label === parsed.letter
      }
      confidence = labelMatches ? 80 : 0
      reason = `opt_format: label=${label}, option=${context.option}`
      break

    case 'option_format':
      // "5 Option A(1)" - mainNum + "option a" + subNum
      // Also handle "5 Option A (1)(a)" with subLetter
      if (parsed.subLetter) {
        labelMatches = label === parsed.subLetter && hasMainNum && hasOption
      } else {
        labelMatches = label === parsed.subNum && hasMainNum && hasOption
      }
      confidence = labelMatches ? 82 : 0
      reason = `option_format: label=${label}, expected subNum=${parsed.subNum}, subLetter=${parsed.subLetter}, option=${context.option}`
      break

    case 'opt_dot_format':
      // "5. Opt A (1)" - same as option_format but with dot
      labelMatches = label === parsed.subNum && hasMainNum && hasOption
      confidence = labelMatches ? 80 : 0
      reason = `opt_dot_format: label=${label}, expected subNum=${parsed.subNum}, option=${context.option}`
      break

    case 'paren_option':
      // "6(2) hog" - mainNum + subNum + option
      labelMatches = label === parsed.subNum && hasMainNum && hasOption
      confidence = labelMatches ? 80 : 0
      reason = `paren_option: label=${label}, expected subNum=${parsed.subNum}, option=${context.option}`
      break

    case 'opt_num_format':
      // "8A Opt 1" - mainNum + letter + opt N
      labelMatches = hasMainNum && hasOption
      if (parsed.subNum) {
        labelMatches = labelMatches && label === parsed.subNum
      } else if (parsed.letter) {
        labelMatches = labelMatches && label === parsed.letter
      }
      confidence = labelMatches ? 78 : 0
      reason = `opt_num_format: label=${label}, option=${context.option}`
      break

    case 'other':
      // "6 avian (1)" - mainNum + option + subNum
      // Also handle "6 avian (4)(a)" with subLetter
      if (parsed.subLetter) {
        labelMatches = label === parsed.subLetter && hasMainNum && hasOption
      } else {
        labelMatches = label === parsed.subNum && hasMainNum && hasOption
      }
      confidence = labelMatches ? 78 : 0
      reason = `other: label=${label}, expected subNum=${parsed.subNum}, subLetter=${parsed.subLetter}, option=${context.option}`
      break

    default:
      labelMatches = false
      confidence = 0
      reason = `unknown format: ${parsed.format}`
  }

  return { matched: labelMatches, confidence, reason }
}

/**
 * Find the best match for a CSV ID in the requirements list
 */
function findBestMatch(
  csvId: string,
  requirements: ScrapedRequirement[],
  alreadyMatched: Set<number>
): MatchResult {
  let bestMatch: MatchResult = {
    csvId,
    matchedIndex: null,
    matchType: 'none',
    confidence: 0
  }

  for (let i = 0; i < requirements.length; i++) {
    if (alreadyMatched.has(i)) continue

    const context = buildContextStack(requirements, i)
    const result = tryMatch(csvId, requirements, i, context)

    if (result.matched && result.confidence > bestMatch.confidence) {
      bestMatch = {
        csvId,
        matchedIndex: i,
        matchType: result.reason,
        confidence: result.confidence
      }
    }
  }

  return bestMatch
}

// ============================================
// Main Processing
// ============================================

async function main() {
  console.log('============================================================')
  console.log('CSV ID Matching Fixer')
  console.log('============================================================\n')

  // Load data
  const csvDataPath = path.join(process.cwd(), 'data/csv-requirement-ids.json')
  const scrapedDataPath = path.join(process.cwd(), 'data/merit-badge-requirements-scraped.json')
  const discrepancyPath = path.join(process.cwd(), 'data/discrepancy-report.json')

  console.log('Loading data...')
  const csvData: CsvData = JSON.parse(fs.readFileSync(csvDataPath, 'utf8'))
  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedDataPath, 'utf8'))
  const discrepancies = JSON.parse(fs.readFileSync(discrepancyPath, 'utf8'))

  console.log(`  CSV: ${csvData.badges.length} badge versions`)
  console.log(`  Scraped: ${scrapedData.badges.length} badge versions`)
  console.log(`  Discrepancies: ${discrepancies.total_discrepancies}`)

  // Group discrepancies by badge+version
  const discrepancyMap = new Map<string, string[]>()
  for (const d of discrepancies.discrepancies) {
    if (d.type !== 'csv_not_in_ui') continue
    const key = `${d.badgeName}|${d.versionYear}`
    if (!discrepancyMap.has(key)) discrepancyMap.set(key, [])
    discrepancyMap.get(key)!.push(d.scoutbookId)
  }

  console.log(`\nProcessing ${discrepancyMap.size} badge versions with discrepancies...\n`)

  // Track statistics
  let totalFixed = 0
  let totalRemaining = 0
  const fixesByPattern: Record<string, number> = {}
  const remainingByPattern: Record<string, string[]> = {}

  // Process each badge version with discrepancies
  for (const [key, unmatchedIds] of discrepancyMap) {
    const [badgeName, versionYearStr] = key.split('|')
    const versionYear = parseInt(versionYearStr)

    // Find scraped version
    const scraped = scrapedData.badges.find(
      b => b.badgeName === badgeName && b.versionYear === versionYear
    )
    if (!scraped) {
      console.log(`  SKIP: ${badgeName} v${versionYear} - not in scraped data`)
      continue
    }

    // Track which requirements are already matched
    const alreadyMatched = new Set<number>()

    // First pass: mark requirements that have direct label matches with CSV
    const csvVersion = csvData.badges.find(
      b => b.badgeName === badgeName && b.versionYear === versionYear
    )
    if (csvVersion) {
      for (let i = 0; i < scraped.requirements.length; i++) {
        const req = scraped.requirements[i]
        const label = req.displayLabel || ''
        const normLabel = normalizeId(label)

        // Check direct matches
        for (const csvId of csvVersion.requirementIds) {
          if (!unmatchedIds.includes(csvId)) {
            // This CSV ID was already matched
            const normCsv = normalizeId(csvId)
            if (normCsv === normLabel) {
              alreadyMatched.add(i)
              break
            }
            // Also check parent+label composite
            if (req.parentNumber) {
              const composite = normalizeId(req.parentNumber + label)
              if (normCsv === composite) {
                alreadyMatched.add(i)
                break
              }
            }
          }
        }
      }
    }

    // Second pass: try to match unmatched CSV IDs
    let fixedCount = 0
    const stillUnmatched: string[] = []

    for (const csvId of unmatchedIds) {
      const match = findBestMatch(csvId, scraped.requirements, alreadyMatched)

      if (match.matchedIndex !== null && match.confidence >= 75) {
        alreadyMatched.add(match.matchedIndex)
        fixedCount++

        const parsed = parseCSVId(csvId)
        fixesByPattern[parsed.format] = (fixesByPattern[parsed.format] || 0) + 1
      } else {
        stillUnmatched.push(csvId)

        const parsed = parseCSVId(csvId)
        if (!remainingByPattern[parsed.format]) remainingByPattern[parsed.format] = []
        remainingByPattern[parsed.format].push(csvId)
      }
    }

    if (fixedCount > 0 || stillUnmatched.length > 0) {
      console.log(`  ${badgeName} v${versionYear}: ${fixedCount} fixed, ${stillUnmatched.length} remaining`)
      if (stillUnmatched.length > 0 && stillUnmatched.length <= 5) {
        console.log(`    Remaining: ${stillUnmatched.join(', ')}`)
      }
    }

    totalFixed += fixedCount
    totalRemaining += stillUnmatched.length
  }

  console.log('\n============================================================')
  console.log('RESULTS')
  console.log('============================================================')
  console.log(`Total fixed: ${totalFixed}`)
  console.log(`Total remaining: ${totalRemaining}`)
  console.log(`Original discrepancies: ${discrepancies.total_discrepancies - 1}`) // -1 for badge_not_accessible

  console.log('\nFixes by pattern:')
  for (const [pattern, count] of Object.entries(fixesByPattern).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pattern}: ${count}`)
  }

  console.log('\nRemaining by pattern:')
  for (const [pattern, ids] of Object.entries(remainingByPattern).sort((a, b) => b[1].length - a[1].length)) {
    const unique = [...new Set(ids)]
    console.log(`  ${pattern}: ${ids.length} (${unique.length} unique)`)
    console.log(`    Examples: ${unique.slice(0, 5).join(', ')}`)
  }
}

main().catch(console.error)
