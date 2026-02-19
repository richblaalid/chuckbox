export interface ScoutGuardian {
  profile_id: string
  full_name: string | null
  email: string | null
  venmo_username: string | null
}

export interface ScoutWithGuardians {
  id: string
  first_name: string
  last_name: string
  guardians: ScoutGuardian[]
}

export interface CostShare {
  participantId: string
  participantName: string
  participantEmail: string | null
  participantVenmo: string | null
  scoutCount: number
  shareAmount: number
}

export interface CostShareResult {
  totalScouts: number
  perScoutAmount: number
  organizerScoutCount: number
  organizerAmount: number
  shares: CostShare[]
}

interface CalculateCostSharesParams {
  totalAmount: number
  selectedScoutIds: string[]
  scouts: ScoutWithGuardians[]
  organizerProfileId: string
}

/** Round to nearest cent */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

const EMPTY_RESULT: CostShareResult = {
  totalScouts: 0,
  perScoutAmount: 0,
  organizerScoutCount: 0,
  organizerAmount: 0,
  shares: [],
}

export function calculateCostShares(
  params: CalculateCostSharesParams
): CostShareResult {
  const { totalAmount, selectedScoutIds, scouts, organizerProfileId } = params
  const selectedSet = new Set(selectedScoutIds)
  const selectedScouts = scouts.filter((s) => selectedSet.has(s.id))
  const totalScouts = selectedScouts.length

  if (totalScouts === 0) {
    return EMPTY_RESULT
  }

  const perScoutAmount = roundCents(totalAmount / totalScouts)

  // Group scouts by primary guardian (first in list), separating the organizer's scouts
  const guardianMap = new Map<
    string,
    { guardian: ScoutGuardian; scoutCount: number }
  >()
  let organizerScoutCount = 0

  for (const scout of selectedScouts) {
    const guardian = scout.guardians[0]
    if (!guardian) continue

    if (guardian.profile_id === organizerProfileId) {
      organizerScoutCount++
      continue
    }

    const existing = guardianMap.get(guardian.profile_id)
    if (existing) {
      existing.scoutCount++
    } else {
      guardianMap.set(guardian.profile_id, { guardian, scoutCount: 1 })
    }
  }

  const shares: CostShare[] = Array.from(guardianMap.values()).map(
    ({ guardian, scoutCount }) => ({
      participantId: guardian.profile_id,
      participantName: guardian.full_name || 'Unknown',
      participantEmail: guardian.email,
      participantVenmo: guardian.venmo_username,
      scoutCount,
      shareAmount: roundCents(scoutCount * perScoutAmount),
    })
  )

  return {
    totalScouts,
    perScoutAmount,
    organizerScoutCount,
    organizerAmount: roundCents(organizerScoutCount * perScoutAmount),
    shares,
  }
}
