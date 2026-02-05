/**
 * AI-Powered Roster HTML Parser
 *
 * Uses Claude AI to extract structured roster data from Scoutbook HTML.
 * Falls back to regex parsing on failure.
 */

import Anthropic from '@anthropic-ai/sdk'
import { RosterMember } from './types'

const MAX_HTML_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Sanitize HTML by removing scripts and keeping table structure
 */
function sanitizeHtml(html: string): string {
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '')
  sanitized = sanitized.replace(/\s+/g, ' ')
  return sanitized.trim()
}

/**
 * Extract just the roster table section from full HTML
 */
function extractRosterTable(html: string): string {
  const tablePatterns = [
    /<table[^>]*class="[^"]*roster[^"]*"[^>]*>[\s\S]*?<\/table>/i,
    /<table[^>]*id="[^"]*roster[^"]*"[^>]*>[\s\S]*?<\/table>/i,
    /<table[^>]*>[\s\S]*?Member[\s\S]*?<\/table>/i,
  ]

  for (const pattern of tablePatterns) {
    const match = html.match(pattern)
    if (match) return match[0]
  }

  const tables = html.match(/<table[\s\S]*?<\/table>/gi)
  if (tables && tables.length > 0) {
    return tables.reduce((a, b) => (a.length > b.length ? a : b))
  }

  return html
}

const SYSTEM_PROMPT = `You are a data extraction specialist. Extract structured roster data from Scoutbook HTML tables.

Extract all roster members and return as a JSON array with these fields:
- name: Full name (e.g., "Smith, John")
- bsaMemberId: BSA Member ID (7+ digit number)
- type: Exactly "YOUTH", "LEADER", or "P 18+"
- age: Age as string (e.g., "15", "21+")
- lastRankApproved: Rank (e.g., "Life Scout", "First Class", null if none)
- patrol: Patrol name - IMPORTANT: look in the Patrol column. Return the value exactly as shown (e.g., "Cobra", "Flaring Phoenix", or "Eagle Patrol"). Do NOT add "Patrol" suffix. Return null if "unassigned" or empty.
- position: Primary position (e.g., "Senior Patrol Leader", "Patrol Leader", null if none)
- position2: Secondary position (null if none)
- renewalStatus: "Current", "Eligible to Renew", "Expired", or "Dropped"
- expirationDate: Date string (e.g., "8/31/2026")

IMPORTANT: The HTML contains a table with columns. Each column has a header. Look at column headers to identify what data is in each column. The Patrol column contains the patrol assignment for youth members.

Return ONLY valid JSON array. No markdown, no explanation.`

interface AIParserResult {
  members: RosterMember[]
  usedAI: boolean
  error?: string
}

async function parsePageWithAI(
  anthropic: Anthropic,
  pageHtml: string,
  pageNumber: number
): Promise<RosterMember[]> {
  const sanitized = sanitizeHtml(pageHtml)
  const tableHtml = extractRosterTable(sanitized)
  const truncated = tableHtml.length > 150000 ? tableHtml.slice(0, 150000) : tableHtml

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Extract roster members from:\n\n${truncated}` }],
  })

  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  let jsonText = textContent.text.trim()
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) throw new Error('AI response is not an array')

  return parsed
    .map((m: Record<string, unknown>) => ({
      name: String(m.name || ''),
      bsaMemberId: String(m.bsaMemberId || ''),
      type: normalizeType(String(m.type || 'YOUTH')),
      age: String(m.age || ''),
      lastRankApproved: m.lastRankApproved ? String(m.lastRankApproved) : null,
      patrol: m.patrol ? String(m.patrol) : null,
      position: m.position ? String(m.position) : null,
      position2: m.position2 ? String(m.position2) : null,
      renewalStatus: String(m.renewalStatus || 'Current'),
      expirationDate: String(m.expirationDate || ''),
    }))
    .filter((m: RosterMember) => m.name && m.bsaMemberId)
}

export async function parseRosterHtmlWithAI(html: string): Promise<AIParserResult> {
  if (html.length > MAX_HTML_SIZE) {
    return { members: [], usedAI: false, error: `HTML exceeds maximum size` }
  }

  // AI parsing temporarily disabled - use HTML parser directly
  // TODO: Re-enable AI parsing when ready for production
  return parseRosterHtmlWithRegex(html)

  /* AI parsing commented out for now
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[AI Parser] ANTHROPIC_API_KEY not set, using regex fallback')
    return parseRosterHtmlWithRegex(html)
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const pages = html.split(/<!--\s*PAGE\s*BREAK\s*-->/i).filter((p) => p.trim().length > 0)

    console.log(`[AI Parser] Processing ${pages.length} page(s)`)

    const allMembers: RosterMember[] = []
    const seenBsaIds = new Set<string>()

    for (let i = 0; i < pages.length; i++) {
      try {
        const pageMembers = await parsePageWithAI(anthropic, pages[i], i + 1)
        console.log(`[AI Parser] Page ${i + 1}: extracted ${pageMembers.length} members`)

        for (const member of pageMembers) {
          if (!seenBsaIds.has(member.bsaMemberId)) {
            seenBsaIds.add(member.bsaMemberId)
            allMembers.push(member)
          }
        }
      } catch (pageError) {
        console.error(`[AI Parser] Error on page ${i + 1}:`, pageError)
      }
    }

    console.log(`[AI Parser] Successfully extracted ${allMembers.length} total members`)

    if (allMembers.length === 0 && pages.length > 0) {
      console.log('[AI Parser] AI returned 0 members, falling back to regex')
      return { ...parseRosterHtmlWithRegex(html), error: 'AI failed, used regex fallback' }
    }

    return { members: allMembers, usedAI: true }
  } catch (error) {
    console.error('[AI Parser] Error:', error)
    return { ...parseRosterHtmlWithRegex(html), error: String(error) }
  }
  */ // End of commented-out AI parsing
}

function normalizeType(type: string): 'YOUTH' | 'LEADER' | 'P 18+' {
  const upper = type.toUpperCase()
  if (upper === 'LEADER' || upper.includes('LEADER')) return 'LEADER'
  if (upper.includes('P 18+') || upper.includes('18+')) return 'P 18+'
  return 'YOUTH'
}

// ============================================================================
// SIMPLIFIED REGEX PARSER - Uses exact string matching like the CLI parser
// ============================================================================

// Known ranks in order of precedence (check longer/more specific first)
const KNOWN_RANKS = [
  'Eagle Scout',
  'Life Scout',
  'Star Scout',
  'First Class',
  'Second Class',
  'Tenderfoot',
  'Scout',
  'Arrow of Light',
  'Webelos',
  'Bear',
  'Wolf',
  'Tiger',
  'Lion',
]

// Known positions in order of precedence (longer/more specific first)
const KNOWN_POSITIONS = [
  // Youth positions
  'Assistant Senior Patrol Leader',
  'Senior Patrol Leader',
  'Assistant Patrol Leader',
  'Patrol Leader',
  'Junior Assistant Scoutmaster',
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
  'Bugler',
  // Adult positions
  'Assistant Scoutmaster',
  'Scoutmaster',
  'Committee Chair',
  'Committee Member',
  'Chartered Organization Rep',
  'Advancement Chair',
  'Treasurer',
  'Secretary',
  'Cubmaster',
  'Den Leader',
  'Pack Trainer',
]

// Known types
const KNOWN_TYPES = ['YOUTH', 'LEADER', 'P 18+'] as const

// Known renewal statuses
const KNOWN_STATUSES = ['Current', 'Eligible to Renew', 'Expired', 'Dropped']

/**
 * Extract type using simple string matching
 */
function extractType(text: string): 'YOUTH' | 'LEADER' | 'P 18+' {
  // Check for explicit type values
  if (text.includes('LEADER')) return 'LEADER'
  if (text.includes('P 18+')) return 'P 18+'
  if (text.includes('YOUTH')) return 'YOUTH'
  return 'YOUTH' // Default
}

/**
 * Extract rank using simple string matching (exact phrases only)
 */
function extractRank(text: string): string | null {
  for (const rank of KNOWN_RANKS) {
    if (text.includes(rank)) {
      return rank
    }
  }
  return null
}

/**
 * Extract positions using simple string matching
 * Returns up to 2 positions
 */
function extractPositions(text: string): { position: string | null; position2: string | null } {
  const found: string[] = []
  let remaining = text

  for (const pos of KNOWN_POSITIONS) {
    if (remaining.includes(pos)) {
      found.push(pos)
      // Remove matched text to prevent substring matches
      remaining = remaining.replace(pos, '')
      if (found.length >= 2) break
    }
  }

  return {
    position: found[0] || null,
    position2: found[1] || null,
  }
}

/**
 * Extract renewal status using simple string matching
 */
function extractStatus(text: string): string {
  for (const status of KNOWN_STATUSES) {
    if (text.includes(status)) return status
  }
  return 'Current'
}

/**
 * Extract expiration date
 */
function extractDate(text: string): string {
  const match = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  return match ? match[1] : ''
}

/**
 * Extract age
 */
function extractAge(text: string): string {
  // Match age in parentheses like (15) or (21+)
  const parenMatch = text.match(/\((\d{1,2}\+?)\)/)
  if (parenMatch) return parenMatch[1]

  // Match standalone 2-digit number that looks like an age (10-99)
  const ageMatch = text.match(/\b([1-9]\d)\b/)
  return ageMatch ? ageMatch[1] : ''
}

/**
 * Extract patrol name
 * Patrols are named like "Eagle Patrol", "Cobra Patrol", etc.
 * Must exclude positions like "Patrol Leader", "Assistant Patrol Leader"
 */
function extractPatrol(text: string): string | null {
  // Check for "unassigned" first
  if (text.toLowerCase().includes('unassigned')) {
    return null
  }

  // Positions that contain "Patrol" - must be excluded
  const positionPatterns = [
    'Patrol Leader',
    'Assistant Patrol Leader',
    'Senior Patrol Leader',
    'Assistant Senior Patrol Leader',
  ]

  // Remove position text to avoid false matches
  let cleanText = text
  for (const pos of positionPatterns) {
    cleanText = cleanText.replace(new RegExp(pos, 'gi'), '')
  }

  // Match "X Patrol" pattern - patrol name should be a word/phrase before "Patrol"
  // Common patrol names: Eagle, Wolf, Bear, Cobra, Dragon, Phoenix, Hawk, etc.
  const patrolMatch = cleanText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+Patrol\b/i)
  if (patrolMatch) {
    const patrolName = patrolMatch[1].trim()
    // Exclude if it looks like a number prefix (e.g., "1 Patrol" or "2 Patrol")
    if (/^\d+$/.test(patrolName)) {
      return null
    }
    // Return just the patrol name without "Patrol" suffix to avoid duplicates
    return patrolName
  }

  return null
}

/**
 * Extract text content from HTML, stripping tags
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract table cells from a row (handles both td and th elements)
 */
function extractCells(rowHtml: string): string[] {
  const cells: string[] = []
  // Match both <td> and <th> elements
  const cellMatches = rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)
  for (const match of cellMatches) {
    cells.push(stripHtml(match[1]))
  }
  return cells
}

// Common patrol name words (nature/animal themed)
const PATROL_KEYWORDS = [
  'phoenix', 'cobra', 'dragon', 'eagle', 'wolf', 'bear', 'hawk', 'falcon', 'tiger',
  'lion', 'panther', 'buffalo', 'bull', 'bulls', 'fox', 'owl', 'raven', 'shark',
  'scorpion', 'viper', 'mustang', 'stallion', 'bronco', 'thunder', 'lightning',
  'flame', 'flaming', 'flaring', 'blazing', 'burning', 'fire', 'storm', 'shadow',
  'silver', 'golden', 'red', 'blue', 'green', 'black', 'white',
]

/**
 * Identify patrol from a cell value
 * Returns the patrol name as-is from Scoutbook (without appending "Patrol" suffix)
 */
function identifyPatrol(cellValue: string): string | null {
  const value = cellValue.trim()
  if (!value || value.toLowerCase() === 'unassigned' || value === '-') {
    return null
  }

  // If it contains "Patrol" (like "Eagle Patrol" or ends with "Patrol"), it's likely a patrol
  if (/patrol/i.test(value)) {
    return value
  }

  // Check if this looks like a patrol name (contains patrol keywords)
  const lowerValue = value.toLowerCase()
  const words = lowerValue.split(/\s+/)

  const hasPatrolKeyword = words.some(word => PATROL_KEYWORDS.includes(word))

  if (hasPatrolKeyword) {
    // Return as-is without appending "Patrol" - avoids duplicates with existing patrols
    return value
  }

  // Single word that's capitalized and not a common name/type/rank/status
  // This catches custom patrol names like "Scorpions" or "Vikings"
  if (/^[A-Z][a-z]+s?$/.test(value) && value.length >= 4 && value.length <= 15) {
    // Exclude things that are clearly NOT patrols
    const excludePatterns = [
      'YOUTH', 'LEADER', 'Current', 'Expired', 'Dropped',
      'Scout', 'Life', 'Star', 'Eagle', 'First', 'Second', 'Tenderfoot',
    ]
    if (!excludePatterns.some(p => value.includes(p))) {
      // This might be a patrol name, but we're not sure - return null to be safe
      // Only match if it's in the designated patrol column
      return null
    }
  }

  return null
}

/**
 * Try to identify column indices from header row
 */
interface ColumnMap {
  name?: number
  bsaId?: number
  type?: number
  age?: number
  rank?: number
  patrol?: number
  position?: number
  status?: number
  expiration?: number
}

function identifyColumnsFromHeaders(headerCells: string[]): ColumnMap {
  const map: ColumnMap = {}

  headerCells.forEach((cell, idx) => {
    const lower = cell.toLowerCase()
    if (lower.includes('name') || lower === 'member') map.name = idx
    else if (lower.includes('bsa') || lower === 'id' || lower.includes('member id')) map.bsaId = idx
    else if (lower === 'type' || lower.includes('member type')) map.type = idx
    else if (lower === 'age') map.age = idx
    else if (lower.includes('rank')) map.rank = idx
    else if (lower.includes('patrol')) map.patrol = idx
    else if (lower.includes('position')) map.position = idx
    else if (lower.includes('status') || lower.includes('renewal')) map.status = idx
    else if (lower.includes('expir') || lower.includes('date')) map.expiration = idx
  })

  return map
}

/**
 * Try to identify column indices from data row patterns
 * This is a fallback when headers aren't detected
 */
function identifyColumnsFromData(dataCells: string[]): ColumnMap {
  const map: ColumnMap = {}

  dataCells.forEach((cell, idx) => {
    const value = cell.trim()
    if (!value) return

    // BSA ID: 7+ digit number
    if (/^\d{7,}$/.test(value) && map.bsaId === undefined) {
      map.bsaId = idx
    }
    // Type: YOUTH, LEADER, or P 18+
    else if (['YOUTH', 'LEADER', 'P 18+'].includes(value) && map.type === undefined) {
      map.type = idx
    }
    // Age: 1-2 digit number (10-99 typically)
    else if (/^[1-9]\d$/.test(value) && map.age === undefined) {
      map.age = idx
    }
    // Rank: known scout ranks
    else if (KNOWN_RANKS.some(r => value === r) && map.rank === undefined) {
      map.rank = idx
    }
    // Status: known renewal statuses
    else if (KNOWN_STATUSES.some(s => value === s) && map.status === undefined) {
      map.status = idx
    }
    // Expiration date: MM/DD/YYYY pattern
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value) && map.expiration === undefined) {
      map.expiration = idx
    }
  })

  // Infer patrol and name columns based on position relative to known columns
  // Name is typically before BSA ID, Patrol is typically after rank
  if (map.bsaId !== undefined && map.name === undefined) {
    // Name is usually 1-2 columns before BSA ID
    for (let i = map.bsaId - 1; i >= 0 && i >= map.bsaId - 2; i--) {
      if (dataCells[i] && dataCells[i].includes(',')) {
        map.name = i
        break
      } else if (dataCells[i] && dataCells[i].trim().length > 3) {
        map.name = i
        break
      }
    }
  }

  // Patrol is typically the column after rank
  if (map.rank !== undefined && map.patrol === undefined) {
    const potentialPatrolIdx = map.rank + 1
    if (potentialPatrolIdx < dataCells.length) {
      const value = dataCells[potentialPatrolIdx]?.trim()
      if (value && !['YOUTH', 'LEADER', 'P 18+'].includes(value) && !/^\d+$/.test(value)) {
        map.patrol = potentialPatrolIdx
      }
    }
  }

  // Position is typically after patrol (or after rank if no patrol)
  const positionStart = (map.patrol ?? map.rank ?? map.age ?? map.type ?? map.bsaId ?? 0) + 1
  for (let i = positionStart; i < dataCells.length; i++) {
    if (i === map.status || i === map.expiration) continue
    const value = dataCells[i]?.trim()
    if (value && KNOWN_POSITIONS.some(p => value.includes(p))) {
      map.position = i
      break
    }
  }

  return map
}

/**
 * Column-aware regex-based parser
 * Extracts data from individual table cells for accurate field mapping
 */
function parseRosterHtmlWithRegex(html: string): AIParserResult {
  const members: RosterMember[] = []
  const seenBsaIds = new Set<string>()

  try {
    // Extract all table rows
    const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]

    // Try to identify column mapping from first row (header)
    let columnMap: ColumnMap = {}
    if (rowMatches.length > 0) {
      const headerCells = extractCells(rowMatches[0][1])
      columnMap = identifyColumnsFromHeaders(headerCells)

      // If header detection failed, try to infer from first data row
      if (Object.keys(columnMap).length === 0 && rowMatches.length > 1) {
        const dataCells = extractCells(rowMatches[1][1])
        columnMap = identifyColumnsFromData(dataCells)
      }
    }

    for (let rowIdx = 0; rowIdx < rowMatches.length; rowIdx++) {
      const rowHtml = rowMatches[rowIdx][1]
      const cells = extractCells(rowHtml)

      // Also get the full row text for fallback extraction
      const rowText = stripHtml(rowHtml)

      // Extract BSA Member ID - try column first, then scan all cells, then full text
      let bsaMemberId: string | null = null

      if (columnMap.bsaId !== undefined && cells[columnMap.bsaId]) {
        const match = cells[columnMap.bsaId].match(/\b(\d{7,})\b/)
        if (match) bsaMemberId = match[1]
      }

      if (!bsaMemberId) {
        // Scan all cells for BSA ID
        for (const cell of cells) {
          const match = cell.match(/\b(\d{7,})\b/)
          if (match) {
            bsaMemberId = match[1]
            break
          }
        }
      }

      if (!bsaMemberId) {
        // Fallback: scan full row text
        const match = rowText.match(/\b(\d{7,})\b/)
        if (match) bsaMemberId = match[1]
      }

      if (!bsaMemberId) continue

      // Skip duplicates
      if (seenBsaIds.has(bsaMemberId)) continue
      seenBsaIds.add(bsaMemberId)

      // Extract name - try column first, then text before BSA ID
      let name = ''
      if (columnMap.name !== undefined && cells[columnMap.name]) {
        name = cells[columnMap.name].trim()
      }
      if (!name) {
        const bsaIdIndex = rowText.indexOf(bsaMemberId)
        name = rowText.substring(0, bsaIdIndex).replace(/\s+/g, ' ').trim()
      }
      if (!name || name.length < 2) continue

      // Extract member type
      let memberType: 'YOUTH' | 'LEADER' | 'P 18+' = 'YOUTH'
      if (columnMap.type !== undefined && cells[columnMap.type]) {
        memberType = extractType(cells[columnMap.type])
      } else {
        memberType = extractType(rowText)
      }

      const isScout = memberType === 'YOUTH' || memberType === 'P 18+'

      // Extract patrol - CRITICAL: use patrol column when identified
      let patrol: string | null = null
      if (columnMap.patrol !== undefined && cells[columnMap.patrol]) {
        // Direct column access - most reliable
        const patrolCell = cells[columnMap.patrol].trim()
        if (patrolCell && patrolCell.toLowerCase() !== 'unassigned' && patrolCell !== '-') {
          // Use patrol name as-is from Scoutbook (don't append "Patrol" - causes duplicates)
          patrol = patrolCell
        }
      }
      if (!patrol && isScout) {
        // Build set of all known column indices to skip
        const knownColumns = new Set<number>()
        if (columnMap.name !== undefined) knownColumns.add(columnMap.name)
        if (columnMap.bsaId !== undefined) knownColumns.add(columnMap.bsaId)
        if (columnMap.type !== undefined) knownColumns.add(columnMap.type)
        if (columnMap.age !== undefined) knownColumns.add(columnMap.age)
        if (columnMap.rank !== undefined) knownColumns.add(columnMap.rank)
        if (columnMap.position !== undefined) knownColumns.add(columnMap.position)
        if (columnMap.status !== undefined) knownColumns.add(columnMap.status)
        if (columnMap.expiration !== undefined) knownColumns.add(columnMap.expiration)

        // Scan remaining cells for patrol-looking values
        for (let i = 0; i < cells.length; i++) {
          if (knownColumns.has(i)) continue
          const identified = identifyPatrol(cells[i])
          if (identified) {
            patrol = identified
            break
          }
        }
      }
      if (!patrol && isScout) {
        // Fallback to pattern matching in full text
        patrol = extractPatrol(rowText)
      }

      // Extract rank
      let rank: string | null = null
      if (columnMap.rank !== undefined && cells[columnMap.rank]) {
        rank = extractRank(cells[columnMap.rank])
      }
      if (!rank && isScout) {
        rank = extractRank(rowText)
      }

      // Extract age
      let age = ''
      if (columnMap.age !== undefined && cells[columnMap.age]) {
        age = cells[columnMap.age].replace(/[^\d+]/g, '')
      }
      if (!age) {
        age = extractAge(rowText)
      }

      // Extract positions
      let positions = { position: null as string | null, position2: null as string | null }
      if (columnMap.position !== undefined && cells[columnMap.position]) {
        positions = extractPositions(cells[columnMap.position])
      }
      if (!positions.position) {
        positions = extractPositions(rowText)
      }

      // Extract renewal status
      let renewalStatus = 'Current'
      if (columnMap.status !== undefined && cells[columnMap.status]) {
        renewalStatus = extractStatus(cells[columnMap.status])
      } else {
        renewalStatus = extractStatus(rowText)
      }

      // Extract expiration date
      let expirationDate = ''
      if (columnMap.expiration !== undefined && cells[columnMap.expiration]) {
        expirationDate = extractDate(cells[columnMap.expiration])
      }
      if (!expirationDate) {
        expirationDate = extractDate(rowText)
      }

      // Debug log first 3 scouts
      if (isScout && members.filter(m => m.type !== 'LEADER').length < 3) {
        console.error(`[Regex Parser DEBUG] Scout: ${name}`)
        console.error(`  Cells: ${JSON.stringify(cells.slice(0, 10))}`)
        console.error(`  Extracted -> patrol: ${patrol}, rank: ${rank}, type: ${memberType}`)
      }

      members.push({
        name,
        bsaMemberId,
        type: memberType,
        age,
        lastRankApproved: rank,
        patrol,
        position: positions.position,
        position2: positions.position2,
        renewalStatus,
        expirationDate,
      })
    }
  } catch (error) {
    console.error('[Regex Parser] Error:', error)
  }

  return { members, usedAI: false }
}

/**
 * Check if HTML looks like a valid Scoutbook roster page
 */
export function isValidRosterHtml(html: string): boolean {
  const lowerHtml = html.toLowerCase()
  const hasIndicators = ['scoutbook', 'scouting.org', 'roster', 'member', 'bsa'].some((s) =>
    lowerHtml.includes(s)
  )
  const hasTable = /<table/i.test(html) && /<\/table>/i.test(html)
  return hasIndicators && hasTable
}
