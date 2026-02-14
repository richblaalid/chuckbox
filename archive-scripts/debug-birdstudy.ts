import * as fs from 'fs'

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Bird Study' && b.versionYear === 2013)

function normalizeId(id: string): string {
  return id.replace(/[()[\]]/g, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

if (badge) {
  console.log('Bird Study 2013 - requirements around 7:')

  let currentLetter: string | null = null
  let letterIsHeader = false
  let mainNum: string | null = null

  for (let i = 0; i < badge.requirements.length; i++) {
    const r = badge.requirements[i]
    const rawLabel = r.displayLabel || ''
    const cleanLabel = rawLabel.replace(/[()[\].]/g, '').trim()
    const isWrapped = /^[(\[]/.test(rawLabel.trim())

    // Track context
    if (/^\d+$/.test(cleanLabel) && parseInt(cleanLabel) <= 20 && !isWrapped) {
      mainNum = cleanLabel
      currentLetter = null
      letterIsHeader = false
    }

    if (/^[a-z]$/i.test(cleanLabel)) {
      currentLetter = cleanLabel.toLowerCase()
      letterIsHeader = !r.hasCheckbox
    }

    // Only show requirement 7 area
    if (mainNum === '7' || (mainNum === '6' && parseInt(cleanLabel) <= 20)) {
      console.log(i + '.',
        'label:', JSON.stringify(r.displayLabel),
        '| parent:', r.parentNumber,
        '| checkbox:', r.hasCheckbox,
        '| context: mainNum=' + mainNum + ' letter=' + currentLetter + ' letterIsHeader=' + letterIsHeader
      )

      // Try to match "7a[1]" and "7a[2]"
      if (cleanLabel === '1' || cleanLabel === '2') {
        const csvIds = ['7a[1]', '7a[2]', '7b[1]', '7b[2]']
        for (const csvId of csvIds) {
          const normCsv = normalizeId(csvId)
          const normUi = cleanLabel

          // Try bracket format match
          if (letterIsHeader && currentLetter && mainNum && /^\d+$/.test(normUi)) {
            const bracketId = `${mainNum}${currentLetter}[${normUi}]`.toLowerCase()
            if (normCsv === bracketId) {
              console.log('  -> MATCH for', csvId)
            }
          }
        }
      }
    }
  }
} else {
  console.log('Bird Study 2013 not found')
}
