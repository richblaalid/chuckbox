'use client'

import { useMemo, useState, useRef, memo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { RequirementApprovalRow } from './requirement-approval-row'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronDown, ChevronRight, Check } from 'lucide-react'
import type { AdvancementStatus } from '@/types/advancement'

interface Requirement {
  id: string
  requirementProgressId: string | null // Can be null for unstarted ranks
  requirementNumber: string
  description: string
  status: AdvancementStatus
  completedAt: string | null
  completedBy: string | null
  notes: string | null
  approvalStatus: string | null
  // New fields for alternatives support
  parentRequirementId?: string | null
  isAlternative?: boolean | null
  alternativesGroup?: string | null
  nestingDepth?: number | null
  requiredCount?: number | null
  // Header support - headers are description-only, not approvable
  isHeader?: boolean | null
}

interface HierarchicalRequirementsListProps {
  requirements: Requirement[]
  unitId: string
  canEdit: boolean
  canSubmit?: boolean // Parents can submit requirements for approval
  scoutId?: string // Scout ID for parent submission
  showSectionHeaders?: boolean
  defaultCollapseCompleted?: boolean
  // Current user name for completion dialogs
  currentUserName?: string
  // Optional data for initializing progress when marking complete on unstarted ranks
  initData?: {
    scoutId: string
    rankId: string
  }
  // Merit badge support
  isMeritBadge?: boolean
  meritBadgeInitData?: {
    scoutId: string
    meritBadgeId: string
    meritBadgeProgressId: string
  }
  // Multi-select support for bulk operations
  isMultiSelectMode?: boolean
  selectedIds?: Set<string>
  onSelectionChange?: (id: string) => void
}

/**
 * Extract just the last part of a requirement number for display in nested views.
 * The full hierarchy is visible from the tree structure, so we only need to show
 * the leaf identifier.
 *
 * Examples:
 * - "4 Option A (1)(a)" → "a"
 * - "4 Option A (1)" → "1"
 * - "4 Option A" → "Option A"
 * - "4" → "4"
 * - "1(a)" → "a"
 * - "1a" → "a" (for simple formats)
 * - "2d[1]" → "1" (bracket notation)
 * - "2d[2]" → "2"
 */
function getDisplayLabel(reqNum: string, hasParent: boolean): string {
  // If no parent, show the full requirement number (it's a root)
  if (!hasParent) {
    return reqNum
  }

  // Check for bracket suffix like [1], [2] (e.g., "2d[1]" → "1")
  const bracketMatch = reqNum.match(/\[(\d+)\]$/)
  if (bracketMatch) {
    return bracketMatch[1] // Return just the number inside brackets
  }

  // Check for parenthetical suffix like (a), (b), (1), (2)
  const parenMatch = reqNum.match(/\(([^)]+)\)$/)
  if (parenMatch) {
    return parenMatch[1] // Return just the content inside last parens
  }

  // Check for "Option X" pattern
  const optionMatch = reqNum.match(/Option\s+([A-Z])(?:\s|$)/i)
  if (optionMatch) {
    // If it's just "4 Option A", show "Option A"
    if (reqNum.match(/^\d+\s+Option\s+[A-Z]$/i)) {
      return `Option ${optionMatch[1]}`
    }
  }

  // Check for simple letter suffix like "1a", "2b"
  const simpleMatch = reqNum.match(/\d+([a-z])$/i)
  if (simpleMatch) {
    return simpleMatch[1].toLowerCase()
  }

  // Fallback: return the full number
  return reqNum
}

// Parse requirement number to extract group number, sub-letters, and depth
// Handles: "1", "1a", "1a1", "1b8", "6A", "6A(a)(1)"
function parseRequirementNumber(reqNum: string): {
  group: number
  subParts: string[]
  depth: number
  isParent: boolean
} {
  // First try standard pattern: number + optional letter + optional number
  // Examples: "1", "1a", "1a1", "7b8"
  const standardMatch = reqNum.match(/^(\d+)([a-z])?(\d+)?$/i)
  if (standardMatch) {
    const group = parseInt(standardMatch[1], 10)
    const subParts: string[] = []
    if (standardMatch[2]) {
      subParts.push(standardMatch[2].toLowerCase())
      if (standardMatch[3]) {
        subParts.push(standardMatch[3])
      }
    }
    return {
      group,
      subParts,
      depth: 1 + subParts.length,
      isParent: subParts.length === 0,
    }
  }

  // Try parenthetical pattern: "6A(a)(1)"
  const parenMatch = reqNum.match(/^(\d+)([A-Z])?(?:\(([^)]+)\))*$/i)
  if (parenMatch) {
    const group = parseInt(parenMatch[1], 10)
    const subParts: string[] = []
    if (parenMatch[2]) {
      subParts.push(parenMatch[2].toUpperCase())
    }
    // Extract all parenthetical groups
    const parenGroups = reqNum.match(/\(([^)]+)\)/g)
    if (parenGroups) {
      parenGroups.forEach(pg => {
        const content = pg.slice(1, -1)
        subParts.push(content)
      })
    }
    return {
      group,
      subParts,
      depth: 1 + subParts.length,
      isParent: subParts.length === 0,
    }
  }

  // Fallback: try to extract leading number
  const numMatch = reqNum.match(/^(\d+)/)
  if (numMatch) {
    return {
      group: parseInt(numMatch[1], 10),
      subParts: reqNum.slice(numMatch[1].length).split('').filter(Boolean),
      depth: reqNum.length > numMatch[1].length ? 2 : 1,
      isParent: reqNum === numMatch[1],
    }
  }

  return { group: 0, subParts: [], depth: 1, isParent: true }
}

// Tree node for recursive rendering
interface RequirementNode {
  requirement: Requirement
  children: RequirementNode[]
  depth: number
}

// Build a tree structure from flat requirements using parent_requirement_id
function buildRequirementTree(requirements: Requirement[]): RequirementNode[] {
  // Check if requirements have parentRequirementId - if so, use it
  const hasParentIds = requirements.some(r => r.parentRequirementId !== undefined)

  if (hasParentIds) {
    return buildTreeFromParentIds(requirements)
  }

  // Fallback: use parsing-based grouping for legacy data
  return buildTreeFromParsing(requirements)
}

// Build tree using parent_requirement_id relationships
function buildTreeFromParentIds(requirements: Requirement[]): RequirementNode[] {
  const nodeMap = new Map<string, RequirementNode>()
  const roots: RequirementNode[] = []

  // First pass: create nodes for all requirements
  requirements.forEach(req => {
    nodeMap.set(req.id, {
      requirement: req,
      children: [],
      depth: req.nestingDepth || 1,
    })
  })

  // Second pass: build parent-child relationships
  requirements.forEach(req => {
    const node = nodeMap.get(req.id)!
    if (req.parentRequirementId) {
      const parent = nodeMap.get(req.parentRequirementId)
      if (parent) {
        parent.children.push(node)
      } else {
        // Parent not found, treat as root
        roots.push(node)
      }
    } else {
      roots.push(node)
    }
  })

  // Sort roots by group number
  roots.sort((a, b) => {
    const parsedA = parseRequirementNumber(a.requirement.requirementNumber)
    const parsedB = parseRequirementNumber(b.requirement.requirementNumber)
    return parsedA.group - parsedB.group
  })

  // Sort children recursively
  function sortChildren(node: RequirementNode) {
    node.children.sort((a, b) => {
      const parsedA = parseRequirementNumber(a.requirement.requirementNumber)
      const parsedB = parseRequirementNumber(b.requirement.requirementNumber)
      if (parsedA.group !== parsedB.group) return parsedA.group - parsedB.group
      return parsedA.subParts.join('').localeCompare(parsedB.subParts.join(''))
    })
    node.children.forEach(sortChildren)
  }

  roots.forEach(sortChildren)
  return roots
}

// Fallback: build tree using requirement number parsing (legacy)
function buildTreeFromParsing(requirements: Requirement[]): RequirementNode[] {
  const groups = new Map<number, { parent: Requirement | null; children: Requirement[] }>()

  // Sort requirements
  const sorted = [...requirements].sort((a, b) => {
    const parsedA = parseRequirementNumber(a.requirementNumber)
    const parsedB = parseRequirementNumber(b.requirementNumber)
    if (parsedA.group !== parsedB.group) return parsedA.group - parsedB.group
    if (parsedA.isParent && !parsedB.isParent) return -1
    if (!parsedA.isParent && parsedB.isParent) return 1
    return parsedA.subParts.join('').localeCompare(parsedB.subParts.join(''))
  })

  sorted.forEach(req => {
    const parsed = parseRequirementNumber(req.requirementNumber)
    if (!groups.has(parsed.group)) {
      groups.set(parsed.group, { parent: null, children: [] })
    }
    const group = groups.get(parsed.group)!
    if (parsed.isParent) {
      group.parent = req
    } else {
      group.children.push(req)
    }
  })

  // Convert to tree nodes
  const roots: RequirementNode[] = []
  Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([, { parent, children }]) => {
      if (parent) {
        const parentNode: RequirementNode = {
          requirement: parent,
          children: children.map(c => ({
            requirement: c,
            children: [],
            depth: 2,
          })),
          depth: 1,
        }
        roots.push(parentNode)
      } else if (children.length > 0) {
        // No parent, just children - treat first as parent
        const [first, ...rest] = children
        roots.push({
          requirement: first,
          children: rest.map(c => ({
            requirement: c,
            children: [],
            depth: 2,
          })),
          depth: 1,
        })
      }
    })

  return roots
}

// Calculate completion stats for a node and its children
// Headers are excluded from counts since they're not approvable
function getNodeStats(node: RequirementNode): { completed: number; total: number } {
  const isHeader = node.requirement.isHeader === true

  // Headers don't count toward completion
  let completed = !isHeader && isRequirementComplete(node.requirement) ? 1 : 0
  let total = isHeader ? 0 : 1

  node.children.forEach(child => {
    const childStats = getNodeStats(child)
    completed += childStats.completed
    total += childStats.total
  })

  return { completed, total }
}

// Check if a single requirement is complete
function isRequirementComplete(req: Requirement) {
  return ['completed', 'approved', 'awarded'].includes(req.status)
}

/**
 * Get tier-based styling for nested requirement levels.
 * Refined Pine Green Design:
 *
 * - Headers (non-completable): Subtle pine green tinted backgrounds by depth
 * - Completable requirements: Always white backgrounds
 * - Completed items: Green success background (emerald)
 * - All borders: Pine green (#234D3E)
 * - Left borders: Pine green for hierarchy indication
 *
 * Design rationale:
 * - Clean, professional look with consistent pine green accents
 * - Headers distinguished by subtle green tints
 * - Completable items are clean white for clarity
 * - Completed items get green treatment whether single or collapsed parent
 * - Depth visible through tint intensity and left border lines
 */
function getTierStyles(
  depth: number,
  isHeader: boolean,
  isComplete: boolean,
  isSelected: boolean,
  isCollapsedParent: boolean = false
) {
  // All borders use pine green (forest-800 = #234D3E)
  const borderColor = 'border-forest-800'

  // Header backgrounds: subtle pine green tints that fade with depth
  // Using rgba for precise opacity control
  const headerBackgrounds = [
    'bg-forest-800/[0.12]',  // Depth 0: 12% pine
    'bg-forest-800/[0.08]',  // Depth 1: 8% pine
    'bg-forest-800/[0.05]',  // Depth 2: 5% pine
    'bg-forest-800/[0.03]',  // Depth 3: 3% pine
    'bg-forest-800/[0.02]',  // Depth 4+: 2% pine
  ]

  const idx = Math.min(depth, 4)

  // Border width - thicker for root level headers
  const borderWidth = depth === 0 && isHeader ? 'border-2' : 'border'

  // Override for completed items - emerald success state
  // Apply green treatment when:
  // 1. Single completable requirement that is complete (!isHeader && isComplete)
  // 2. Parent with children that is complete AND collapsed (isCollapsedParent && isComplete)
  const showCompleteStyle = isComplete && (!isHeader || isCollapsedParent)
  if (showCompleteStyle) {
    return {
      container: 'border-success bg-success-light',
      leftBorder: 'border-success',
      borderWidth: 'border',
    }
  }

  // Override for selected items - blue selection state
  if (isSelected && !isHeader) {
    return {
      container: 'border-blue-400 bg-blue-50/50',
      leftBorder: borderColor,
      borderWidth: 'border',
    }
  }

  // Header styling - subtle pine green tinted backgrounds
  if (isHeader) {
    return {
      container: `${borderColor} ${headerBackgrounds[idx]}`,
      leftBorder: borderColor,
      borderWidth,
    }
  }

  // Completable requirements - always white background
  return {
    container: `${borderColor} bg-white`,
    leftBorder: borderColor,
    borderWidth: 'border',
  }
}

// Recursive requirement node component
const RequirementNodeView = memo(function RequirementNodeView({
  node,
  unitId,
  canEdit,
  canSubmit,
  scoutId,
  currentUserName,
  initData,
  isMeritBadge,
  meritBadgeInitData,
  collapsedNodes,
  toggleNode,
  isMultiSelectMode,
  selectedIds,
  onSelectionChange,
  depth = 0,
}: {
  node: RequirementNode
  unitId: string
  canEdit: boolean
  canSubmit?: boolean
  scoutId?: string
  currentUserName?: string
  initData?: { scoutId: string; rankId: string }
  isMeritBadge?: boolean
  meritBadgeInitData?: {
    scoutId: string
    meritBadgeId: string
    meritBadgeProgressId: string
  }
  collapsedNodes: Set<string>
  toggleNode: (id: string) => void
  isMultiSelectMode?: boolean
  selectedIds?: Set<string>
  onSelectionChange?: (id: string) => void
  depth?: number
}) {
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsedNodes.has(node.requirement.id)
  const stats = getNodeStats(node)
  const isComplete = stats.completed === stats.total && stats.total > 0
  const req = node.requirement
  const isHeader = req.isHeader === true
  const hasParent = !!req.parentRequirementId
  const displayLabel = getDisplayLabel(req.requirementNumber, hasParent)

  // Check if this node's children are alternatives
  const hasAlternativeChildren = node.children.some(c => c.requirement.isAlternative)
  const requiredCount = req.requiredCount

  // For leaf nodes (no children) that are NOT headers, render requirement row
  if (!hasChildren && !isHeader) {
    return (
      <RequirementApprovalRow
        id={req.id}
        requirementProgressId={req.requirementProgressId}
        requirementNumber={req.requirementNumber}
        displayLabel={displayLabel}
        description={req.description}
        status={req.status}
        completedAt={req.completedAt}
        completedBy={req.completedBy}
        notes={req.notes}
        approvalStatus={req.approvalStatus}
        unitId={unitId}
        canEdit={canEdit}
        canSubmit={canSubmit}
        scoutId={scoutId}
        currentUserName={currentUserName}
        initData={initData}
        isMeritBadge={isMeritBadge}
        meritBadgeInitData={meritBadgeInitData}
        isMultiSelectMode={isMultiSelectMode}
        isSelected={selectedIds?.has(req.id) ?? false}
        onSelectionChange={onSelectionChange ? () => onSelectionChange(req.id) : undefined}
      />
    )
  }

  // For nodes with children (or headers), render collapsible section
  const isSelected = selectedIds?.has(req.id) ?? false

  const handleParentClick = (e: React.MouseEvent) => {
    // Headers are never selectable - just toggle collapse
    if (isHeader) {
      toggleNode(req.id)
      return
    }
    // In multi-select mode, clicking the row toggles selection
    if (isMultiSelectMode && onSelectionChange && !isComplete) {
      // Don't trigger if clicking directly on checkbox or expand button
      const target = e.target as HTMLElement
      if (target.closest('[role="checkbox"]') || target.closest('button')) {
        return
      }
      onSelectionChange(req.id)
    } else {
      // Normal mode: toggle collapse
      toggleNode(req.id)
    }
  }

  // Get tier-based styling for this depth level
  // Treat any node with children as a "header" for styling (subtle pine background)
  // Only leaf nodes without children get white completable styling
  // When collapsed and complete, show green treatment to indicate rolled-up completion
  const isContainerNode = hasChildren || isHeader
  const isCollapsedParent = hasChildren && isCollapsed
  const tierStyles = getTierStyles(depth, isContainerNode, isComplete, isSelected, isCollapsedParent)

  return (
    <div className={cn(
      'rounded-lg transition-colors',
      tierStyles.borderWidth,
      tierStyles.container
    )}>
      {/* Collapsible Header */}
      <div
        onClick={handleParentClick}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
          'hover:bg-stone-100/50',
          isCollapsed ? 'rounded-lg' : 'rounded-t-lg',
          isComplete && (!isHeader || isCollapsedParent) && 'hover:bg-emerald-100/50',
          isMultiSelectMode && !isComplete && !isHeader && 'cursor-pointer'
        )}
      >
        {/* Headers: Always show expand/collapse icon, never checkbox */}
        {/* Non-headers in multi-select: Show checkbox */}
        {/* Non-headers normal mode: Show expand/collapse */}
        {isHeader ? (
          // Headers always have expand/collapse, never checkbox
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
        ) : isMultiSelectMode && !isComplete ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectionChange?.(req.id)}
            className={cn(
              'shrink-0',
              isSelected && 'border-blue-500 bg-blue-500 text-white data-[state=checked]:bg-blue-500'
            )}
          />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleNode(req.id)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-400 hover:text-stone-600"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Requirement Number Badge - Pine green with white text */}
        <span className={cn(
          'flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1.5 text-xs font-bold',
          isComplete && !isHeader
            ? 'bg-success text-white'  // Completed: emerald green
            : 'bg-forest-800 text-white'  // Default: pine green
        )}>
          {displayLabel}
        </span>

        {/* Title/Description */}
        <span className={cn(
          'flex-1',
          isHeader && !isCollapsedParent
            ? 'font-semibold text-stone-600 italic'  // Header text styling
            : isComplete && (!isHeader || isCollapsedParent)
              ? 'font-medium text-emerald-700'
              : 'font-medium text-stone-700'
        )}>
          {req.description}
        </span>

        {/* Alternatives indicator */}
        {hasAlternativeChildren && requiredCount && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
            Choose {requiredCount}
          </span>
        )}

        {/* Expand/Collapse button (in multi-select mode for non-headers) */}
        {isMultiSelectMode && !isComplete && !isHeader && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleNode(req.id)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-stone-400 hover:text-stone-600"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Status Indicator - show completion progress or celebratory completed state */}
        {isComplete ? (
          // Celebratory completion indicator - amber accent
          <span className="flex items-center gap-1.5 rounded-full bg-amber-600/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
            <span className="text-sm">🎯</span>
            Completed!
          </span>
        ) : !isHeader && stats.total > 0 ? (
          // Progress indicator for non-headers
          <span className="text-xs text-stone-400">
            {stats.completed}/{stats.total}
          </span>
        ) : null}
      </div>

      {/* Expanded Content */}
      {!isCollapsed && (
        <div className="border-t border-stone-100 px-2 pb-2 pt-1">
          <div className="space-y-0.5">
            {node.children.map((child) => {
              // Get tier styling for the child's left border
              const childTierStyles = getTierStyles(
                depth + 1,
                child.requirement.isHeader === true,
                false, // completion determined inside child
                false
              )
              return (
                <div
                  key={child.requirement.id}
                  className={cn(
                    'ml-2 border-l-2 pl-2',
                    child.requirement.isAlternative
                      ? 'border-amber-200'
                      : childTierStyles.leftBorder
                  )}
                >
                  <RequirementNodeView
                    node={child}
                    unitId={unitId}
                    canEdit={canEdit}
                    canSubmit={canSubmit}
                    scoutId={scoutId}
                    currentUserName={currentUserName}
                    initData={initData}
                    isMeritBadge={isMeritBadge}
                    meritBadgeInitData={meritBadgeInitData}
                    collapsedNodes={collapsedNodes}
                    toggleNode={toggleNode}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedIds={selectedIds}
                    onSelectionChange={onSelectionChange}
                    depth={depth + 1}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})

// Helper to compute default collapsed nodes based on completed requirements
function computeDefaultCollapsedNodes(tree: RequirementNode[], collapseCompleted: boolean): Set<string> {
  if (!collapseCompleted) {
    return new Set()
  }

  const collapsed = new Set<string>()
  function checkNode(node: RequirementNode) {
    const stats = getNodeStats(node)
    if (stats.completed === stats.total && node.children.length > 0) {
      collapsed.add(node.requirement.id)
    }
    node.children.forEach(checkNode)
  }
  tree.forEach(checkNode)
  return collapsed
}

// Generate a stable key for requirements to detect meaningful changes
function getRequirementsKey(requirements: Requirement[]): string {
  return requirements.map(r => r.id).join(',')
}

export function HierarchicalRequirementsList({
  requirements,
  unitId,
  canEdit,
  canSubmit = false,
  scoutId,
  defaultCollapseCompleted = false,
  currentUserName,
  initData,
  isMeritBadge = false,
  meritBadgeInitData,
  isMultiSelectMode = false,
  selectedIds,
  onSelectionChange,
}: HierarchicalRequirementsListProps) {
  const requirementTree = useMemo(() => {
    return buildRequirementTree(requirements)
  }, [requirements])

  // Create a stable key from requirements - used to reset state when requirements change
  const requirementsKey = useMemo(() => getRequirementsKey(requirements), [requirements])

  // Compute default collapsed state from tree structure
  const defaultCollapsed = useMemo(() =>
    computeDefaultCollapsedNodes(requirementTree, defaultCollapseCompleted),
    [requirementTree, defaultCollapseCompleted]
  )

  // Track user's manual toggles, keyed by requirements
  // The key pattern ensures toggles reset when requirements change
  const [toggleState, setToggleState] = useState<{ key: string; toggles: Set<string> }>({
    key: requirementsKey,
    toggles: new Set()
  })

  // Derive effective collapsed state: default XOR user toggles
  // Compute userToggles inside useMemo to avoid dependency issues
  const collapsedNodes = useMemo(() => {
    // Get current user toggles (resets if requirements changed)
    const userToggles = toggleState.key === requirementsKey ? toggleState.toggles : new Set<string>()

    const effective = new Set(defaultCollapsed)
    userToggles.forEach(id => {
      if (effective.has(id)) {
        effective.delete(id)
      } else {
        effective.add(id)
      }
    })
    return effective
  }, [defaultCollapsed, toggleState, requirementsKey])

  const toggleNode = useCallback((id: string) => {
    setToggleState(prev => {
      // Ensure we're working with current requirements key
      const currentToggles = prev.key === requirementsKey ? prev.toggles : new Set<string>()
      const next = new Set(currentToggles)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { key: requirementsKey, toggles: next }
    })
  }, [requirementsKey])

  if (requirements.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-stone-500">
        No requirements loaded
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {requirementTree.map((node) => (
        <RequirementNodeView
          key={node.requirement.id}
          node={node}
          unitId={unitId}
          canEdit={canEdit}
          canSubmit={canSubmit}
          scoutId={scoutId}
          currentUserName={currentUserName}
          initData={initData}
          isMeritBadge={isMeritBadge}
          meritBadgeInitData={meritBadgeInitData}
          collapsedNodes={collapsedNodes}
          toggleNode={toggleNode}
          isMultiSelectMode={isMultiSelectMode}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
        />
      ))}
    </div>
  )
}
