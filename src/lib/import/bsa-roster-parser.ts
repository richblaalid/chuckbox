/**
 * BSA Roster CSV Parser
 *
 * Parses the CSV export from BSA's roster system which has two sections:
 * 1. ADULT MEMBERS - Leaders, parents, committee members
 * 2. YOUTH MEMBERS - Scouts with embedded parent info
 */

// ============================================
// Types
// ============================================

export interface ParsedTraining {
  code: string
  name: string
  expiresAt: string | null // null means "(does not expire)"
}

export interface ParsedAdult {
  firstName: string
  lastName: string
  middleName: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say'
  dateJoined: string | null
  bsaMemberId: string | null
  healthFormStatus: string | null
  healthFormExpires: string | null
  swimClassification: 'swimmer' | 'beginner' | 'non-swimmer' | null
  swimClassDate: string | null
  positions: string[]
  trainings: ParsedTraining[]
  meritBadges: string[]
}

export interface ParsedGuardian {
  name: string
  bsaMemberId: string | null
  relationship: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  homePhone: string | null
  workPhone: string | null
  mobilePhone: string | null
  email: string | null
}

export interface ParsedScout {
  firstName: string
  lastName: string
  middleName: string | null
  rank: string | null
  bsaMemberId: string | null
  dateOfBirth: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say'
  dateJoined: string | null
  healthFormStatus: string | null
  healthFormExpires: string | null
  swimClassification: 'swimmer' | 'beginner' | 'non-swimmer' | null
  swimClassDate: string | null
  patrol: string | null
  positions: string[]
  guardians: ParsedGuardian[]
}

export interface UnitMetadata {
  unitType: 'troop' | 'pack' | 'crew' | 'ship' | null
  unitNumber: string | null
  unitSuffix: string | null // e.g., "B" for "Troop 9297 B"
  council: string | null
  district: string | null
}

export interface ParsedRoster {
  adults: ParsedAdult[]
  scouts: ParsedScout[]
  errors: string[]
  unitMetadata?: UnitMetadata
}

// ============================================
// CSV Parsing Utilities
// ============================================

/**
 * Parse a CSV line handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

/**
 * Map gender from CSV format to database format
 */
function mapGender(csvGender: string): 'male' | 'female' | 'other' | 'prefer_not_to_say' {
  const normalized = csvGender.toUpperCase().trim()
  if (normalized === 'M' || normalized === 'MALE') return 'male'
  if (normalized === 'F' || normalized === 'FEMALE') return 'female'
  return 'prefer_not_to_say'
}

/**
 * Parse swim classification
 */
function parseSwimClass(swimStr: string): 'swimmer' | 'beginner' | 'non-swimmer' | null {
  if (!swimStr) return null
  const lower = swimStr.toLowerCase()
  if (lower.includes('swimmer') && !lower.includes('non')) return 'swimmer'
  if (lower.includes('beginner')) return 'beginner'
  if (lower.includes('non')) return 'non-swimmer'
  return null
}

/**
 * Extract date from a string like "Swimmer (08/02/2025)" or "08/02/2025"
 */
function extractDate(str: string): string | null {
  if (!str) return null
  const match = str.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  if (match) {
    // Convert MM/DD/YYYY to YYYY-MM-DD
    const parts = match[1].split('/')
    if (parts.length === 3) {
      const [month, day, year] = parts
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
  }
  return null
}

/**
 * Parse health form status from string like "06/28/2024(AB) (Expired) | 06/28/2024(C) (Expired)"
 */
function parseHealthForm(healthStr: string): { status: string | null; expires: string | null } {
  if (!healthStr) return { status: null, expires: null }

  const lower = healthStr.toLowerCase()
  if (lower.includes('expired')) {
    return { status: 'expired', expires: extractDate(healthStr) }
  }
  if (lower.includes('current') || healthStr.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
    return { status: 'current', expires: extractDate(healthStr) }
  }
  return { status: null, expires: null }
}

/**
 * Parse training list from pipe-separated string
 */
function parseTrainings(trainingStr: string, expirationStr: string): ParsedTraining[] {
  if (!trainingStr) return []

  const trainings = trainingStr.split('|').map(t => t.trim()).filter(Boolean)
  const expirations = expirationStr.split('|').map(e => e.trim())

  return trainings.map((training, index) => {
    // Training format: "A90 Wood Badge" or "Y01 Safeguarding Youth Training Certification"
    const match = training.match(/^([A-Z0-9_]+)\s+(.+)$/)
    const code = match ? match[1] : training
    const name = match ? match[2] : training

    const expiration = expirations[index] || ''
    const expiresAt = expiration.includes('does not expire') ? null : extractDate(expiration)

    return { code, name, expiresAt }
  })
}

/**
 * Parse positions list - extract position name, remove tenure and patrol info
 * Input examples:
 *   "Patrol Leader [ Blazing Bulls] Patrol (4m 4d)" -> "Patrol Leader"
 *   "Scouts BSA [ Eagles] Patrol (10m 6d)" -> "Scouts BSA"
 *   "Committee Member (8m 18d)" -> "Committee Member"
 */
function parsePositions(positionsStr: string): string[] {
  if (!positionsStr) return []
  return positionsStr
    .split('|')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Remove tenure like "(3m 16d)" at the end
      let cleaned = p.replace(/\s*\([^)]+\)\s*$/, '').trim()
      // Remove patrol info like "[ Patrol Name] Patrol" or "[Patrol Name] Patrol"
      cleaned = cleaned.replace(/\s*\[\s*[^\]]+\]\s*Patrol\s*$/i, '').trim()
      return cleaned
    })
    .filter(Boolean)
}

/**
 * Parse merit badges list
 */
function parseMeritBadges(badgesStr: string): string[] {
  if (!badgesStr) return []
  return badgesStr
    .split('|')
    .map(b => b.trim())
    .filter(Boolean)
}

/**
 * Derive role from positions
 */
export function deriveRole(positions: string[]): 'admin' | 'treasurer' | 'leader' | 'parent' {
  for (const pos of positions) {
    const lower = pos.toLowerCase()
    if (lower.includes('scoutmaster') && !lower.includes('assistant')) return 'leader'
    if (lower.includes('assistant scoutmaster')) return 'leader'
    if (lower.includes('committee chair')) return 'leader'
    if (lower.includes('committee member')) return 'leader'
    if (lower.includes('treasurer')) return 'treasurer'
  }
  return 'parent' // Default to parent
}

/**
 * Get current position for adults (most relevant one)
 */
export function getCurrentPosition(positions: string[]): string | null {
  // Priority order for position display
  const priority = [
    'Scoutmaster',
    'Committee Chairman',
    'Treasurer',
    'Assistant Scoutmaster',
    'Committee Member',
    'Den Leader',
    'Troop Admin',
  ]

  for (const p of priority) {
    const found = positions.find(pos => pos.toLowerCase().includes(p.toLowerCase()))
    if (found) return found
  }

  // Return first non-parent/guardian position
  const nonParent = positions.find(p => !p.toLowerCase().includes('parent') && !p.toLowerCase().includes('guardian'))
  return nonParent || positions[0] || null
}

/**
 * Get current positions for scouts (primary and secondary leadership roles)
 * Filters out "Scouts BSA" as it's not a leadership position.
 * Returns positions in priority order.
 */
export function getScoutPosition(positions: string[]): { primary: string | null; secondary: string | null } {
  if (!positions || positions.length === 0) {
    return { primary: null, secondary: null }
  }

  // Filter out "Scouts BSA" - it's not a leadership position
  const filteredPositions = positions.filter(
    pos => !pos.toLowerCase().includes('scouts bsa')
  )

  if (filteredPositions.length === 0) {
    return { primary: null, secondary: null }
  }

  // Priority order for scout positions
  const priority = [
    'Senior Patrol Leader',
    'SPL',
    'Assistant Senior Patrol Leader',
    'ASPL',
    'Patrol Leader',
    'Assistant Patrol Leader',
    'Troop Guide',
    'Quartermaster',
    'Scribe',
    'Librarian',
    'Historian',
    'Bugler',
    'Chaplain Aide',
    'Instructor',
    'Junior Assistant Scoutmaster',
    'JASM',
    'Den Chief',
    'Webmaster',
    'Leave No Trace Trainer',
    'Outdoor Ethics Guide',
  ]

  // Find all matching positions with their priority index
  const rankedPositions: { position: string; priorityIndex: number }[] = []

  for (const pos of filteredPositions) {
    const priorityIndex = priority.findIndex(p => pos.toLowerCase().includes(p.toLowerCase()))
    rankedPositions.push({
      position: pos,
      priorityIndex: priorityIndex === -1 ? priority.length : priorityIndex,
    })
  }

  // Sort by priority (lower index = higher priority)
  rankedPositions.sort((a, b) => a.priorityIndex - b.priorityIndex)

  return {
    primary: rankedPositions[0]?.position || null,
    secondary: rankedPositions[1]?.position || null,
  }
}

// ============================================
// Main Parser
// ============================================

/**
 * Parse BSA roster CSV content
 */
export function parseRosterCSV(content: string): ParsedRoster {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const errors: string[] = []
  const adults: ParsedAdult[] = []
  const scouts: ParsedScout[] = []

  // Find section markers
  let adultStartIndex = -1
  let youthStartIndex = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('ADULT MEMBERS')) {
      adultStartIndex = i
    } else if (lines[i].includes('YOUTH MEMBERS')) {
      youthStartIndex = i
    }
  }

  if (adultStartIndex === -1) {
    errors.push('Could not find ADULT MEMBERS section')
  }
  if (youthStartIndex === -1) {
    errors.push('Could not find YOUTH MEMBERS section')
  }

  // Parse adult section
  if (adultStartIndex !== -1) {
    const adultHeaderIndex = adultStartIndex + 1
    const adultEndIndex = youthStartIndex !== -1 ? youthStartIndex : lines.length

    // Get header row
    const headerLine = lines[adultHeaderIndex]
    if (!headerLine) {
      errors.push('Adult section header row missing')
    } else {
      const headers = parseCSVLine(headerLine)

      // Parse adult data rows
      for (let i = adultHeaderIndex + 1; i < adultEndIndex; i++) {
        const line = lines[i]
        if (!line || line.startsWith('" "')) continue // Skip empty or section marker rows

        try {
          const values = parseCSVLine(line)
          if (values.length < 5) continue // Skip malformed rows

          const getVal = (header: string): string => {
            const idx = headers.findIndex(h => h.toLowerCase().includes(header.toLowerCase()))
            return idx !== -1 && values[idx] ? values[idx] : ''
          }

          const healthForm = parseHealthForm(getVal('Health Form'))
          const positions = parsePositions(getVal('Positions'))

          const adult: ParsedAdult = {
            firstName: getVal('First Name'),
            lastName: getVal('Last Name'),
            middleName: getVal('Middle Name') || null,
            email: getVal('Email') || null,
            address: getVal('Address') || null,
            city: getVal('City') || null,
            state: getVal('State') || null,
            zip: getVal('Zip') || null,
            phone: getVal('Phone') || null,
            gender: mapGender(getVal('Gender')),
            dateJoined: extractDate(getVal('Date Joined')),
            bsaMemberId: getVal('BSA Number') || null,
            healthFormStatus: healthForm.status,
            healthFormExpires: healthForm.expires,
            swimClassification: parseSwimClass(getVal('Swim Class')),
            swimClassDate: extractDate(getVal('Swim Class Date')),
            positions,
            trainings: parseTrainings(getVal('Training'), getVal('Expiration Date')),
            meritBadges: parseMeritBadges(getVal('Merit Badges')),
          }

          if (adult.firstName && adult.lastName) {
            adults.push(adult)
          }
        } catch (err) {
          errors.push(`Error parsing adult row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Parse youth section
  if (youthStartIndex !== -1) {
    const youthHeaderIndex = youthStartIndex + 1

    // Get header row
    const headerLine = lines[youthHeaderIndex]
    if (!headerLine) {
      errors.push('Youth section header row missing')
    } else {
      const headers = parseCSVLine(headerLine)

      // Parse youth data rows
      // Stop at other section markers (DEN CHIEF MEMBERS, etc.)
      for (let i = youthHeaderIndex + 1; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue

        // Stop if we hit another section marker (e.g., "DEN CHIEF MEMBERS", "ADULT MEMBERS")
        // Section markers start with `" "` followed by text in all caps
        if (line.startsWith('" "') && line.match(/^" ","[A-Z\s]+"/)) {
          break
        }

        // Skip empty section marker rows
        if (line.startsWith('" "')) continue

        try {
          const values = parseCSVLine(line)
          if (values.length < 5) continue

          const getVal = (header: string): string => {
            const idx = headers.findIndex(h => h.toLowerCase().includes(header.toLowerCase()))
            return idx !== -1 && values[idx] ? values[idx] : ''
          }

          const healthForm = parseHealthForm(getVal('Health Form'))
          const positions = parsePositions(getVal('Positions'))

          // Parse guardian info
          const guardianName = getVal('Parent/Guardian Name')
          const guardians: ParsedGuardian[] = []

          if (guardianName) {
            // Extract BSA ID from relationship field like "(141419859) - Father of - Guardian"
            const relationship = getVal('Relationship')
            const bsaIdMatch = relationship.match(/\((\d+)\)/)

            guardians.push({
              name: guardianName,
              bsaMemberId: bsaIdMatch ? bsaIdMatch[1] : null,
              relationship: relationship.replace(/\(\d+\)\s*-\s*/, '').replace(/\s*-\s*Guardian$/, '').trim(),
              address: getVal('Address') || null,
              city: getVal('City') || null,
              state: getVal('State') || null,
              zip: getVal('Zip') || null,
              homePhone: values[headers.findIndex(h => h === 'Home Phone') + 1] || null, // Get second Home Phone (guardian's)
              workPhone: getVal('Work Phone') || null,
              mobilePhone: getVal('Mobile Phone') || null,
              email: getVal('Email') || null,
            })
          }

          // Extract patrol name - remove leading space and brackets
          const patrolRaw = getVal('Patrol')
          const patrol = patrolRaw ? patrolRaw.replace(/^\s+/, '').trim() : null

          const scout: ParsedScout = {
            firstName: getVal('First Name'),
            lastName: getVal('Last Name'),
            middleName: getVal('Middle Name') || null,
            rank: getVal('Rank') || null,
            bsaMemberId: getVal('BSA Number') || null,
            dateOfBirth: extractDate(getVal('Date of Birth')),
            gender: mapGender(getVal('Gender')),
            dateJoined: extractDate(getVal('Date Joined')),
            healthFormStatus: healthForm.status,
            healthFormExpires: healthForm.expires,
            swimClassification: parseSwimClass(getVal('Swim Class')),
            swimClassDate: extractDate(getVal('Swim Class Date')),
            patrol,
            positions,
            guardians,
          }

          if (scout.firstName && scout.lastName) {
            scouts.push(scout)
          }
        } catch (err) {
          errors.push(`Error parsing youth row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  return { adults, scouts, errors }
}

/**
 * Validate parsed roster data
 */
export function validateRoster(roster: ParsedRoster): string[] {
  const errors: string[] = [...roster.errors]

  // Check for required fields
  for (const adult of roster.adults) {
    if (!adult.firstName) errors.push(`Adult missing first name: ${adult.lastName}`)
    if (!adult.lastName) errors.push(`Adult missing last name: ${adult.firstName}`)
  }

  for (const scout of roster.scouts) {
    if (!scout.firstName) errors.push(`Scout missing first name: ${scout.lastName}`)
    if (!scout.lastName) errors.push(`Scout missing last name: ${scout.firstName}`)
  }

  // Check for duplicate BSA IDs
  const adultIds = roster.adults.filter(a => a.bsaMemberId).map(a => a.bsaMemberId!)
  const scoutIds = roster.scouts.filter(s => s.bsaMemberId).map(s => s.bsaMemberId!)

  const duplicateAdults = adultIds.filter((id, i) => adultIds.indexOf(id) !== i)
  const duplicateScouts = scoutIds.filter((id, i) => scoutIds.indexOf(id) !== i)

  for (const id of duplicateAdults) {
    errors.push(`Duplicate adult BSA ID: ${id}`)
  }
  for (const id of duplicateScouts) {
    errors.push(`Duplicate scout BSA ID: ${id}`)
  }

  return errors
}

/**
 * Parse unit type from a unit string like "Troop 9297 B"
 */
function parseUnitType(unitStr: string): 'troop' | 'pack' | 'crew' | 'ship' | null {
  const lower = unitStr.toLowerCase()
  if (lower.includes('troop')) return 'troop'
  if (lower.includes('pack')) return 'pack'
  if (lower.includes('crew')) return 'crew'
  if (lower.includes('ship')) return 'ship'
  return null
}

/**
 * Parse unit number and suffix from a unit string like "Troop 9297 B"
 * Returns { number: "9297", suffix: "B" }
 */
function parseUnitNumberAndSuffix(unitStr: string): { number: string | null; suffix: string | null } {
  // Match pattern: "Troop 9297 B" or "Pack 123" or "Crew 42G"
  const match = unitStr.match(/(?:troop|pack|crew|ship)\s+(\d+)\s*([A-Z])?/i)
  if (match) {
    return {
      number: match[1],
      suffix: match[2] || null,
    }
  }
  return { number: null, suffix: null }
}

/**
 * Normalize council name - handles common parsing issues:
 * 1. Removes trailing council number (e.g., "Northern Star Council 250" -> "Northern Star Council")
 * 2. Removes duplicate text (e.g., "Northern Star Council 250Northern Star Council 250" -> "Northern Star Council")
 * 3. Trims whitespace
 */
export function normalizeCouncilName(council: string): string {
  if (!council) return ''

  let cleaned = council.trim()

  // Check for duplicated text (the council name repeated twice)
  // This can happen when parsing certain CSV formats
  const halfLength = Math.floor(cleaned.length / 2)
  if (halfLength > 0) {
    const firstHalf = cleaned.substring(0, halfLength)
    const secondHalf = cleaned.substring(halfLength)
    if (firstHalf === secondHalf) {
      cleaned = firstHalf
    }
  }

  // Remove trailing council number (e.g., "Northern Star Council 250" -> "Northern Star Council")
  cleaned = cleaned.replace(/\s+\d+\s*$/, '').trim()

  return cleaned
}

// Keep the old function name for internal backward compatibility
function cleanCouncilName(council: string): string {
  return normalizeCouncilName(council)
}

/**
 * Normalize district name - handles common parsing issues:
 * 1. Removes trailing district number (e.g., "H 108" -> "H")
 * 2. Removes duplicate text (e.g., "H 108H 108" -> "H")
 * 3. Trims whitespace
 */
export function normalizeDistrictName(district: string): string {
  if (!district) return ''

  let cleaned = district.trim()

  // Check for duplicated text (the district name repeated twice)
  // This can happen when parsing certain CSV formats
  const halfLength = Math.floor(cleaned.length / 2)
  if (halfLength > 0) {
    const firstHalf = cleaned.substring(0, halfLength)
    const secondHalf = cleaned.substring(halfLength)
    if (firstHalf === secondHalf) {
      cleaned = firstHalf
    }
  }

  // Remove trailing district number (e.g., "H 108" -> "H")
  cleaned = cleaned.replace(/\s+\d+\s*$/, '').trim()

  return cleaned
}

/**
 * Extract unit metadata from BSA roster CSV content
 * Parses the first adult or youth row to get unit info
 */
export function extractUnitMetadata(content: string): UnitMetadata {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Find section markers
  let adultStartIndex = -1
  let youthStartIndex = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('ADULT MEMBERS')) {
      adultStartIndex = i
    } else if (lines[i].includes('YOUTH MEMBERS')) {
      youthStartIndex = i
    }
  }

  const result: UnitMetadata = {
    unitType: null,
    unitNumber: null,
    unitSuffix: null,
    council: null,
    district: null,
  }

  // Try to extract from adult section first (has more complete data)
  if (adultStartIndex !== -1) {
    const headerLine = lines[adultStartIndex + 1]
    const dataLine = lines[adultStartIndex + 2]

    if (headerLine && dataLine && !dataLine.startsWith('" "')) {
      const headers = parseCSVLine(headerLine)
      const values = parseCSVLine(dataLine)

      const getVal = (header: string): string => {
        const idx = headers.findIndex(h => h.toLowerCase().includes(header.toLowerCase()))
        return idx !== -1 && values[idx] ? values[idx] : ''
      }

      // Get council (from "Council" column)
      const council = getVal('Council')
      if (council) {
        result.council = cleanCouncilName(council)
      }

      // Get district
      const district = getVal('District')
      if (district) {
        result.district = normalizeDistrictName(district)
      }

      // Get unit info from "Unit Number" column (adult section) or "Unit" (youth section)
      let unitStr = getVal('Unit Number')
      if (!unitStr) {
        unitStr = getVal('Unit')
      }

      if (unitStr) {
        result.unitType = parseUnitType(unitStr)
        const { number, suffix } = parseUnitNumberAndSuffix(unitStr)
        result.unitNumber = number
        result.unitSuffix = suffix
      }
    }
  }

  // Fallback to youth section if adult section didn't have data
  if (!result.unitNumber && youthStartIndex !== -1) {
    const headerLine = lines[youthStartIndex + 1]
    const dataLine = lines[youthStartIndex + 2]

    if (headerLine && dataLine && !dataLine.startsWith('" "')) {
      const headers = parseCSVLine(headerLine)
      const values = parseCSVLine(dataLine)

      const getVal = (header: string): string => {
        const idx = headers.findIndex(h => h.toLowerCase().includes(header.toLowerCase()))
        return idx !== -1 && values[idx] ? values[idx] : ''
      }

      // Youth section has "Council" and "Unit" columns
      const council = getVal('Council')
      if (council && !result.council) {
        result.council = cleanCouncilName(council)
      }

      const district = getVal('District')
      if (district && !result.district) {
        result.district = normalizeDistrictName(district)
      }

      const unitStr = getVal('Unit')
      if (unitStr) {
        result.unitType = parseUnitType(unitStr)
        const { number, suffix } = parseUnitNumberAndSuffix(unitStr)
        result.unitNumber = number
        result.unitSuffix = suffix
      }
    }
  }

  return result
}

/**
 * Parse BSA roster CSV and extract both roster data and unit metadata
 */
export function parseRosterWithMetadata(content: string): ParsedRoster {
  const roster = parseRosterCSV(content)
  const unitMetadata = extractUnitMetadata(content)
  return {
    ...roster,
    unitMetadata,
  }
}
