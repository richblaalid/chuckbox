import * as fs from 'fs'

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Archery' && b.versionYear === 2016)
if (badge) {
  console.log('Archery 2016 - requirements around 2d:')
  badge.requirements.forEach((r: any, i: number) => {
    if (r.parentNumber === '2' || r.displayLabel === '2') {
      console.log(i + '.',
        'label:', JSON.stringify(r.displayLabel),
        '| parent:', r.parentNumber,
        '| checkbox:', r.hasCheckbox,
        '| desc:', (r.description || '').substring(0, 50)
      )
    }
  })
} else {
  console.log('Archery 2016 not found')
  const versions = data.badges.filter((b: any) => b.badgeName === 'Archery')
  console.log('Available Archery versions:', versions.map((b: any) => b.versionYear))
}
