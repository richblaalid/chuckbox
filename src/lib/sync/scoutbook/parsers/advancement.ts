/**
 * Advancement Data Parser
 *
 * Parses rank and merit badge requirement data from Scoutbook accessibility snapshots.
 *
 * TWO PARSING APPROACHES:
 * 1. Regex-based (RECOMMENDED): parseRankDetailsFromSnapshot, parseMeritBadgeDetailsFromSnapshot
 *    - Used by the browser extension sync flow
 *    - Fast, deterministic, no external API calls
 *    - Works with accessibility snapshot text captured by the extension
 *
 * 2. AI-powered (OPTIONAL): parseRankDetailsWithAI, parseMeritBadgeDetailsWithAI
 *    - Available as fallback for complex/malformed HTML
 *    - Requires Anthropic API key and incurs API costs
 *    - NOT used by default in the extension sync flow
 *
 * Works in conjunction with:
 * - profile.ts: Extracts rank-level progress (used first to identify what to sync)
 * - This file: Extracts requirement-level details for staging
 */

import Anthropic from '@anthropic-ai/sdk';
import { RankRequirementDetail, Requirement } from '../types';

// ============================================================================
// Types for Advancement Sync
// ============================================================================

/**
 * Parsed merit badge with individual requirement completions
 */
export interface MeritBadgeDetail {
  badgeName: string;
  normalizedName: string;
  version: string | null; // "2024" or null
  percentComplete: number;
  status: 'NOT_STARTED' | 'STARTED' | 'APPROVED' | 'AWARDED';
  startDate: string | null;
  completedDate: string | null;
  counselorName: string | null;
  requirements: MeritBadgeRequirement[];
}

/**
 * Individual merit badge requirement
 */
export interface MeritBadgeRequirement {
  id: string; // "1", "2a", "3b(1)", "6A(a)(1)"
  description: string;
  status: 'NOT_STARTED' | 'STARTED' | 'APPROVED';
  completedDate: string | null;
}

/**
 * Combined advancement data for a scout
 */
export interface ScoutAdvancementData {
  scoutBsaId: string;
  scoutName: string;
  ranks: RankRequirementDetail[];
  meritBadges: MeritBadgeDetail[];
  errors: string[];
}

// ============================================================================
// AI Parser for Rank Details
// ============================================================================

const RANK_DETAIL_SYSTEM_PROMPT = `You are a data extraction specialist. Extract rank requirement data from Scoutbook HTML or accessibility snapshot text.

Extract individual requirement completions and return as JSON with this structure:
{
  "rankName": "Tenderfoot",
  "requirementsVersion": "2022 (Active)",
  "percentComplete": 75,
  "status": "STARTED",
  "finalCompletionDate": null,
  "requirements": [
    {
      "id": "1a",
      "description": "Present yourself to your leader...",
      "status": "APPROVED",
      "completedDate": "01/20/2025",
      "commentCount": 0
    },
    {
      "id": "1b",
      "description": "Discuss how...",
      "status": "STARTED",
      "completedDate": null,
      "commentCount": 0
    }
  ]
}

Rules:
- Requirement IDs follow Scoutbook format: "1", "1a", "1b", "2", "2a", "2b(1)", etc.
- Status must be exactly "STARTED" or "APPROVED"
- completedDate format: MM/DD/YYYY or null if not completed
- If you can't determine a field, use null
- Return ONLY valid JSON. No markdown, no explanation.`;

const MERIT_BADGE_DETAIL_SYSTEM_PROMPT = `You are a data extraction specialist. Extract merit badge requirement data from Scoutbook HTML or accessibility snapshot text.

Extract individual requirement completions and return as JSON with this structure:
{
  "badgeName": "Camping",
  "normalizedName": "camping",
  "version": "2024",
  "percentComplete": 60,
  "status": "STARTED",
  "startDate": "06/01/2024",
  "completedDate": null,
  "counselorName": "John Smith",
  "requirements": [
    {
      "id": "1",
      "description": "Do the following...",
      "status": "APPROVED",
      "completedDate": "06/15/2024"
    },
    {
      "id": "2",
      "description": "On the night...",
      "status": "NOT_STARTED",
      "completedDate": null
    }
  ]
}

Rules:
- Requirement IDs follow Scoutbook format: "1", "2", "3a", "3b", "6A(a)(1)", etc.
- Status must be exactly "NOT_STARTED", "STARTED", or "APPROVED"
- completedDate format: MM/DD/YYYY or null if not completed
- normalizedName should be lowercase with underscores (e.g., "camping", "first_aid", "citizenship_in_community")
- Return ONLY valid JSON. No markdown, no explanation.`;

/**
 * Parse rank requirement details from HTML using AI
 *
 * OPTIONAL: Not used by default. The regex-based parseRankDetailsFromSnapshot
 * is preferred for the browser extension sync flow.
 */
export async function parseRankDetailsWithAI(
  anthropic: Anthropic,
  html: string,
  rankName: string
): Promise<RankRequirementDetail | null> {
  try {
    // Sanitize and truncate HTML
    const sanitized = sanitizeHtml(html);
    const truncated = sanitized.length > 100000 ? sanitized.slice(0, 100000) : sanitized;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: RANK_DETAIL_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract ${rankName} rank requirement details from:\n\n${truncated}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }

    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText) as RankRequirementDetail;
    return validateRankDetail(parsed);
  } catch (error) {
    console.error('AI rank detail parsing failed:', error);
    return null;
  }
}

/**
 * Parse merit badge requirement details from HTML using AI
 *
 * OPTIONAL: Not used by default. The regex-based parseMeritBadgeDetailsFromSnapshot
 * is preferred for the browser extension sync flow.
 */
export async function parseMeritBadgeDetailsWithAI(
  anthropic: Anthropic,
  html: string,
  badgeName: string
): Promise<MeritBadgeDetail | null> {
  try {
    // Sanitize and truncate HTML
    const sanitized = sanitizeHtml(html);
    const truncated = sanitized.length > 100000 ? sanitized.slice(0, 100000) : sanitized;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: MERIT_BADGE_DETAIL_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract ${badgeName} merit badge requirement details from:\n\n${truncated}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }

    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonText) as MeritBadgeDetail;
    return validateMeritBadgeDetail(parsed);
  } catch (error) {
    console.error('AI merit badge detail parsing failed:', error);
    return null;
  }
}

// ============================================================================
// Regex-based Fallback Parsers
// ============================================================================

/**
 * Parse rank requirements from accessibility snapshot text using regex
 * Used as fallback when AI parsing fails or for simpler structures
 */
export function parseRankDetailsFromSnapshot(
  snapshotText: string,
  rankName: string
): RankRequirementDetail | null {
  const requirements: Requirement[] = [];

  // Pattern for requirement lines in accessibility snapshot
  // Example: "1a APPROVED 01-20-2025 Present yourself to your leader..."
  // Or: "2b STARTED Present yourself..."
  const reqPattern =
    /(\d+[a-zA-Z]?(?:\([a-zA-Z0-9]+\))*)\s+(STARTED|APPROVED)\s*(?:(\d{2}-\d{2}-\d{4})\s+)?([^\n]+)/g;

  let match;
  while ((match = reqPattern.exec(snapshotText)) !== null) {
    const [, id, status, dateStr, description] = match;
    requirements.push({
      id: id.trim(),
      status: status as 'STARTED' | 'APPROVED',
      completedDate: dateStr ? dateStr.replace(/-/g, '/') : null,
      description: description.trim(),
      commentCount: 0,
    });
  }

  if (requirements.length === 0) {
    return null;
  }

  // Calculate percent complete
  const completed = requirements.filter((r) => r.status === 'APPROVED').length;
  const percentComplete = Math.round((completed / requirements.length) * 100);

  // Determine overall status
  let status: 'STARTED' | 'APPROVED' | 'AWARDED' = 'STARTED';
  if (percentComplete === 100) {
    // Check if awarded - look for "AWARDED" in text
    if (snapshotText.includes('AWARDED')) {
      status = 'AWARDED';
    } else {
      status = 'APPROVED';
    }
  }

  return {
    rankName,
    requirementsVersion: extractVersion(snapshotText),
    percentComplete,
    status,
    finalCompletionDate: null,
    requirements,
  };
}

/**
 * Parse merit badge requirements from accessibility snapshot text using regex
 */
export function parseMeritBadgeDetailsFromSnapshot(
  snapshotText: string,
  badgeName: string
): MeritBadgeDetail | null {
  const requirements: MeritBadgeRequirement[] = [];

  // Pattern for requirement lines
  // Example: "1 APPROVED 01-15-2025 Do the following..."
  // Or: "3a NOT_STARTED Explain how..."
  const reqPattern =
    /(\d+[a-zA-Z]?(?:\([a-zA-Z0-9]+\))*)\s+(NOT_STARTED|STARTED|APPROVED)\s*(?:(\d{2}-\d{2}-\d{4})\s+)?([^\n]+)/g;

  let match;
  while ((match = reqPattern.exec(snapshotText)) !== null) {
    const [, id, status, dateStr, description] = match;
    requirements.push({
      id: id.trim(),
      description: description.trim(),
      status: status as 'NOT_STARTED' | 'STARTED' | 'APPROVED',
      completedDate: dateStr ? dateStr.replace(/-/g, '/') : null,
    });
  }

  if (requirements.length === 0) {
    return null;
  }

  // Calculate percent complete
  const completed = requirements.filter((r) => r.status === 'APPROVED').length;
  const percentComplete = Math.round((completed / requirements.length) * 100);

  // Determine overall status
  let status: 'NOT_STARTED' | 'STARTED' | 'APPROVED' | 'AWARDED' = 'STARTED';
  if (percentComplete === 0) {
    status = 'NOT_STARTED';
  } else if (percentComplete === 100) {
    if (snapshotText.includes('AWARDED')) {
      status = 'AWARDED';
    } else {
      status = 'APPROVED';
    }
  }

  return {
    badgeName,
    normalizedName: normalizeBadgeName(badgeName),
    version: extractVersion(snapshotText),
    percentComplete,
    status,
    startDate: null,
    completedDate: null,
    counselorName: extractCounselorName(snapshotText),
    requirements,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sanitize HTML by removing scripts, styles, and excessive whitespace
 */
function sanitizeHtml(html: string): string {
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
  sanitized = sanitized.replace(/\s+/g, ' ');
  return sanitized.trim();
}

/**
 * Extract version year from text
 */
function extractVersion(text: string): string {
  const match = text.match(/(\d{4})\s*(?:Version|\(Active\))/i);
  return match ? match[1] : '2024';
}

/**
 * Extract counselor name from merit badge text
 */
function extractCounselorName(text: string): string | null {
  const match = text.match(/Counselor[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  return match ? match[1] : null;
}

/**
 * Normalize badge name to lowercase with underscores
 */
function normalizeBadgeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Validate and clean up parsed rank detail
 */
function validateRankDetail(data: RankRequirementDetail): RankRequirementDetail | null {
  if (!data.rankName || !Array.isArray(data.requirements)) {
    return null;
  }

  return {
    rankName: data.rankName,
    requirementsVersion: data.requirementsVersion || '2024',
    percentComplete: data.percentComplete || 0,
    status: data.status || 'STARTED',
    finalCompletionDate: data.finalCompletionDate || null,
    requirements: data.requirements.map((req) => ({
      id: req.id || '?',
      status: req.status || 'STARTED',
      completedDate: req.completedDate || null,
      description: req.description || '',
      commentCount: req.commentCount || 0,
    })),
  };
}

/**
 * Validate and clean up parsed merit badge detail
 */
function validateMeritBadgeDetail(data: MeritBadgeDetail): MeritBadgeDetail | null {
  if (!data.badgeName || !Array.isArray(data.requirements)) {
    return null;
  }

  return {
    badgeName: data.badgeName,
    normalizedName: data.normalizedName || normalizeBadgeName(data.badgeName),
    version: data.version || null,
    percentComplete: data.percentComplete || 0,
    status: data.status || 'STARTED',
    startDate: data.startDate || null,
    completedDate: data.completedDate || null,
    counselorName: data.counselorName || null,
    requirements: data.requirements.map((req) => ({
      id: req.id || '?',
      description: req.description || '',
      status: req.status || 'NOT_STARTED',
      completedDate: req.completedDate || null,
    })),
  };
}
