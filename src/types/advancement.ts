/**
 * Advancement Tracking Types
 *
 * Types for the scout advancement tracking UI components
 */

// ==========================================
// STATUS TYPES
// ==========================================

export type AdvancementStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'pending_approval'
  | 'approved'
  | 'awarded'

export type ApprovalStatus =
  | 'pending_approval'
  | 'approved'
  | 'denied'

// ==========================================
// BSA REFERENCE DATA TYPES
// ==========================================

export interface BsaRank {
  id: string
  code: string
  name: string
  display_order: number
  description: string | null
  image_url: string | null
  is_eagle_required: boolean | null
  requirement_version_year?: number | null
}

export interface BsaRankRequirement {
  id: string
  version_year: number | null
  rank_id: string
  requirement_number: string
  parent_requirement_id: string | null
  sub_requirement_letter: string | null
  description: string
  is_alternative: boolean | null
  alternatives_group: string | null
  display_order: number
}

export interface BsaMeritBadge {
  id: string
  code: string | null
  name: string
  is_eagle_required: boolean | null
  is_active: boolean | null
  category: string | null
  description: string | null
  image_url: string | null
  pamphlet_url: string | null
  requirement_version_year?: number | null
}

export interface BsaMeritBadgeRequirement {
  id: string
  version_year: number | null
  merit_badge_id: string
  requirement_number: string
  parent_requirement_id: string | null
  sub_requirement_letter: string | null
  description: string
  display_order: number
  // Alternative/OR options support
  is_alternative: boolean | null
  alternatives_group: string | null
  nesting_depth: number | null
  required_count: number | null
  // Header support - headers are description-only, not approvable
  is_header: boolean | null
}

export interface BsaLeadershipPosition {
  id: string
  code: string | null
  name: string
  qualifies_for_star: boolean | null
  qualifies_for_life: boolean | null
  qualifies_for_eagle: boolean | null
  min_tenure_months: number | null
}

// ==========================================
// SCOUT PROGRESS TYPES
// ==========================================

export interface RankRequirementProgress {
  id: string
  scout_rank_progress_id: string
  requirement_id: string
  status: AdvancementStatus
  completed_at: string | null
  completed_by: string | null
  notes: string | null
  submitted_by: string | null
  submitted_at: string | null
  submission_notes: string | null
  approval_status: ApprovalStatus | null
  denial_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  bsa_rank_requirements: BsaRankRequirement
}

export interface RankProgress {
  id: string
  scout_id: string
  rank_id: string
  status: AdvancementStatus
  started_at: string | null
  completed_at: string | null
  approved_at: string | null
  approved_by: string | null
  awarded_at: string | null
  awarded_by: string | null
  bsa_ranks: BsaRank
  scout_rank_requirement_progress: RankRequirementProgress[]
}

export interface MeritBadgeRequirementProgress {
  id: string
  scout_merit_badge_progress_id: string
  requirement_id: string
  status: AdvancementStatus
  completed_at: string | null
  completed_by: string | null
  notes: string | null
  bsa_merit_badge_requirements?: BsaMeritBadgeRequirement
}

export interface MeritBadgeProgress {
  id: string
  scout_id: string
  merit_badge_id: string
  status: AdvancementStatus
  started_at: string | null
  completed_at: string | null
  awarded_at: string | null
  counselor_name: string | null
  counselor_profile_id: string | null
  counselor_signed_at: string | null
  approved_by: string | null
  bsa_merit_badges: BsaMeritBadge
  scout_merit_badge_requirement_progress: MeritBadgeRequirementProgress[]
}

export interface LeadershipHistory {
  id: string
  scout_id: string
  position_id: string
  unit_id: string
  start_date: string
  end_date: string | null
  notes: string | null
  bsa_leadership_positions: BsaLeadershipPosition
}

export interface ActivityEntry {
  id: string
  scout_id: string
  activity_type: 'camping' | 'hiking' | 'service' | 'conservation'
  activity_date: string
  value: number
  description: string | null
  location: string | null
  event_id: string | null
  verified_by: string | null
  verified_at: string | null
}

export interface ActivityTotals {
  camping: number
  hiking: number
  service: number
  conservation: number
}

// ==========================================
// COMPONENT PROP TYPES
// ==========================================

export interface ScoutAdvancementData {
  rankProgress: RankProgress[]
  meritBadgeProgress: MeritBadgeProgress[]
  leadershipHistory: LeadershipHistory[]
  activityEntries: ActivityEntry[]
  activityTotals: ActivityTotals
}

export interface BulkApprovalItem {
  id: string
  requirementNumber: string
  description: string
  status: AdvancementStatus
}

export interface WhatsNextItem {
  requirementProgressId: string
  requirementNumber: string
  description: string
  rankName: string
  rankId: string
}

// ==========================================
// PENDING SIGNOFF TYPES (Dashboard)
// ==========================================

export type PendingSignoffType = 'rank' | 'merit_badge'

export interface PendingSignoff {
  id: string
  type: PendingSignoffType
  scoutId: string
  scoutName: string
  requirementNumber: string
  requirementDescription: string
  /** For ranks: rank name. For badges: merit badge name. */
  advancementName: string
  submittedAt: string
  submittedByName: string
  submissionNotes: string | null
  /** Relative time display, e.g., "5 days ago" */
  submittedAgo: string
}

// ==========================================
// CSV IMPORT TYPES
// ==========================================

export interface ScoutbookRankImportRow {
  bsa_member_id: string
  scout_name: string
  rank: string
  requirement: string
  date_completed: string
  leader_signature?: string
}

export interface ScoutbookMeritBadgeImportRow {
  bsa_member_id: string
  scout_name: string
  merit_badge: string
  requirement: string
  date_completed: string
  counselor_name?: string
}

export interface ImportPreviewData {
  valid: boolean
  totalRows: number
  validRows: number
  errors: string[]
  preview: Array<{
    scoutName: string
    bsaMemberId: string
    type: 'rank' | 'merit_badge'
    name: string
    requirement: string
    dateCompleted: string
    matchedScoutId?: string
    warning?: string
  }>
}

export interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  errors: string[]
}

// ==========================================
// EAGLE PROGRESS TYPES
// ==========================================

export const EAGLE_REQUIRED_BADGE_COUNT = 14

export interface EagleProgress {
  earnedCount: number
  totalRequired: typeof EAGLE_REQUIRED_BADGE_COUNT
  earnedBadges: MeritBadgeProgress[]
  inProgressBadges: MeritBadgeProgress[]
  remainingBadgeIds: string[]
}

// ==========================================
// UI STATE TYPES
// ==========================================

export type AdvancementTabValue = 'rank' | 'badges' | 'leadership' | 'activities'

export interface RequirementSelectionState {
  selectedIds: Set<string>
  selectAll: boolean
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

export function isRequirementComplete(status: AdvancementStatus): boolean {
  return ['completed', 'approved', 'awarded'].includes(status)
}

export function canApproveRequirement(status: AdvancementStatus): boolean {
  return ['not_started', 'in_progress'].includes(status)
}

export function getStatusColor(status: AdvancementStatus): string {
  const colors: Record<AdvancementStatus, string> = {
    not_started: 'bg-stone-100 text-stone-600',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-amber-100 text-amber-700',
    pending_approval: 'bg-orange-100 text-orange-700',
    approved: 'bg-emerald-100 text-emerald-700',
    awarded: 'bg-forest-100 text-forest-700',
  }
  return colors[status] || colors.not_started
}

export function getStatusLabel(status: AdvancementStatus): string {
  const labels: Record<AdvancementStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
    pending_approval: 'Pending',
    approved: 'Approved',
    awarded: 'Awarded',
  }
  return labels[status] || 'Unknown'
}

/**
 * Calculate progress percentage for a rank or merit badge
 */
export function calculateProgressPercent(
  requirements: Array<{ status: AdvancementStatus }>
): number {
  if (requirements.length === 0) return 0
  const completed = requirements.filter(r => isRequirementComplete(r.status)).length
  return Math.round((completed / requirements.length) * 100)
}

/**
 * Get the next incomplete requirements for "What's Next" display
 */
export function getNextRequirements(
  rankProgress: RankProgress[],
  limit: number = 5
): WhatsNextItem[] {
  const items: WhatsNextItem[] = []

  // Find the current in-progress rank
  const currentRank = rankProgress.find(r => r.status === 'in_progress')
  if (!currentRank) return items

  // Get incomplete requirements
  for (const req of currentRank.scout_rank_requirement_progress) {
    if (!isRequirementComplete(req.status) && items.length < limit) {
      items.push({
        requirementProgressId: req.id,
        requirementNumber: req.bsa_rank_requirements.requirement_number,
        description: req.bsa_rank_requirements.description,
        rankName: currentRank.bsa_ranks.name,
        rankId: currentRank.bsa_ranks.id,
      })
    }
  }

  return items
}

/**
 * Calculate Eagle progress from merit badge data
 */
export function calculateEagleProgress(
  meritBadgeProgress: MeritBadgeProgress[]
): EagleProgress {
  const eagleRequired = meritBadgeProgress.filter(
    mb => mb.bsa_merit_badges.is_eagle_required
  )

  const earned = eagleRequired.filter(mb => mb.status === 'awarded')
  const inProgress = eagleRequired.filter(mb =>
    mb.status === 'in_progress' || mb.status === 'completed'
  )

  // Get IDs of badges not yet started
  const earnedIds = new Set(earned.map(mb => mb.merit_badge_id))
  const inProgressIds = new Set(inProgress.map(mb => mb.merit_badge_id))
  const remainingBadgeIds = eagleRequired
    .filter(mb => !earnedIds.has(mb.merit_badge_id) && !inProgressIds.has(mb.merit_badge_id))
    .map(mb => mb.merit_badge_id)

  return {
    earnedCount: earned.length,
    totalRequired: EAGLE_REQUIRED_BADGE_COUNT,
    earnedBadges: earned,
    inProgressBadges: inProgress,
    remainingBadgeIds,
  }
}
