/**
 * Analyze Archery badge structure to understand proper hierarchy
 */

import * as fs from 'fs'
import * as path from 'path'

const dataDir = path.join(process.cwd(), 'data')
const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'bsa-data-canonical.json'), 'utf8'))

const archery = data.merit_badges.find((b: any) => b.name === 'Archery')
const v2019 = archery.versions.find((v: any) => v.version_year === 2019)

function flatten(reqs: any[]): any[] {
  let result: any[] = []
  for (const r of reqs) {
    result.push(r)
    if (r.children?.length) result.push(...flatten(r.children))
  }
  return result
}

const allReqs = flatten(v2019.requirements)
const req5Area = allReqs.filter((r: any) => r.scoutbook_id.startsWith('5'))

// Group by Option A vs Option B
const optA = req5Area.filter((r: any) =>
  r.scoutbook_id.includes('Opt A') || r.scoutbook_id.includes('5A')
)
const optB = req5Area.filter((r: any) =>
  r.scoutbook_id.includes('Opt B') || r.scoutbook_id.includes('5B')
)
const shared = req5Area.filter((r: any) =>
  !r.scoutbook_id.includes('Opt') &&
  !r.scoutbook_id.includes('5A') &&
  !r.scoutbook_id.includes('5B')
)

console.log('=== Archery v2019 Requirement 5 - Grouped by Option ===')
console.log('')
console.log('--- SHARED (header only) ---')
for (const r of shared) {
  const marker = r.is_header ? '[H]' : '   '
  console.log(`${marker} ${r.scoutbook_id}`)
}

console.log('')
console.log('--- OPTION A (Recurve/Longbow) ---')
for (const r of optA.sort((a: any, b: any) => a.scoutbook_id.localeCompare(b.scoutbook_id))) {
  const marker = r.is_header ? '[H]' : '   '
  console.log(`${marker} ${r.scoutbook_id}`)
}

console.log('')
console.log('--- OPTION B (Compound Bow) ---')
for (const r of optB.sort((a: any, b: any) => a.scoutbook_id.localeCompare(b.scoutbook_id))) {
  const marker = r.is_header ? '[H]' : '   '
  console.log(`${marker} ${r.scoutbook_id}`)
}

console.log('')
console.log('=== PROPOSED HIERARCHY ===')
console.log('')
console.log('5 (header) - "Do ONE of the following options"')
console.log('├── Option A (Recurve/Longbow)')
console.log('│   ├── 5a Opt A')
console.log('│   ├── 5b Opt A')
console.log('│   ├── 5c Opt A')
console.log('│   ├── 5d Opt A')
console.log('│   ├── 5A(e) or 5e Opt A')
console.log('│   └── 5A(f) (header)')
console.log('│       ├── 5f[1]a Opt A ... 5f[1]e Opt A')
console.log('│       ├── 5f[2] Opt A')
console.log('│       ├── 5f[3] Opt A')
console.log('│       └── 5f[4] Opt A')
console.log('└── Option B (Compound Bow)')
console.log('    ├── 5a Opt B ... 5e Opt B')
console.log('    └── 5B(f) (header)')
console.log('        └── 5f[*] Opt B variants')
