/**
 * Scoutbook Sync Orchestrator
 *
 * Main entry point for syncing data from Scoutbook Plus.
 * Coordinates browser automation, parsing, and data extraction.
 */

import { AgentBrowserClient } from './browser-client';
import {
  parseRosterPage,
  parseRosterFromRefs,
  hasNextPage,
  findNextPageRef,
  getTotalMemberCount,
} from './parsers/roster';
import { parseYouthProfile, isYouthProfilePage } from './parsers/profile';
import {
  RosterMember,
  ScoutProfile,
  SyncSession,
  SyncResult,
  SyncError,
  SyncOptions,
  SyncProgress,
  DEFAULT_SYNC_OPTIONS,
} from './types';

/**
 * Main sync function
 *
 * Opens browser, waits for user login, then extracts data from Scoutbook
 */
export async function syncFromScoutbook(
  options: SyncOptions = {}
): Promise<SyncResult> {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options };
  const client = new AgentBrowserClient();

  const session: SyncSession = {
    id: crypto.randomUUID(),
    unitId: '', // Will be extracted from roster page
    startedAt: new Date(),
    completedAt: null,
    status: 'running',
    pagesVisited: 0,
    recordsExtracted: 0,
    errors: [],
  };

  const rosterMembers: RosterMember[] = [];
  const profiles: ScoutProfile[] = [];
  const errors: SyncError[] = [];

  try {
    // Phase 1: Open browser and wait for login
    reportProgress(opts.onProgress, {
      phase: 'login',
      message: 'Opening browser for login...',
      current: 0,
      total: 1,
      percentComplete: 0,
    });

    await client.openScoutbookLogin();

    reportProgress(opts.onProgress, {
      phase: 'login',
      message: 'Waiting for you to log in...',
      current: 0,
      total: 1,
      percentComplete: 10,
    });

    // Wait for user to complete manual login
    await client.waitForLogin(opts.loginTimeout);
    session.pagesVisited++;

    reportProgress(opts.onProgress, {
      phase: 'login',
      message: 'Login successful!',
      current: 1,
      total: 1,
      percentComplete: 100,
    });

    // Dismiss tour modal if present (appears on first login)
    await client.dismissTourModal();

    // Phase 2: Extract roster data
    reportProgress(opts.onProgress, {
      phase: 'roster',
      message: 'Navigating to roster...',
      current: 0,
      total: 1,
      percentComplete: 0,
    });

    // Navigate to roster
    await client.navigateToRoster();
    await sleep(opts.rateLimitDelay * 2); // Extra delay for page load

    // Get total count for progress reporting
    let snapshot = await client.snapshot();
    session.pagesVisited++;
    let totalMembers = getTotalMemberCount(snapshot);

    // If no members found, try refreshing/waiting for page to fully load
    if (totalMembers === 0) {
      reportProgress(opts.onProgress, {
        phase: 'roster',
        message: 'Waiting for roster to load...',
        current: 0,
        total: 1,
        percentComplete: 5,
      });

      // Wait longer and try again
      await sleep(2000);
      snapshot = await client.snapshot();
      totalMembers = getTotalMemberCount(snapshot);

      // If still no members, try clicking on Roster tab/link again
      if (totalMembers === 0) {
        await client.navigateToRoster();
        await sleep(2000);
        snapshot = await client.snapshot();
        totalMembers = getTotalMemberCount(snapshot);
      }
    }

    reportProgress(opts.onProgress, {
      phase: 'roster',
      message: `Found ${totalMembers} members. Extracting...`,
      current: 0,
      total: totalMembers || 1,
      percentComplete: 10,
    });

    // Extract roster from all pages
    let currentPage = 1;
    const totalPages = Math.ceil(totalMembers / 10) || 1;
    const maxPages = Math.max(totalPages + 2, 20); // Safety limit
    let previousMemberCount = 0;
    let stuckPageCount = 0;

    while (currentPage <= maxPages) {
      snapshot = await client.snapshot();

      // Try both parsing methods
      let pageMembers = parseRosterPage(snapshot);
      if (pageMembers.length === 0) {
        pageMembers = parseRosterFromRefs(snapshot);
      }

      rosterMembers.push(...pageMembers);

      reportProgress(opts.onProgress, {
        phase: 'roster',
        message: `Extracted page ${currentPage} of ${totalPages} (${rosterMembers.length} members)`,
        current: rosterMembers.length,
        total: totalMembers,
        percentComplete: Math.round((rosterMembers.length / Math.max(totalMembers, 1)) * 100),
      });

      // Safety check: if we're not making progress, break
      if (rosterMembers.length === previousMemberCount) {
        stuckPageCount++;
        if (stuckPageCount >= 3) {
          break;
        }
      } else {
        stuckPageCount = 0;
      }
      previousMemberCount = rosterMembers.length;

      // Check for next page
      const hasNext = hasNextPage(snapshot);

      if (!hasNext) {
        break;
      }

      const nextPageRef = findNextPageRef(snapshot);

      if (!nextPageRef) {
        break;
      }

      // Check if we've already extracted all expected members
      if (totalMembers > 0 && rosterMembers.length >= totalMembers) {
        break;
      }

      await client.click(nextPageRef);
      await sleep(opts.rateLimitDelay);
      session.pagesVisited++;
      currentPage++;
    }

    // Deduplicate by BSA member ID (handles pagination edge cases)
    const uniqueMembers = new Map<string, RosterMember>();
    for (const member of rosterMembers) {
      // Keep the first occurrence (or overwrite with later if you prefer latest)
      if (!uniqueMembers.has(member.bsaMemberId)) {
        uniqueMembers.set(member.bsaMemberId, member);
      }
    }
    const deduplicatedMembers = Array.from(uniqueMembers.values());

    // Clear and replace with deduplicated list
    rosterMembers.length = 0;
    rosterMembers.push(...deduplicatedMembers);

    session.recordsExtracted = rosterMembers.length;

    // Phase 3: Extract individual profiles (if not roster-only)
    if (!opts.rosterOnly) {
      // Scouts = YOUTH + P 18+ (scouts who aged past 18)
      const scoutMembers = rosterMembers.filter((m) => m.type === 'YOUTH' || m.type === 'P 18+');

      reportProgress(opts.onProgress, {
        phase: 'profiles',
        message: `Extracting ${scoutMembers.length} scout profiles...`,
        current: 0,
        total: scoutMembers.length,
        percentComplete: 0,
      });

      for (let i = 0; i < scoutMembers.length; i++) {
        const member = scoutMembers[i];

        try {
          // Navigate to youth profile
          // Note: This requires Unit Admin access - may fail for Committee Members
          await client.findTextAndClick(member.name);
          await sleep(opts.rateLimitDelay);
          session.pagesVisited++;

          snapshot = await client.snapshot();

          if (isYouthProfilePage(snapshot)) {
            const profile = parseYouthProfile(snapshot);
            if (profile) {
              profiles.push(profile);
            }
          }

          // Navigate back to roster
          await client.back();
          await sleep(opts.rateLimitDelay);

          reportProgress(opts.onProgress, {
            phase: 'profiles',
            message: `Extracted ${i + 1} of ${scoutMembers.length} profiles`,
            current: i + 1,
            total: scoutMembers.length,
            percentComplete: Math.round(((i + 1) / scoutMembers.length) * 100),
          });
        } catch (error) {
          // Log error but continue with other profiles
          errors.push({
            timestamp: new Date(),
            pageUrl: '',
            pageType: 'youthProfile',
            error: `Failed to extract profile for ${member.name}: ${error}`,
          });
        }
      }
    }

    // Phase 4: Complete
    session.completedAt = new Date();
    session.status = 'completed';
    session.errors = errors;

    reportProgress(opts.onProgress, {
      phase: 'complete',
      message: `Sync complete! ${rosterMembers.length} members, ${profiles.length} profiles`,
      current: 1,
      total: 1,
      percentComplete: 100,
    });

    return {
      success: true,
      session,
      rosterMembers,
      profiles,
      errors,
    };
  } catch (error) {
    session.completedAt = new Date();
    session.status = 'failed';

    const syncError: SyncError = {
      timestamp: new Date(),
      pageUrl: '',
      pageType: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };

    errors.push(syncError);
    session.errors = errors;

    return {
      success: false,
      session,
      rosterMembers,
      profiles,
      errors,
    };
  } finally {
    // Always close the browser
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Sync only roster data (faster, no individual profiles)
 */
export async function syncRosterOnly(
  options: Omit<SyncOptions, 'rosterOnly'> = {}
): Promise<SyncResult> {
  return syncFromScoutbook({ ...options, rosterOnly: true });
}

/**
 * Helper to report progress
 */
function reportProgress(
  callback: SyncOptions['onProgress'],
  progress: SyncProgress
): void {
  if (callback) {
    callback(progress);
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Match roster members to existing Chuckbox scouts by BSA ID
 */
export function matchRosterToScouts(
  rosterMembers: RosterMember[],
  existingScouts: Array<{ id: string; bsa_member_id: string | null }>
): {
  matched: Array<{ rosterId: string; scoutId: string }>;
  unmatched: RosterMember[];
} {
  const matched: Array<{ rosterId: string; scoutId: string }> = [];
  const unmatched: RosterMember[] = [];

  const scoutsByBsaId = new Map(
    existingScouts
      .filter((s) => s.bsa_member_id)
      .map((s) => [s.bsa_member_id!, s.id])
  );

  for (const member of rosterMembers) {
    const scoutId = scoutsByBsaId.get(member.bsaMemberId);
    if (scoutId) {
      matched.push({ rosterId: member.bsaMemberId, scoutId });
    } else {
      unmatched.push(member);
    }
  }

  return { matched, unmatched };
}
