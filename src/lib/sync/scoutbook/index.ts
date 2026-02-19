/**
 * Scoutbook Sync Module
 *
 * Provides browser automation for syncing data from Scoutbook Plus
 * using Vercel's agent-browser CLI tool.
 *
 * @example
 * ```typescript
 * import { syncFromScoutbook, syncRosterOnly } from '@/lib/sync/scoutbook';
 *
 * // Full sync (roster + profiles)
 * const result = await syncFromScoutbook({
 *   onProgress: (progress) => console.log(progress.message),
 * });
 *
 * // Roster only (faster)
 * const rosterResult = await syncRosterOnly();
 * ```
 */

// Main exports
export {
  syncFromScoutbook,
  syncRosterOnly,
  matchRosterToScouts,
} from './sync-orchestrator';

// Import functions
export {
  importRosterMembers,
  stageRosterMembers,
  getStagedMembers,
  updateStagedSelection,
  updateFieldResolution,
  confirmStagedImport,
  cancelStaging,
} from './import';
export type { ImportResult, StagingResult, StagedMember } from './import';

// Advancement import functions
export {
  stageRankRequirements,
  stageMeritBadgeRequirements,
  getStagedAdvancement,
  updateStagedAdvancementSelection,
  confirmAdvancementImport,
} from './advancement-import';
export type {
  StagedAdvancement,
  AdvancementStagingResult,
  AdvancementImportResult,
} from './advancement-import';

// Requirement mapping
export {
  mapRankRequirements,
  mapMeritBadgeRequirements,
  normalizeRankCode,
  normalizeBadgeCode,
} from './requirement-mapper';

// Browser client (for advanced usage)
export {
  AgentBrowserClient,
  hasElement,
  findElement,
  findAllElements,
} from './browser-client';

// Parsers (for custom extraction)
export {
  parseRosterPage,
  parseRosterFromRefs,
  hasNextPage,
  findNextPageRef,
  getTotalMemberCount,
  getCurrentPage,
} from './parsers/roster';

export {
  parseYouthProfile,
  findRankViewMoreButtons,
  isYouthProfilePage,
} from './parsers/profile';

// Advancement parsers (regex-based - used by extension sync)
export {
  parseRankDetailsFromSnapshot,
  parseMeritBadgeDetailsFromSnapshot,
} from './parsers/advancement';

// AI-powered parsers (optional fallback - not used by default)
export {
  parseRankDetailsWithAI,
  parseMeritBadgeDetailsWithAI,
} from './parsers/advancement';
export type {
  MeritBadgeDetail,
  MeritBadgeRequirement,
  ScoutAdvancementData,
} from './parsers/advancement';

// Types
export type {
  RosterMember,
  ScoutProfile,
  ScoutRelationship,
  LeadershipPosition,
  RankProgress,
  RankRequirementDetail,
  Requirement,
  SyncSession,
  SyncStatus,
  SyncError,
  SyncResult,
  SyncOptions,
  SyncProgress,
  SyncProgressCallback,
  AgentBrowserSnapshot,
  SnapshotRef,
  // Conflict resolution types
  ConflictResolution,
  FieldConflict,
  ConflictReason,
  ConflictField,
} from './types';

export { DEFAULT_SYNC_OPTIONS, CONFLICT_FIELDS } from './types';
