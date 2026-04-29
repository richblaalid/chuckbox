# Bugfix: Duplicate Resource Links in Header Cards

## Problem

When a parent requirement is expanded in the hierarchical requirements list, resource links (videos, websites, PDFs) appear duplicated. The parent header card shows all resources, and each child requirement also shows its own subset of the same resources.

**Reproduction**: Open any merit badge with hierarchical requirements that have resources (e.g., Bird Study req 6). Expand the parent - resources appear at the parent level AND again on each child.

## Root Cause

In `hierarchical-requirements-list.tsx`, the expanded content area unconditionally rendered `<RequirementResources resources={req.resources} />` for parent nodes (line 653). Each child leaf node also rendered its own resources via `RequirementApprovalRow`. The canonical BSA data attaches resources at both parent and child levels, with children having subsets of the parent's resources.

**Data analysis**:
- 763 parent requirements have resources AND children
- 333 cases where both parent AND children have overlapping resources (duplicated)
- 430 cases where parent has resources but children don't (no duplication)

## Fix

Filter parent resources to exclude any that already appear on children (matched by URL). This handles all cases:
- Overlapping resources: parent only shows unique ones not on children
- Parent-only resources: all display (no children to duplicate)
- No parent resources: nothing renders

**File changed**: `src/components/advancement/hierarchical-requirements-list.tsx` (line 653)

## Status: COMPLETE
