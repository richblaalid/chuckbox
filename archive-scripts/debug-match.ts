import * as fs from 'fs'

function normalizeId(id: string): string {
  return id
    .replace(/[()[\]]/g, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseCSVId(csvId: string) {
  const id = csvId.trim()

  // Format: "2d[1]" - bracket only
  const match = id.match(/^(\d+)([a-z])\[(\d+)\]$/i)
  if (match) {
    return { mainNum: match[1], letter: match[2], subNum: match[3], subLetter: null, option: null, format: 'bracket_only' }
  }

  return { mainNum: null, letter: null, subNum: null, subLetter: null, option: null, format: 'unknown' }
}

function buildContextStack(requirements: any[], upToIndex: number) {
  let mainNum: string | null = null
  let letter: string | null = null
  let letterIsHeader = false

  for (let i = 0; i <= upToIndex; i++) {
    const req = requirements[i]
    const rawLabel = req.displayLabel || ''
    const label = rawLabel.replace(/[()[\].]/g, '').trim()
    const isWrapped = /^[(\[]/.test(rawLabel.trim())

    if (/^\d+$/.test(label) && parseInt(label) <= 20 && !isWrapped) {
      mainNum = label
      letter = null
      letterIsHeader = false
      continue
    }

    if (/^[a-z]$/i.test(label)) {
      letter = label.toLowerCase()
      letterIsHeader = !req.hasCheckbox
      continue
    }

    if (/^\d+$/.test(label) && parseInt(label) <= 10 && isWrapped) {
      continue
    }
  }

  return { mainNum, letter, letterIsHeader }
}

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Archery' && b.versionYear === 2016)

if (badge) {
  const csvId = '2d[1]'
  const parsed = parseCSVId(csvId)
  console.log('CSV ID:', csvId)
  console.log('Parsed:', parsed)
  console.log('')

  // Try to match at index 9 (where label is "(1)")
  const reqIndex = 9
  const req = badge.requirements[reqIndex]
  const context = buildContextStack(badge.requirements, reqIndex)
  const label = (req.displayLabel || '').replace(/[()[\].]/g, '').trim().toLowerCase()

  console.log('Requirement at index', reqIndex + ':')
  console.log('  rawLabel:', JSON.stringify(req.displayLabel))
  console.log('  label (cleaned):', label)
  console.log('  context:', context)
  console.log('')

  // Check matching conditions
  const hasMainNum = context.mainNum === parsed.mainNum
  const hasLetter = context.letter === parsed.letter
  const isSubNumUnderLetter = context.letterIsHeader && /^\d+$/.test(label) && parseInt(label) <= 10
  const labelMatches = label === parsed.subNum && hasMainNum && hasLetter && isSubNumUnderLetter

  console.log('Matching conditions:')
  console.log('  hasMainNum:', hasMainNum, `(${context.mainNum} === ${parsed.mainNum})`)
  console.log('  hasLetter:', hasLetter, `(${context.letter} === ${parsed.letter})`)
  console.log('  isSubNumUnderLetter:', isSubNumUnderLetter)
  console.log('  label === parsed.subNum:', label === parsed.subNum, `(${label} === ${parsed.subNum})`)
  console.log('  Final match:', labelMatches)
}
