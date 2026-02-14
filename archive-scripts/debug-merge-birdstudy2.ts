import * as fs from 'fs'

// Load data
const csvData = JSON.parse(fs.readFileSync('./data/csv-requirement-ids.json', 'utf8'))
const scrapedData = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))

const csvVersion = csvData.badges.find((b: any) => b.badgeName === 'Bird Study' && b.versionYear === 2013)
const scrapedVersion = scrapedData.badges.find((b: any) => b.badgeName === 'Bird Study' && b.versionYear === 2013)

if (!csvVersion || !scrapedVersion) {
  console.log('Badge not found')
  process.exit(1)
}

const requirementIds = csvVersion.requirementIds as string[]

function normalizeId(id: string): string {
  return id.replace(/[()[\]]/g, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function idsMatch(
  csvId: string,
  uiLabel: string,
  parentNumber: string | null,
  currentOption: string | null,
  currentLetter: string | null,
  letterIsHeader: boolean
): boolean {
  const normCsv = normalizeId(csvId)
  const normUi = normalizeId(uiLabel)
  const csvLower = csvId.toLowerCase()

  // Direct match
  if (normCsv === normUi) return true

  // Try parent + label
  if (parentNumber && uiLabel) {
    const compositeId = normalizeId(parentNumber + uiLabel)
    if (normCsv === compositeId) return true
  }

  // Bracket notation
  if (letterIsHeader && currentLetter && parentNumber && /^\d+$/.test(normUi)) {
    const bracketId = `${parentNumber}${currentLetter}[${normUi}]`
    if (csvLower === bracketId) return true

    const noBracketId = `${parentNumber}${currentLetter}${normUi}`
    if (normCsv === noBracketId) return true

    const parenId = `${parentNumber}${currentLetter}(${normUi})`
    if (csvLower === parenId) return true
  }

  return false
}

// Track context
let currentOption: string | null = null
let currentLetter: string | null = null
let letterIsHeader = false
const matchedCsvIds = new Set<string>()

console.log('Processing Bird Study 2013...')
console.log('')

for (let i = 0; i < scrapedVersion.requirements.length; i++) {
  const scraped = scrapedVersion.requirements[i]
  const rawLabel = scraped.displayLabel || ''
  const cleanLabel = rawLabel.replace(/[()[\].]/g, '').trim()
  const isWrapped = /^[(\[]/.test(rawLabel.trim())

  // Update context - main number
  if (/^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 20 && !isWrapped) {
    currentOption = null
    currentLetter = null
    letterIsHeader = false
  }

  // Update context - letter
  if (/^[a-z]$/i.test(cleanLabel)) {
    currentLetter = cleanLabel.toLowerCase()
    letterIsHeader = !scraped.hasCheckbox
  }

  // Try to match
  let matchedCsvId: string | null = null
  if (rawLabel) {
    for (const csvId of requirementIds) {
      if (idsMatch(csvId, rawLabel, scraped.parentNumber, currentOption, currentLetter, letterIsHeader)) {
        matchedCsvId = csvId
        matchedCsvIds.add(normalizeId(csvId))
        break
      }
    }
  }

  // Only show requirement 7 area
  if (scraped.parentNumber === '7' || cleanLabel === '7') {
    console.log(i + '.', 'label:', JSON.stringify(rawLabel),
      '| matched:', matchedCsvId || 'NONE',
      '| ctx: letter=' + currentLetter + ' isHeader=' + letterIsHeader)
  }
}

console.log('')
console.log('Matched CSV IDs:', [...matchedCsvIds].filter(id => id.includes('7')))

// Check for unmatched
console.log('')
console.log('Unmatched CSV IDs:')
for (const csvId of requirementIds) {
  if (csvId.includes('7') && !matchedCsvIds.has(normalizeId(csvId))) {
    console.log('  ' + csvId)
  }
}
