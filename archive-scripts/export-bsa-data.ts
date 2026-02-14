import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

// Detect --prod flag for environment switching
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

// Display which environment we're using
const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function exportData() {
  console.log('Exporting from DEV:', process.env.NEXT_PUBLIC_SUPABASE_URL)
  
  // Export requirements with all fields
  const { data: reqs, error } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*')
    .order('id')
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  console.log('Exported', reqs?.length, 'requirements')
  fs.writeFileSync('data/dev-mb-requirements-export.json', JSON.stringify(reqs, null, 2))
  
  // Also export versions
  const { data: versions } = await supabase
    .from('bsa_merit_badge_versions')
    .select('*')
  
  console.log('Exported', versions?.length, 'versions')
  fs.writeFileSync('data/dev-mb-versions-export.json', JSON.stringify(versions, null, 2))
  
  console.log('Done! Files saved to data/')
}

exportData()
