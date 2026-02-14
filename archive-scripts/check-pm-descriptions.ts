import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Check merit_badge_requirements (canonical table) for descriptions
  const { data: version } = await supabase
    .from('merit_badge_versions')
    .select('id')
    .eq('badge_name', 'Personal Management')
    .eq('version_year', 2019)
    .single()

  if (version) {
    const { data: reqs } = await supabase
      .from('merit_badge_requirements')
      .select('scoutbook_id, description, display_label')
      .eq('badge_version_id', version.id)
      .in('scoutbook_id', ['10a', '10b'])

    console.log('Canonical table (merit_badge_requirements):')
    reqs?.forEach(r => {
      console.log('  ' + r.scoutbook_id + ': ' + (r.description || '(no description)'))
    })
  }
}

check()
