import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function checkImportStatus() {
  console.log('=== Database Import Status Check ===\n')

  // Get total counts
  const { count: scoutCount } = await supabase
    .from('scouts')
    .select('*', { count: 'exact', head: true })

  const { count: rankProgressCount } = await supabase
    .from('scout_rank_progress')
    .select('*', { count: 'exact', head: true })

  const { count: rankReqCount } = await supabase
    .from('scout_rank_requirement_progress')
    .select('*', { count: 'exact', head: true })

  const { count: mbProgressCount } = await supabase
    .from('scout_merit_badge_progress')
    .select('*', { count: 'exact', head: true })

  const { count: mbReqCount } = await supabase
    .from('scout_merit_badge_requirement_progress')
    .select('*', { count: 'exact', head: true })

  console.log('Total Counts:')
  console.log(`  Scouts: ${scoutCount}`)
  console.log(`  Rank Progress: ${rankProgressCount}`)
  console.log(`  Rank Requirement Progress: ${rankReqCount}`)
  console.log(`  Merit Badge Progress: ${mbProgressCount}`)
  console.log(`  Merit Badge Requirement Progress: ${mbReqCount}`)

  // Get rank progress by status
  const { data: ranksByStatus } = await supabase
    .from('scout_rank_progress')
    .select('status')

  const rankStatusCounts: Record<string, number> = {}
  ranksByStatus?.forEach(r => {
    rankStatusCounts[r.status] = (rankStatusCounts[r.status] || 0) + 1
  })

  console.log('\nRank Progress by Status:')
  Object.entries(rankStatusCounts).sort().forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })

  // Get MB progress by status
  const { data: mbsByStatus } = await supabase
    .from('scout_merit_badge_progress')
    .select('status')

  const mbStatusCounts: Record<string, number> = {}
  mbsByStatus?.forEach(r => {
    mbStatusCounts[r.status] = (mbStatusCounts[r.status] || 0) + 1
  })

  console.log('\nMerit Badge Progress by Status:')
  Object.entries(mbStatusCounts).sort().forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })

  // Check for recent records (last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: recentRanks, count: recentRankCount } = await supabase
    .from('scout_rank_progress')
    .select('id, status, created_at, scouts(first_name, last_name), bsa_ranks(name)', { count: 'exact' })
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(10)

  console.log(`\nRecent Rank Progress (last hour): ${recentRankCount}`)
  recentRanks?.slice(0, 5).forEach(r => {
    const scout = r.scouts as { first_name: string; last_name: string } | null
    const rank = r.bsa_ranks as { name: string } | null
    console.log(`  - ${scout?.first_name} ${scout?.last_name}: ${rank?.name} (${r.status})`)
  })

  const { data: recentMbs, count: recentMbCount } = await supabase
    .from('scout_merit_badge_progress')
    .select('id, status, created_at, scouts(first_name, last_name), bsa_merit_badges(name)', { count: 'exact' })
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(10)

  console.log(`\nRecent Merit Badge Progress (last hour): ${recentMbCount}`)
  recentMbs?.slice(0, 5).forEach(r => {
    const scout = r.scouts as { first_name: string; last_name: string } | null
    const badge = r.bsa_merit_badges as { name: string } | null
    console.log(`  - ${scout?.first_name} ${scout?.last_name}: ${badge?.name} (${r.status})`)
  })

  // Check import mismatches table
  const { data: mismatches, count: mismatchCount } = await supabase
    .from('import_requirement_mismatches')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(20)

  console.log(`\nImport Requirement Mismatches: ${mismatchCount}`)
  if (mismatches && mismatches.length > 0) {
    // Group by error reason
    const byReason: Record<string, number> = {}
    mismatches.forEach(m => {
      const reason = m.error_reason || 'unknown'
      byReason[reason] = (byReason[reason] || 0) + 1
    })
    console.log('By reason:')
    Object.entries(byReason).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`)
    })
  }

  // Check for any badges with 0 requirement progress but in_progress status
  const { data: suspiciousBadges } = await supabase
    .from('scout_merit_badge_progress')
    .select(`
      id,
      status,
      scouts(first_name, last_name),
      bsa_merit_badges(name),
      scout_merit_badge_requirement_progress(count)
    `)
    .eq('status', 'in_progress')
    .limit(100)

  const badgesWithNoReqs = suspiciousBadges?.filter(b => {
    const reqs = b.scout_merit_badge_requirement_progress as unknown as { count: number }[]
    return !reqs || reqs.length === 0 || (reqs[0] && reqs[0].count === 0)
  })

  if (badgesWithNoReqs && badgesWithNoReqs.length > 0) {
    console.log(`\n⚠️  In-progress badges with no requirement records: ${badgesWithNoReqs.length}`)
    badgesWithNoReqs.slice(0, 5).forEach(b => {
      const scout = b.scouts as { first_name: string; last_name: string } | null
      const badge = b.bsa_merit_badges as { name: string } | null
      console.log(`  - ${scout?.first_name} ${scout?.last_name}: ${badge?.name}`)
    })
  } else {
    console.log('\n✅ All in-progress badges have requirement records')
  }

  console.log('\n=== Check Complete ===')
}

checkImportStatus().catch(console.error)
