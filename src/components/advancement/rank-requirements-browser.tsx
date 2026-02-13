'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UnitRankPanel } from './unit-rank-panel'
import { RankTrailVisualization } from './rank-trail-visualization'
import { Award } from 'lucide-react'

interface Rank {
  id: string
  code: string
  name: string
  display_order: number
  is_eagle_required: boolean | null
  description: string | null
  image_url?: string | null
}

interface Requirement {
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
  is_header: boolean | null
}

interface RequirementProgress {
  id: string
  requirement_id: string
  status: string
}

interface RankProgress {
  id: string
  rank_id: string
  status: string
  scout_rank_requirement_progress: RequirementProgress[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  rank: string | null
  is_active: boolean | null
  scout_rank_progress: RankProgress[]
}

interface RankRequirementsBrowserProps {
  ranks: Rank[]
  requirements: Requirement[]
  scouts: Scout[]
  unitId: string
  canEdit: boolean
  currentUserName?: string
}

export function RankRequirementsBrowser({
  ranks,
  requirements,
  scouts,
  unitId,
  canEdit,
  currentUserName = 'Leader',
}: RankRequirementsBrowserProps) {
  const [selectedRank, setSelectedRank] = useState(ranks[0]?.code || 'scout')

  const currentRank = ranks.find((r) => r.code === selectedRank)

  // Get scouts working on this rank
  const scoutsWorkingOnRank = scouts.filter((scout) =>
    scout.scout_rank_progress.some(
      (progress) => progress.rank_id === currentRank?.id && progress.status === 'in_progress'
    )
  )

  // Get requirements for the selected rank
  const currentRequirements = requirements.filter((req) => req.rank_id === currentRank?.id)

  return (
    <div className="space-y-4">
      {/* Trail to Eagle rank selector */}
      <RankTrailVisualization
        rankProgress={[]}
        currentRank={null}
        selectedRank={selectedRank}
        onRankClick={setSelectedRank}
        selectorMode
        compact
      />

      {/* Requirements panel for selected rank */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-forest-600" />
                {currentRank?.name || 'Rank'} Requirements
              </CardTitle>
              <CardDescription>
                Select requirements and sign off for multiple scouts
              </CardDescription>
            </div>
            {scoutsWorkingOnRank.length > 0 && (
              <Badge variant="secondary">
                {scoutsWorkingOnRank.length} scout{scoutsWorkingOnRank.length !== 1 ? 's' : ''} working on {currentRank?.name}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {currentRank && (
            <UnitRankPanel
              rank={currentRank}
              requirements={currentRequirements}
              scouts={scouts}
              unitId={unitId}
              canEdit={canEdit}
              currentUserName={currentUserName}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
