/**
 * Roster Page Parser
 *
 * Extracts roster member data from Scoutbook Plus accessibility snapshots.
 * Handles the paginated roster table at /roster.
 */

import { AgentBrowserSnapshot, RosterMember, SnapshotRef } from '../types';

/**
 * Parse roster members from a snapshot
 * The roster is displayed as a table with rows containing member data
 */
export function parseRosterPage(snapshot: AgentBrowserSnapshot): RosterMember[] {
  const members: RosterMember[] = [];
  const refs = snapshot.data?.refs || {};
  const snapshotText = snapshot.data?.snapshot || '';

  // Parse the snapshot text to find table rows
  // Each row contains: Name, Member ID, Type, Age, Last Rank, Patrol, Position, Renewal Status, Expiration Date
  const rows = extractTableRows(snapshotText);

  for (const row of rows) {
    const member = parseRosterRow(row, refs);
    if (member) {
      members.push(member);
    }
  }

  return members;
}

/**
 * Extract table row data from snapshot text
 * Rows are identified by the pattern: row "Name MemberID Type Age Rank Patrol Position Status Date"
 */
function extractTableRows(snapshotText: string): string[] {
  const rows: string[] = [];

  // Match row elements that contain member data
  // Pattern: row "Name ID Type Age Rank Patrol Position Status ExpirationDate"
  const rowRegex = /row "([^"]+)"/g;
  let match;

  while ((match = rowRegex.exec(snapshotText)) !== null) {
    const rowContent = match[1];

    // Skip header row
    if (
      rowContent.includes('Name Member ID Type') ||
      rowContent.includes('columnheader')
    ) {
      continue;
    }

    // Only include rows that look like member data (have BSA ID pattern)
    if (/\d{9}/.test(rowContent)) {
      rows.push(rowContent);
    }
  }

  return rows;
}

/**
 * Parse a single roster row into a RosterMember
 */
function parseRosterRow(
  rowContent: string,
  _refs: Record<string, SnapshotRef>
): RosterMember | null {
  // Row format example:
  // "George Anderson 133456904 YOUTH 15 Life Scout Flaring Phoenix 1Senior Patrol Leader Current 8/31/2026"

  // Extract BSA Member ID (9 digits)
  const bsaIdMatch = rowContent.match(/\b(\d{9})\b/);
  if (!bsaIdMatch) {
    return null;
  }

  const bsaMemberId = bsaIdMatch[1];

  // Split the row content to extract fields
  // Name is everything before the BSA ID
  const bsaIdIndex = rowContent.indexOf(bsaMemberId);
  const name = rowContent.substring(0, bsaIdIndex).trim();

  // Rest is after the BSA ID
  const rest = rowContent.substring(bsaIdIndex + 9).trim();

  // Parse type (YOUTH, LEADER, P 18+)
  let type: 'YOUTH' | 'LEADER' | 'P 18+' = 'YOUTH';
  if (rest.includes('LEADER')) {
    type = 'LEADER';
  } else if (rest.includes('P 18+')) {
    type = 'P 18+';
  }

  // Extract age
  const ageMatch = rest.match(/\b(\d{1,2}|\(21\+\))\b/);
  const age = ageMatch ? ageMatch[1] : '';

  // Extract expiration date (M/D/YYYY or MM/DD/YYYY at the end)
  const dateMatch = rest.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
  const expirationDate = dateMatch ? dateMatch[1] : '';

  // Extract renewal status (before the date)
  const renewalStatuses = [
    'Current',
    'Eligible to Renew',
    'Current (Over 18)',
    'Expired',
    'Dropped',
  ];
  let renewalStatus = 'Current';
  for (const status of renewalStatuses) {
    if (rest.includes(status)) {
      renewalStatus = status;
      break;
    }
  }

  // Extract rank (common Scout ranks)
  const ranks = [
    'Eagle Scout',
    'Life Scout',
    'Star Scout',
    'First Class',
    'Second Class',
    'Tenderfoot',
    'Scout',
  ];
  let lastRankApproved: string | null = null;
  for (const rank of ranks) {
    if (rest.includes(rank)) {
      lastRankApproved = rank;
      break;
    }
  }

  // Extract patrol (typically capitalized words before position)
  // Common patrols found in our exploration
  const patrolMatch = rest.match(
    /(Blazing Bulls|Flaring Phoenix|Cobra|Dragon|unassigned)/i
  );
  const patrol = patrolMatch ? patrolMatch[1] : null;

  // Extract positions (up to 2)
  // Order matters: longer/more specific positions must come first to prevent
  // substring matching issues (e.g., "Senior Patrol Leader" before "Patrol Leader")
  const knownPositions = [
    'Assistant Senior Patrol Leader',
    'Senior Patrol Leader',
    'Assistant Patrol Leader',
    'Patrol Leader',
    'Junior Assistant Scoutmaster',
    'Assistant Scoutmaster',
    'Scoutmaster',
    'Committee Chair',
    'Committee Member',
    'Order of the Arrow Representative',
    'Outdoor Ethics Guide',
    'Leave No Trace Trainer',
    'Troop Guide',
    'Den Chief',
    'Scribe',
    'Quartermaster',
    'Historian',
    'Librarian',
    'Chaplain Aide',
    'Instructor',
    'Webmaster',
    'Youth Member',
    'Bugler',
  ];

  // Scoutbook roster shows positions with a count prefix like "2Den Chief" meaning
  // the scout has 2 positions total, with Den Chief being the one displayed.
  // The other position(s) are only visible on hover, which we can't capture.
  //
  // Format: <count><PositionName> where count is the total number of positions
  // We extract the visible position and note the count for reference.

  let position: string | null = null;
  const position2: string | null = null;

  for (const pos of knownPositions) {
    const escapedPos = pos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: optional digit prefix (position count) followed by position name
    const posRegex = new RegExp(`(\\d)?${escapedPos}(?:[^a-zA-Z]|$)`, 'i');
    const match = rest.match(posRegex);

    if (match) {
      position = pos;
      break; // Only one position is visible in roster view
    }
  }

  // Note: position2 will always be null from roster view since Scoutbook
  // only displays one position. To get all positions, need to navigate to individual profile pages.

  return {
    name,
    bsaMemberId,
    type,
    age,
    lastRankApproved,
    patrol,
    position,
    position2,
    renewalStatus,
    expirationDate,
  };
}

/**
 * Alternative parser that uses refs directly
 * This extracts member data from the accessibility refs instead of snapshot text
 */
export function parseRosterFromRefs(
  snapshot: AgentBrowserSnapshot
): RosterMember[] {
  const members: RosterMember[] = [];
  const refs = snapshot.data?.refs || {};

  // Group refs by what appears to be rows
  // Each member row has cells with specific patterns
  const cellRefs = Object.entries(refs).filter(
    ([, ref]) => ref.role === 'cell' && ref.name
  );

  // Find all BSA IDs (9-digit numbers)
  const bsaIdRefs = cellRefs.filter(([, ref]) =>
    ref.name && /^\d{9}$/.test(ref.name)
  );

  for (const [bsaIdKey, bsaIdRef] of bsaIdRefs) {
    // Extract numeric key to find adjacent cells
    const keyNum = parseInt(bsaIdKey.replace('e', ''), 10);

    // Look for name (typically 1 cell before BSA ID)
    const nameRef = refs[`e${keyNum - 1}`];
    const name = nameRef?.name || '';

    // Look for type (typically 1 cell after BSA ID)
    const typeRef = refs[`e${keyNum + 1}`];
    const typeStr = typeRef?.name || '';
    let type: 'YOUTH' | 'LEADER' | 'P 18+' = 'YOUTH';
    if (typeStr === 'LEADER') type = 'LEADER';
    else if (typeStr === 'P 18+') type = 'P 18+';

    // Look for age (typically 2 cells after BSA ID)
    const ageRef = refs[`e${keyNum + 2}`];
    const age = ageRef?.name || '';

    // Continue pattern for other fields...
    const rankRef = refs[`e${keyNum + 3}`];
    const patrolRef = refs[`e${keyNum + 4}`];
    const positionRef = refs[`e${keyNum + 5}`];
    const statusRef = refs[`e${keyNum + 6}`];
    // Note: There might be a "dropping" switch cell in between
    const dateRef = refs[`e${keyNum + 8}`] || refs[`e${keyNum + 7}`];

    // Position might be in one cell or split across cells
    const position2Ref = refs[`e${keyNum + 6}`];

    members.push({
      name,
      bsaMemberId: bsaIdRef.name!,
      type,
      age,
      lastRankApproved: rankRef?.name || null,
      patrol: patrolRef?.name || null,
      position: positionRef?.name || null,
      position2: position2Ref?.name && position2Ref.name !== statusRef?.name ? position2Ref.name : null,
      renewalStatus: statusRef?.name || 'Current',
      expirationDate: dateRef?.name || '',
    });
  }

  return members;
}

/**
 * Check if there's a next page in pagination
 */
export function hasNextPage(snapshot: AgentBrowserSnapshot): boolean {
  const refs = snapshot.data?.refs || {};
  return Object.values(refs).some(
    (ref: SnapshotRef) => ref.name === 'Next Page' && ref.role === 'listitem'
  );
}

/**
 * Find the "Next Page" ref for pagination
 */
export function findNextPageRef(
  snapshot: AgentBrowserSnapshot
): string | null {
  const refs = snapshot.data?.refs || {};
  const entry = Object.entries(refs).find(
    ([, ref]) => ref.name === 'Next Page' && ref.role === 'listitem'
  );
  return entry ? `@${entry[0]}` : null;
}

/**
 * Get total member count from roster page
 */
export function getTotalMemberCount(snapshot: AgentBrowserSnapshot): number {
  const snapshotText = snapshot.data?.snapshot || '';

  // Look for "Total X Items" text
  const match = snapshotText.match(/Total (\d+) Items/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Get current page number from roster
 */
export function getCurrentPage(snapshot: AgentBrowserSnapshot): number {
  const refs = snapshot.data?.refs || {};

  // Look for selected page number in pagination
  // The current page listitem will have different styling
  const snapshotText = snapshot.data?.snapshot || '';

  // Find the currently selected page (usually has a different state)
  const pageMatch = snapshotText.match(/listitem "(\d+)"[^\n]*\[selected\]/);
  if (pageMatch) {
    return parseInt(pageMatch[1], 10);
  }

  // Default to page 1
  return 1;
}
