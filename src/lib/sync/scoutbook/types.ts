/**
 * Scoutbook Sync Types
 *
 * Data models for syncing from Scoutbook Plus (advancements.scouting.org)
 * using agent-browser for accessibility-tree-based browser automation.
 */

// ============================================================================
// Roster Data (from /roster page)
// ============================================================================

export interface RosterMember {
  name: string;
  bsaMemberId: string;
  type: 'YOUTH' | 'LEADER' | 'P 18+';
  age: string; // "15" or "(21+)"
  lastRankApproved: string | null; // "Life Scout", "Eagle Scout", etc.
  patrol: string | null; // "Flaring Phoenix", "Blazing Bulls", or "unassigned"
  position: string | null; // Primary position: "Senior Patrol Leader", "Scoutmaster"
  position2: string | null; // Secondary position (if member holds 2 positions)
  renewalStatus: string; // "Current", "Eligible to Renew", "Current (Over 18)"
  expirationDate: string; // "8/31/2026"
}

// ============================================================================
// Youth Profile Data (from /youthProfile/{id} page)
// ============================================================================

export interface ScoutProfile {
  name: string;
  bsaMemberId: string;
  status: 'Current' | 'Eligible to Renew' | 'Expired' | string;
  unit: string;
  patrol: string | null;
  dateJoined: string | null;
  lastRankScoutsBSA: string | null;
  lastRankCubScout: string | null;

  relationships: ScoutRelationship[];
  leadershipPositions: LeadershipPosition[];
  rankProgress: RankProgress[];

  meritBadges: {
    pending: number;
    approved: number;
  };

  activityLogs: {
    campingNights: number;
    hikingMiles: number;
    serviceHours: number;
  };
}

export interface ScoutRelationship {
  name: string;
  bsaMemberId: string;
  relationship: string; // "Parent", "Guardian"
}

export interface LeadershipPosition {
  position: string;
  days: number;
  current: boolean;
  unit: string;
  dateRange: string;
}

export interface RankProgress {
  rankName: string;
  status: 'AWARDED' | 'APPROVED' | 'STARTED' | 'NOT_STARTED';
  completedDate: string | null;
  percentComplete: number;
}

// ============================================================================
// Rank Requirements Data (from rank detail page)
// ============================================================================

export interface RankRequirementDetail {
  rankName: string;
  requirementsVersion: string; // "2022 (Active)"
  percentComplete: number;
  status: 'STARTED' | 'APPROVED' | 'AWARDED';
  finalCompletionDate: string | null;
  requirements: Requirement[];
}

export interface Requirement {
  id: string; // "1a", "2b", "3c"
  status: 'STARTED' | 'APPROVED';
  completedDate: string | null;
  description: string;
  commentCount: number;
}

// ============================================================================
// Sync Session Types
// ============================================================================

export type SyncStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncSession {
  id: string;
  unitId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: SyncStatus;
  pagesVisited: number;
  recordsExtracted: number;
  errors: SyncError[];
}

export interface SyncError {
  timestamp: Date;
  pageUrl: string;
  pageType: string;
  error: string;
  snapshot?: string; // JSON string of accessibility snapshot at time of error
}

export interface SyncResult {
  success: boolean;
  session: SyncSession;
  rosterMembers: RosterMember[];
  profiles: ScoutProfile[];
  errors: SyncError[];
}

// ============================================================================
// agent-browser Snapshot Types
// ============================================================================

export interface AgentBrowserSnapshot {
  success: boolean;
  data: {
    refs: Record<string, SnapshotRef>;
    snapshot: string; // Human-readable tree
  };
  error: string | null;
}

export interface SnapshotRef {
  name?: string;
  role: string;
}

// ============================================================================
// Sync Progress Callback
// ============================================================================

export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface SyncProgress {
  phase: 'login' | 'roster' | 'profiles' | 'requirements' | 'complete';
  message: string;
  current: number;
  total: number;
  percentComplete: number;
}

// ============================================================================
// Sync Options
// ============================================================================

export interface SyncOptions {
  /** Include detailed rank requirements (requires more page visits) */
  includeRequirements?: boolean;

  /** Only sync roster data, skip individual profiles */
  rosterOnly?: boolean;

  /** Callback for progress updates */
  onProgress?: SyncProgressCallback;

  /** Maximum time to wait for user login (ms) */
  loginTimeout?: number;

  /** Rate limit delay between page navigations (ms) */
  rateLimitDelay?: number;
}

export const DEFAULT_SYNC_OPTIONS: Required<Omit<SyncOptions, 'onProgress'>> = {
  includeRequirements: false,
  rosterOnly: false,
  loginTimeout: 120000, // 2 minutes
  rateLimitDelay: 1000, // 1 second
};

// ============================================================================
// Conflict Resolution Types
// ============================================================================

/**
 * Resolution strategy for a field conflict
 * - 'chuckbox': Keep the existing Chuckbox value (default for conflicts)
 * - 'scoutbook': Use the new Scoutbook value
 */
export type ConflictResolution = 'chuckbox' | 'scoutbook';

/**
 * Conflict detection criteria for sync operations
 *
 * A conflict occurs when we would NOT automatically apply the Scoutbook value:
 * - rank: Scoutbook rank is lower than Chuckbox rank (would be a downgrade)
 * - patrol: Scoutbook value is null but Chuckbox has a valid patrol
 * - position/position_2: Scoutbook value is null but Chuckbox has a value
 *
 * By default, Chuckbox values "win" in conflicts. Users can override to use
 * Scoutbook values per-field.
 */
export interface FieldConflict {
  field: string;
  chuckboxValue: string | null;
  scoutbookValue: string | null;
  reason: ConflictReason;
  resolution: ConflictResolution;
}

/**
 * Why Chuckbox would win for this field
 */
export type ConflictReason =
  | 'rank_downgrade'       // Scoutbook rank is lower
  | 'null_overwrite'       // Scoutbook value is null, Chuckbox has value
  | 'user_modified';       // User has modified this field in Chuckbox (future)

/**
 * Fields that can have conflicts during sync
 */
export const CONFLICT_FIELDS = [
  'rank',
  'patrol',
  'position',
  'position_2',
] as const;

export type ConflictField = typeof CONFLICT_FIELDS[number];
