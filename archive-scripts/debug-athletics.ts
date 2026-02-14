import * as fs from 'fs'

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Athletics' && b.versionYear === 2026)
if (badge) {
  console.log('Athletics 2026 - looking for Option headers:')
  badge.requirements.forEach((r: any, i: number) => {
    const desc = r.description || ''
    if (r.displayLabel === '' || !r.displayLabel || desc.toLowerCase().includes('option')) {
      console.log(i + '.',
        'label:', JSON.stringify(r.displayLabel),
        '| checkbox:', r.hasCheckbox,
        '| desc:', desc.substring(0, 60)
      )
    }
  })
}
