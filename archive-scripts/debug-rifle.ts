import * as fs from 'fs'

const data = JSON.parse(fs.readFileSync('./data/merit-badge-requirements-scraped.json', 'utf8'))
const badge = data.badges.find((b: any) => b.badgeName === 'Rifle Shooting' && b.versionYear === 2017)
if (badge) {
  console.log('Rifle Shooting 2017 - looking for Opt headers:')
  badge.requirements.forEach((r: any, i: number) => {
    const desc = r.description || ''
    if (r.displayLabel === '2' || r.parentNumber === '2' || desc.toLowerCase().includes('opt')) {
      console.log(i + '.',
        'label:', JSON.stringify(r.displayLabel),
        '| parent:', r.parentNumber,
        '| checkbox:', r.hasCheckbox,
        '| desc:', desc.substring(0, 60)
      )
    }
  })
} else {
  console.log('Rifle Shooting 2017 not found')
  const versions = data.badges.filter((b: any) => b.badgeName === 'Rifle Shooting')
  console.log('Available versions:', versions.map((b: any) => b.versionYear))
}
