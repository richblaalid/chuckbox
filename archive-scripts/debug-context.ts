import * as fs from 'fs'

function buildContextStack(requirements: any[], upToIndex: number) {
  let mainNum: string | null = null
  let letter: string | null = null
  let letterIsHeader = false

  for (let i = 0; i <= upToIndex; i++) {
    const req = requirements[i]
    const rawLabel = req.displayLabel || ''
    const label = rawLabel.replace(/[()[\].]/g, '').trim()
    const isWrapped = /^[(\[]/.test(rawLabel.trim())

    // Main requirement number - only if NOT wrapped
    if (/^\d+$/.test(label) && parseInt(label) <= 20 && !isWrapped) {
      mainNum = label
      letter = null
      letterIsHeader = false
      continue
    }

    // Letter label (a, b, c)
    if (/^[a-z]$/i.test(label)) {
      letter = label.toLowerCase()
      letterIsHeader = !req.hasCheckbox
      continue
    }

    // Wrapped numbers like (1) - keep context
    if (/^\d+$/.test(label) && parseInt(label) <= 10 && isWrapped) {
      continue
    }
  }

  return { mainNum, letter, letterIsHeader }
}

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Archery' && b.versionYear === 2016)

if (badge) {
  console.log('Archery 2016 - context analysis for requirement 2d area:')
  for (let i = 4; i <= 11; i++) {
    const r = badge.requirements[i]
    const context = buildContextStack(badge.requirements, i)
    const rawLabel = r.displayLabel || ''
    const label = rawLabel.replace(/[()[\].]/g, '').trim()
    console.log(i + '.',
      'rawLabel:', JSON.stringify(r.displayLabel),
      '| label:', label,
      '| checkbox:', r.hasCheckbox,
      '| context:', JSON.stringify(context)
    )
  }
}
