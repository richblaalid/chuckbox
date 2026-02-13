'use client'

import { useState, useMemo, useTransition } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RankIcon } from './rank-icon'
import { ScoutSelectionDialog } from './scout-selection-dialog'
import { MultiSelectActionBar } from './multi-select-action-bar'
import { cn } from '@/lib/utils'
import { Award, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { VersionYearBadge } from '@/components/ui/version-year-badge'
import { bulkSignOffForScouts } from '@/app/actions/advancement'
import { useRouter } from 'next/navigation'

interface Rank {
  id: string
  code: string
  name: string
  display_order: number
  is_eagle_required: boolean | null
  description: string | null
  image_url?: string | null
  requirement_version_year?: number | null
}

interface Requirement {
  id: string
  requirement_number: string
  description: string
  parent_requirement_id: string | null
  is_alternative: boolean | null
  alternatives_group: string | null
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
  is_active: boolean | null
  scout_rank_progress: RankProgress[]
}

interface UnitRankPanelProps {
  rank: Rank
  requirements: Requirement[]
  scouts: Scout[]
  unitId: string
  canEdit: boolean
  currentUserName?: string
  /** Callback to notify parent that data has changed (for cache invalidation) */
  onDataChange?: () => void
}

// Requirement node for tree structure
interface RequirementNode {
  requirement: Requirement
  children: RequirementNode[]
}

// Helper to compare alphanumeric requirement numbers (e.g., "2a" < "2b" < "3" < "10a")
function compareRequirementNumbers(a: string, b: string): number {
  const parseReq = (s: string) => {
    const match = s.match(/^(\d+)([a-z]*)$/i)
    if (!match) return { num: 0, suffix: s }
    return { num: parseInt(match[1], 10), suffix: match[2].toLowerCase() }
  }
  const parsedA = parseReq(a)
  const parsedB = parseReq(b)
  if (parsedA.num !== parsedB.num) return parsedA.num - parsedB.num
  return parsedA.suffix.localeCompare(parsedB.suffix)
}

/**
 * Extract just the last part of a requirement number for display in nested views.
 * The full hierarchy is visible from the tree structure, so we only need to show
 * the leaf identifier.
 */
function getDisplayLabel(reqNum: string, hasParent: boolean): string {
  if (!hasParent) {
    return reqNum
  }

  // Check for parenthetical suffix like (a), (b), (1), (2)
  const parenMatch = reqNum.match(/\(([^)]+)\)$/)
  if (parenMatch) {
    return parenMatch[1]
  }

  // Check for "Option X" pattern
  const optionMatch = reqNum.match(/Option\s+([A-Z])(?:\s|$)/i)
  if (optionMatch) {
    if (reqNum.match(/^\d+\s+Option\s+[A-Z]$/i)) {
      return `Option ${optionMatch[1]}`
    }
  }

  // Check for simple letter suffix like "1a", "2b"
  const simpleMatch = reqNum.match(/\d+([a-z])$/i)
  if (simpleMatch) {
    return simpleMatch[1].toLowerCase()
  }

  return reqNum
}

// Build a hierarchical tree from flat requirements
function buildRequirementTree(requirements: Requirement[]): RequirementNode[] {
  const nodeMap = new Map<string, RequirementNode>()
  const rootNodes: RequirementNode[] = []

  // First pass: create all nodes
  requirements.forEach(req => {
    nodeMap.set(req.id, { requirement: req, children: [] })
  })

  // Second pass: build tree structure
  requirements.forEach(req => {
    const node = nodeMap.get(req.id)!
    if (req.parent_requirement_id && nodeMap.has(req.parent_requirement_id)) {
      nodeMap.get(req.parent_requirement_id)!.children.push(node)
    } else {
      rootNodes.push(node)
    }
  })

  // Sort children by requirement number
  function sortChildren(nodes: RequirementNode[]) {
    nodes.sort((a, b) => {
      const numA = a.requirement.requirement_number || '0'
      const numB = b.requirement.requirement_number || '0'
      return compareRequirementNumbers(numA, numB)
    })
    nodes.forEach(node => sortChildren(node.children))
  }
  sortChildren(rootNodes)

  return rootNodes
}

// Recursive component for rendering requirement nodes
function RequirementNodeView({
  node,
  depth,
  isMultiSelectMode,
  selectedIds,
  onSelectionChange,
  collapsedNodes,
  toggleNode,
}: {
  node: RequirementNode
  depth: number
  isMultiSelectMode: boolean
  selectedIds: Set<string>
  onSelectionChange: (id: string) => void
  collapsedNodes: Set<string>
  toggleNode: (id: string) => void
}) {
  const req = node.requirement
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsedNodes.has(req.id)
  const isSelected = selectedIds.has(req.id)
  const hasParent = !!req.parent_requirement_id
  const displayLabel = getDisplayLabel(req.requirement_number, hasParent)

  // Check if children are alternatives
  const hasAlternativeChildren = node.children.some(c => c.requirement.is_alternative)

  // Check if this is a header (not completable/selectable)
  const isHeader = req.is_header === true

  // For leaf nodes (no children) that are NOT headers, render just the requirement row
  // White background with pine green border, campfire orange badge
  // Headers without children should be handled as containers below (though unusual)
  if (!hasChildren && !isHeader) {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border p-2.5 transition-colors',
          isMultiSelectMode && 'cursor-pointer',
          isSelected
            ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
            : 'border-forest-800 bg-white hover:bg-stone-50'
        )}
        onClick={() => isMultiSelectMode && onSelectionChange(req.id)}
      >
        {isMultiSelectMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectionChange(req.id)}
            className="mt-0.5"
          />
        )}
        <div className="flex-1">
          <div className="flex items-start gap-2">
            {/* Amber badge for completable items */}
            <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded px-1 text-xs font-bold bg-amber-600 text-white">
              {displayLabel}
            </span>
            <p className="text-sm text-stone-700">
              {req.description}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // For nodes with children, render collapsible section
  // Subtle pine green tinted background, pine green borders
  // Background opacity decreases with depth: 12% -> 8% -> 5% -> 3%
  const headerBgOpacity = depth === 0 ? '[0.12]' : depth === 1 ? '[0.08]' : depth === 2 ? '[0.05]' : '[0.03]'

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      depth === 0 ? 'border-2' : 'border',
      'border-forest-800',
      `bg-forest-800/${headerBgOpacity}`
    )}>
      {/* Collapsible Header */}
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
          'hover:bg-stone-100/50',
          isCollapsed ? 'rounded-lg' : 'rounded-t-lg',
          isMultiSelectMode && !isHeader && 'cursor-pointer'
        )}
        onClick={() => {
          // Headers only toggle collapse, never select
          if (isHeader) {
            toggleNode(req.id)
          } else if (isMultiSelectMode) {
            onSelectionChange(req.id)
          } else {
            toggleNode(req.id)
          }
        }}
      >
        {/* Headers always show expand/collapse icon, never checkbox */}
        {/* Non-headers in multi-select show checkbox */}
        {isHeader ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleNode(req.id)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-500 hover:text-stone-700"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : isMultiSelectMode ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectionChange(req.id)}
            className="shrink-0"
          />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleNode(req.id)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-500 hover:text-stone-700"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Requirement Number Badge - Pine green for containers */}
        <span className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded bg-forest-800 px-1.5 text-xs font-bold text-white">
          {displayLabel}
        </span>

        {/* Title/Description */}
        <span className="flex-1 font-medium text-forest-800 line-clamp-1">
          {req.description.length > 80
            ? req.description.slice(0, 80) + '...'
            : req.description}
        </span>

        {/* Alternatives indicator */}
        {hasAlternativeChildren && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
            Options
          </span>
        )}
      </div>

      {/* Expanded Content */}
      {!isCollapsed && (
        <div className="border-t border-forest-800/20 px-2 pb-2 pt-1">
          <div className="space-y-1">
            {node.children.map((child) => (
              <div
                key={child.requirement.id}
                className={cn(
                  'ml-2 border-l-2 pl-2',
                  child.requirement.is_alternative
                    ? 'border-amber-200'
                    : 'border-forest-800'
                )}
              >
                <RequirementNodeView
                  node={child}
                  depth={depth + 1}
                  isMultiSelectMode={isMultiSelectMode}
                  selectedIds={selectedIds}
                  onSelectionChange={onSelectionChange}
                  collapsedNodes={collapsedNodes}
                  toggleNode={toggleNode}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * UnitRankPanel - Unit-wide view for signing off rank requirements across multiple scouts.
 * Used in the /advancement page to allow leaders to sign off requirements for selected scouts.
 */
export function UnitRankPanel({
  rank,
  requirements,
  scouts,
  unitId,
  canEdit,
  currentUserName = 'Leader',
  onDataChange,
}: UnitRankPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Multi-select state (always enabled for better UX)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [scoutSelectionOpen, setScoutSelectionOpen] = useState(false)

  // Build hierarchical tree from requirements
  const requirementTree = useMemo(() => {
    return buildRequirementTree(requirements)
  }, [requirements])

  // Track which parent nodes are collapsed
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  const toggleNode = (id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Collect all requirement IDs from a node and its children (for select all)
  const collectAllIds = (node: RequirementNode): string[] => {
    const ids = [node.requirement.id]
    node.children.forEach(child => {
      ids.push(...collectAllIds(child))
    })
    return ids
  }

  // Build maps for scout completion status
  const { scoutsWithAllComplete, scoutCompletedRequirements } = useMemo(() => {
    const completedMap = new Map<string, Set<string>>()
    const allCompleteSet = new Set<string>()
    // Convert Set to Array once, outside the loop (O(n) instead of O(n²))
    const selectedReqArray = Array.from(selectedIds)

    scouts.forEach(scout => {
      const progress = scout.scout_rank_progress.find(
        p => p.rank_id === rank.id
      )
      const completedReqs = new Set<string>()

      if (progress) {
        progress.scout_rank_requirement_progress.forEach(rp => {
          if (['completed', 'approved', 'awarded'].includes(rp.status)) {
            completedReqs.add(rp.requirement_id)
          }
        })
      }

      completedMap.set(scout.id, completedReqs)

      // Check if this scout has ALL selected requirements completed
      if (selectedReqArray.length > 0) {
        const hasAll = selectedReqArray.every(reqId => completedReqs.has(reqId))
        if (hasAll) {
          allCompleteSet.add(scout.id)
        }
      }
    })

    return {
      scoutsWithAllComplete: allCompleteSet,
      scoutCompletedRequirements: completedMap,
    }
  }, [scouts, rank.id, selectedIds])

  // Selection handlers
  const handleSelectionChange = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    // Select all requirements (including sub-requirements)
    const allIds = new Set<string>()
    requirementTree.forEach(node => {
      collectAllIds(node).forEach(id => allIds.add(id))
    })
    setSelectedIds(allIds)
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleSignOff = () => {
    setScoutSelectionOpen(true)
  }

  const handleConfirmSignOff = async (scoutIds: string[], date: string) => {
    startTransition(async () => {
      const result = await bulkSignOffForScouts({
        type: 'rank',
        requirementIds: Array.from(selectedIds),
        scoutIds,
        unitId,
        itemId: rank.id,
        date,
        completedBy: currentUserName,
      })

      if (result.success) {
        setScoutSelectionOpen(false)
        setSelectedIds(new Set())
        // Notify parent to invalidate cached data before refresh
        onDataChange?.()
        router.refresh()
      }
    })
  }

  // Selected requirements for dialog
  const selectedRequirements = useMemo(() => {
    return requirements
      .filter(r => selectedIds.has(r.id))
      .map(r => ({
        id: r.id,
        requirementNumber: r.requirement_number,
        description: r.description,
      }))
  }, [requirements, selectedIds])

  const totalRequirements = requirements.length

  return (
    <>
      <div className="mb-4 flex items-start gap-4 rounded-lg bg-stone-50 p-4">
        <RankIcon rank={rank} size="lg" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-stone-900">{rank.name} Rank</h3>
            <VersionYearBadge year={rank.requirement_version_year} />
          </div>
          {rank.description && (
            <p className="mt-1 text-sm text-stone-600">{rank.description}</p>
          )}
          <p className="mt-2 text-sm text-stone-500">
            {totalRequirements} requirements • Select to sign off for scouts
          </p>
        </div>
      </div>

      {/* Requirements List */}
      {requirementTree.length > 0 ? (
        <div className="space-y-2">
          {requirementTree.map(node => (
            <RequirementNodeView
              key={node.requirement.id}
              node={node}
              depth={0}
              isMultiSelectMode={canEdit}
              selectedIds={selectedIds}
              onSelectionChange={handleSelectionChange}
              collapsedNodes={collapsedNodes}
              toggleNode={toggleNode}
            />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Award className="mx-auto h-12 w-12 text-stone-300" />
          <p className="mt-2 text-stone-500">No requirements found for this rank</p>
        </div>
      )}

      {/* Multi-select action bar - shows when items are selected */}
      <MultiSelectActionBar
        selectedCount={selectedIds.size}
        totalSelectableCount={requirements.length}
        onSelectAll={handleSelectAll}
        onClear={handleClearSelection}
        onSignOff={handleSignOff}
        visible={selectedIds.size > 0}
      />

      {/* Scout selection dialog */}
      <ScoutSelectionDialog
        open={scoutSelectionOpen}
        onOpenChange={setScoutSelectionOpen}
        title={rank.name}
        type="rank"
        scouts={scouts}
        selectedRequirements={selectedRequirements}
        scoutsWithAllComplete={scoutsWithAllComplete}
        scoutCompletedRequirements={scoutCompletedRequirements}
        onConfirm={handleConfirmSignOff}
        isLoading={isPending}
      />
    </>
  )
}
