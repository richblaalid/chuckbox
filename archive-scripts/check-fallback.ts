import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Get Camping badge
  const { data: camping } = await supabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')
    .eq('code', 'camping')
    .single()

  console.log('Camping badge:', camping)

  // Check if there are current versions in bsa_merit_badge_versions
  const { data: currentVersion } = await supabase
    .from('bsa_merit_badge_versions')
    .select('version_year, is_current')
    .eq('merit_badge_id', camping?.id)
    .eq('is_current', true)
    .maybeSingle()

  console.log('Current version from bsa_merit_badge_versions:', currentVersion)

  // What requirements exist for Camping?
  const { data: reqVersions } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('version_year')
    .eq('merit_badge_id', camping?.id)

  const uniqueVersions = [...new Set(reqVersions?.map(v => v.version_year))]
  console.log('Camping requirement versions:', uniqueVersions.sort())

  // Try to load requirements with the fallback version
  const fallbackYear = camping?.requirement_version_year
  console.log('Fallback version year from badge:', fallbackYear)

  const { data: reqs, count } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id', { count: 'exact' })
    .eq('merit_badge_id', camping?.id)
    .eq('version_year', fallbackYear)

  console.log('Requirements count for fallback version:', count)
}

check()
