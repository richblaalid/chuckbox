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

console.log('Bird Study 2013')
console.log('CSV IDs:', csvVersion.requirementIds.filter((id: string) => id.includes('7')))
console.log('')

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
): { matched: boolean; reason: string } {
  const normCsv = normalizeId(csvId)
  const normUi = normalizeId(uiLabel)
  const csvLower = csvId.toLowerCase()

  // Direct match
  if (normCsv === normUi) return { matched: true, reason: 'direct' }

  // Try parent + label
  if (parentNumber && uiLabel) {
    const compositeId = normalizeId(parentNumber + uiLabel)
    if (normCsv === compositeId) return { matched: true, reason: 'composite' }
  }

  // Bracket notation
  if (letterIsHeader && currentLetter && parentNumber && /^\d+$/.test(normUi)) {
    const bracketId = `${parentNumber}${currentLetter}[${normUi}]`
    if (csvLower === bracketId) return { matched: true, reason: 'bracket' }

    const noBracketId = `${parentNumber}${currentLetter}${normUi}`
    if (normCsv === noBracketId) return { matched: true, reason: 'no_bracket' }

    const parenId = `${parentNumber}${currentLetter}(${normUi})`
    if (csvLower === parenId) return { matched: true, reason: 'paren' }
  }

  return { matched: false, reason: 'none' }
}

// Track context
let currentOption: string | null = null
let currentLetter: string | null = null
let letterIsHeader = false

const requirementIds = csvVersion.requirementIds as string[]

for (let i = 0; i < scrapedVersion.requirements.length; i++) {
  const scraped = scrapedVersion.requirements[i]
  const rawLabel = scraped.displayLabel || ''
  const cleanLabel = rawLabel.replace(/[()[\].]/g, '').trim()
  const isWrapped = /^[(\[]/.test(rawLabel.trim())

  // Update context
  if (/^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 20 && !isWrapped) {
    currentOption = null
    currentLetter = null
    letterIsHeader = false
  }

  if (/^[a-z]$/i.test(cleanLabel)) {
    currentLetter = cleanLabel.toLowerCase()
    letterIsHeader = !scraped.hasCheckbox
  }

  // Only show requirement 7 area
  if (scraped.parentNumber === '7' || cleanLabel === '7') {
    console.log(i + '.', 'label:', JSON.stringify(rawLabel),
      '| parent:', scraped.parentNumber,
      '| ctx: letter=' + currentLetter + ' isHeader=' + letterIsHeader)

    // Try matching
    if (rawLabel) {
      for (const csvId of requirementIds) {
        if (csvId.includes('7a') || csvId.includes('7b')) {
          const result = idsMatch(csvId, rawLabel, scraped.parentNumber, currentOption, currentLetter, letterIsHeader)
          if (result.matched) {
            console.log('  -> MATCHED', csvId, 'via', result.reason)
          }
        }
      }
    }
  }
}
