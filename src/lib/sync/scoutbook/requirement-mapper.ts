/**
 * Requirement ID Mapper
 *
 * Maps Scoutbook requirement IDs to Chuckbox database IDs.
 *
 * Scoutbook formats:
 * - Rank requirements: "1", "1a", "2b", "3c(1)"
 * - Merit badge requirements: "1", "2", "3a", "6A(a)(1)"
 *
 * Database formats:
 * - bsa_rank_requirements: requirement_number + sub_requirement_letter
 * - bsa_merit_badge_requirements: original_scoutbook_id OR requirement_number + sub_requirement_letter
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

// ============================================================================
// Types
// ============================================================================

/**
 * A mapped requirement with both Scoutbook ID and Chuckbox ID
 */
export interface MappedRequirement {
  scoutbookId: string; // Original ID from Scoutbook (e.g., "1a", "6A(a)(1)")
  chuckboxId: string | null; // UUID from database, or null if not found
  matched: boolean;
  matchMethod: 'exact' | 'parsed' | 'fuzzy' | 'not_found';
}

/**
 * Result of mapping all requirements for a rank or badge
 */
export interface RequirementMappingResult {
  totalRequirements: number;
  mappedCount: number;
  unmappedCount: number;
  mappings: MappedRequirement[];
}

// ============================================================================
// Rank Requirement Mapping
// ============================================================================

/**
 * Map Scoutbook rank requirement IDs to Chuckbox database IDs
 *
 * @param supabase - Supabase client
 * @param rankCode - Rank code (e.g., "scout", "tenderfoot")
 * @param versionYear - Requirement version year (default: 2024)
 * @param scoutbookIds - Array of Scoutbook requirement IDs (e.g., ["1", "1a", "2b"])
 */
export async function mapRankRequirements(
  supabase: SupabaseClient<Database>,
  rankCode: string,
  versionYear: number,
  scoutbookIds: string[]
): Promise<RequirementMappingResult> {
  const mappings: MappedRequirement[] = [];

  // Get the rank ID
  const { data: rank } = await supabase
    .from('bsa_ranks')
    .select('id')
    .eq('code', rankCode.toLowerCase())
    .single();

  if (!rank) {
    // All requirements unmapped
    return {
      totalRequirements: scoutbookIds.length,
      mappedCount: 0,
      unmappedCount: scoutbookIds.length,
      mappings: scoutbookIds.map((id) => ({
        scoutbookId: id,
        chuckboxId: null,
        matched: false,
        matchMethod: 'not_found' as const,
      })),
    };
  }

  // Get all requirements for this rank and version
  const { data: requirements } = await supabase
    .from('bsa_rank_requirements')
    .select('id, requirement_number, sub_requirement_letter')
    .eq('rank_id', rank.id)
    .eq('version_year', versionYear);

  // Create a map for quick lookup
  const requirementMap = new Map<string, string>();
  for (const req of requirements || []) {
    // Build the Scoutbook-style ID from parts
    const scoutbookStyleId = buildScoutbookStyleId(
      req.requirement_number,
      req.sub_requirement_letter
    );
    requirementMap.set(scoutbookStyleId.toLowerCase(), req.id);
  }

  // Map each Scoutbook ID
  for (const scoutbookId of scoutbookIds) {
    const normalizedId = scoutbookId.toLowerCase().trim();

    // Try exact match first
    let chuckboxId = requirementMap.get(normalizedId);
    let matchMethod: 'exact' | 'parsed' | 'fuzzy' | 'not_found' = 'exact';

    if (!chuckboxId) {
      // Try parsing and rebuilding the ID
      const parsed = parseScoutbookId(scoutbookId);
      const rebuiltId = buildScoutbookStyleId(
        parsed.requirementNumber,
        parsed.subRequirementLetter
      );
      chuckboxId = requirementMap.get(rebuiltId.toLowerCase());
      matchMethod = chuckboxId ? 'parsed' : 'not_found';
    }

    mappings.push({
      scoutbookId,
      chuckboxId: chuckboxId || null,
      matched: !!chuckboxId,
      matchMethod,
    });
  }

  const mappedCount = mappings.filter((m) => m.matched).length;

  return {
    totalRequirements: scoutbookIds.length,
    mappedCount,
    unmappedCount: scoutbookIds.length - mappedCount,
    mappings,
  };
}

// ============================================================================
// Merit Badge Requirement Mapping
// ============================================================================

/**
 * Map Scoutbook merit badge requirement IDs to Chuckbox database IDs
 *
 * @param supabase - Supabase client
 * @param badgeCode - Merit badge code (e.g., "camping", "first_aid")
 * @param versionYear - Requirement version year (default: 2024)
 * @param scoutbookIds - Array of Scoutbook requirement IDs (e.g., ["1", "2", "6A(a)(1)"])
 */
export async function mapMeritBadgeRequirements(
  supabase: SupabaseClient<Database>,
  badgeCode: string,
  versionYear: number,
  scoutbookIds: string[]
): Promise<RequirementMappingResult> {
  const mappings: MappedRequirement[] = [];

  // Get the merit badge ID
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('code', badgeCode.toLowerCase())
    .single();

  if (!badge) {
    // All requirements unmapped
    return {
      totalRequirements: scoutbookIds.length,
      mappedCount: 0,
      unmappedCount: scoutbookIds.length,
      mappings: scoutbookIds.map((id) => ({
        scoutbookId: id,
        chuckboxId: null,
        matched: false,
        matchMethod: 'not_found' as const,
      })),
    };
  }

  // Get all requirements for this badge and version
  const { data: requirements } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, sub_requirement_letter, original_scoutbook_id')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', versionYear);

  // Create maps for lookup
  // 1. By original_scoutbook_id (exact match)
  const scoutbookIdMap = new Map<string, string>();
  // 2. By requirement_number + sub_requirement_letter
  const requirementMap = new Map<string, string>();

  for (const req of requirements || []) {
    if (req.original_scoutbook_id) {
      scoutbookIdMap.set(req.original_scoutbook_id.toLowerCase(), req.id);
    }
    const scoutbookStyleId = buildScoutbookStyleId(
      req.requirement_number,
      req.sub_requirement_letter
    );
    requirementMap.set(scoutbookStyleId.toLowerCase(), req.id);
  }

  // Map each Scoutbook ID
  for (const scoutbookId of scoutbookIds) {
    const normalizedId = scoutbookId.toLowerCase().trim();

    // Try original_scoutbook_id match first (best for complex IDs like "6A(a)(1)")
    let chuckboxId = scoutbookIdMap.get(normalizedId);
    let matchMethod: 'exact' | 'parsed' | 'fuzzy' | 'not_found' = 'exact';

    if (!chuckboxId) {
      // Try requirement_number + sub_requirement_letter match
      chuckboxId = requirementMap.get(normalizedId);
      matchMethod = chuckboxId ? 'exact' : 'not_found';
    }

    if (!chuckboxId) {
      // Try parsing and rebuilding the ID
      const parsed = parseScoutbookId(scoutbookId);
      const rebuiltId = buildScoutbookStyleId(
        parsed.requirementNumber,
        parsed.subRequirementLetter
      );
      chuckboxId = requirementMap.get(rebuiltId.toLowerCase());
      matchMethod = chuckboxId ? 'parsed' : 'not_found';
    }

    mappings.push({
      scoutbookId,
      chuckboxId: chuckboxId || null,
      matched: !!chuckboxId,
      matchMethod,
    });
  }

  const mappedCount = mappings.filter((m) => m.matched).length;

  return {
    totalRequirements: scoutbookIds.length,
    mappedCount,
    unmappedCount: scoutbookIds.length - mappedCount,
    mappings,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a Scoutbook requirement ID into its components
 *
 * Examples:
 * - "1" -> { requirementNumber: "1", subRequirementLetter: null }
 * - "1a" -> { requirementNumber: "1", subRequirementLetter: "a" }
 * - "2b" -> { requirementNumber: "2", subRequirementLetter: "b" }
 * - "6A(a)(1)" -> { requirementNumber: "6A", subRequirementLetter: "(a)(1)" }
 */
export function parseScoutbookId(scoutbookId: string): {
  requirementNumber: string;
  subRequirementLetter: string | null;
} {
  const trimmed = scoutbookId.trim();

  // Pattern 1: Simple "1", "2", "3"
  if (/^\d+$/.test(trimmed)) {
    return { requirementNumber: trimmed, subRequirementLetter: null };
  }

  // Pattern 2: Number + letter "1a", "2b", "3c"
  const simpleLetter = trimmed.match(/^(\d+)([a-z])$/i);
  if (simpleLetter) {
    return {
      requirementNumber: simpleLetter[1],
      subRequirementLetter: simpleLetter[2].toLowerCase(),
    };
  }

  // Pattern 3: Complex format "6A(a)(1)", "9b(2)"
  const complex = trimmed.match(/^(\d+[A-Z]?)(.*)$/i);
  if (complex) {
    return {
      requirementNumber: complex[1],
      subRequirementLetter: complex[2] || null,
    };
  }

  // Fallback: treat entire thing as requirement number
  return { requirementNumber: trimmed, subRequirementLetter: null };
}

/**
 * Build a Scoutbook-style ID from components
 *
 * Examples:
 * - ("1", null) -> "1"
 * - ("1", "a") -> "1a"
 * - ("6A", "(a)(1)") -> "6A(a)(1)"
 */
export function buildScoutbookStyleId(
  requirementNumber: string,
  subRequirementLetter: string | null
): string {
  if (!subRequirementLetter) {
    return requirementNumber;
  }
  return `${requirementNumber}${subRequirementLetter}`;
}

/**
 * Normalize a badge name to match the database code format
 */
export function normalizeBadgeCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Normalize a rank name to match the database code format
 */
export function normalizeRankCode(name: string): string {
  const rankMap: Record<string, string> = {
    scout: 'scout',
    tenderfoot: 'tenderfoot',
    'second class': 'second_class',
    'first class': 'first_class',
    star: 'star',
    'star scout': 'star',
    life: 'life',
    'life scout': 'life',
    eagle: 'eagle',
    'eagle scout': 'eagle',
  };

  const normalized = name.toLowerCase().trim();
  return rankMap[normalized] || normalized.replace(/\s+/g, '_');
}
