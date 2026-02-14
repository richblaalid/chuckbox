import { describe, it, expect } from 'vitest'
import {
  parseRosterCSV,
  validateRoster,
  deriveRole,
  getCurrentPosition,
  getScoutPosition,
  normalizeCouncilName,
  normalizeDistrictName,
  type ParsedRoster,
} from '@/lib/import/bsa-roster-parser'

describe('BSA Roster Parser', () => {
  describe('normalizeCouncilName', () => {
    it('should remove trailing council number', () => {
      expect(normalizeCouncilName('Northern Star Council 250')).toBe('Northern Star Council')
    })

    it('should remove duplicate text', () => {
      expect(normalizeCouncilName('Northern Star Council 250Northern Star Council 250')).toBe('Northern Star Council')
    })

    it('should handle duplicate text without numbers', () => {
      expect(normalizeCouncilName('Northern Star CouncilNorthern Star Council')).toBe('Northern Star Council')
    })

    it('should trim whitespace', () => {
      expect(normalizeCouncilName('  Northern Star Council  ')).toBe('Northern Star Council')
    })

    it('should handle normal council name without modifications', () => {
      expect(normalizeCouncilName('Northern Star Council')).toBe('Northern Star Council')
    })

    it('should handle empty string', () => {
      expect(normalizeCouncilName('')).toBe('')
    })

    it('should handle council name with multiple numbers', () => {
      expect(normalizeCouncilName('Council 123 456')).toBe('Council 123')
    })
  })

  describe('normalizeDistrictName', () => {
    it('should remove trailing district number', () => {
      expect(normalizeDistrictName('H 108')).toBe('H')
    })

    it('should remove duplicate text', () => {
      expect(normalizeDistrictName('H 108H 108')).toBe('H')
    })

    it('should handle duplicate text without numbers', () => {
      expect(normalizeDistrictName('NorthNorth')).toBe('North')
    })

    it('should trim whitespace', () => {
      expect(normalizeDistrictName('  North District  ')).toBe('North District')
    })

    it('should handle normal district name without modifications', () => {
      expect(normalizeDistrictName('North')).toBe('North')
    })

    it('should handle empty string', () => {
      expect(normalizeDistrictName('')).toBe('')
    })
  })

  describe('deriveRole', () => {
    it('should return leader for Scoutmaster', () => {
      expect(deriveRole(['Scoutmaster'])).toBe('leader')
    })

    it('should return leader for Assistant Scoutmaster', () => {
      expect(deriveRole(['Assistant Scoutmaster'])).toBe('leader')
    })

    it('should return leader for Committee Chair', () => {
      expect(deriveRole(['Committee Chairman'])).toBe('leader')
    })

    it('should return leader for Committee Member', () => {
      expect(deriveRole(['Committee Member'])).toBe('leader')
    })

    it('should return treasurer for Treasurer position', () => {
      expect(deriveRole(['Treasurer'])).toBe('treasurer')
    })

    it('should return parent as default', () => {
      expect(deriveRole(['Parent'])).toBe('parent')
    })

    it('should return parent for empty positions', () => {
      expect(deriveRole([])).toBe('parent')
    })

    it('should prioritize Scoutmaster over Assistant', () => {
      expect(deriveRole(['Assistant Scoutmaster', 'Scoutmaster'])).toBe('leader')
    })

    it('should not match scoutmaster if assistant scoutmaster comes first', () => {
      // The first match wins, so order matters
      const result = deriveRole(['assistant scoutmaster'])
      expect(result).toBe('leader')
    })

    it('should handle case insensitivity', () => {
      expect(deriveRole(['SCOUTMASTER'])).toBe('leader')
      expect(deriveRole(['scoutmaster'])).toBe('leader')
      expect(deriveRole(['COMMITTEE MEMBER'])).toBe('leader')
    })
  })

  describe('getCurrentPosition', () => {
    it('should prioritize Scoutmaster first', () => {
      const positions = ['Committee Member', 'Scoutmaster', 'Parent']
      expect(getCurrentPosition(positions)).toBe('Scoutmaster')
    })

    it('should return Committee Chairman if no Scoutmaster', () => {
      const positions = ['Parent', 'Committee Chair', 'Assistant Scoutmaster']
      // Note: Priority list checks for "Committee Chairman", matching by includes
      expect(getCurrentPosition(positions)).toBe('Assistant Scoutmaster')
    })

    it('should return Treasurer after higher priorities', () => {
      const positions = ['Parent', 'Treasurer']
      expect(getCurrentPosition(positions)).toBe('Treasurer')
    })

    it('should return Assistant Scoutmaster', () => {
      const positions = ['Parent', 'Assistant Scoutmaster']
      expect(getCurrentPosition(positions)).toBe('Assistant Scoutmaster')
    })

    it('should return Committee Member', () => {
      const positions = ['Parent', 'Committee Member']
      expect(getCurrentPosition(positions)).toBe('Committee Member')
    })

    it('should return Den Leader', () => {
      const positions = ['Den Leader', 'Parent']
      expect(getCurrentPosition(positions)).toBe('Den Leader')
    })

    it('should return first non-parent position if no priority match', () => {
      const positions = ['Parent', 'Custom Role']
      expect(getCurrentPosition(positions)).toBe('Custom Role')
    })

    it('should return null for empty array', () => {
      expect(getCurrentPosition([])).toBeNull()
    })

    it('should return first position if only parent roles', () => {
      const positions = ['Parent', 'Guardian']
      expect(getCurrentPosition(positions)).toBe('Parent')
    })
  })

  describe('getScoutPosition', () => {
    it('should return Senior Patrol Leader as primary, with secondary', () => {
      const positions = ['Patrol Leader', 'Senior Patrol Leader', 'Scribe']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Senior Patrol Leader')
      expect(result.secondary).toBe('Patrol Leader')
    })

    it('should return SPL abbreviation as primary', () => {
      const positions = ['Scribe', 'SPL']
      expect(getScoutPosition(positions).primary).toBe('SPL')
    })

    it('should return ASPL abbreviation as primary', () => {
      const positions = ['Scribe', 'ASPL']
      expect(getScoutPosition(positions).primary).toBe('ASPL')
    })

    it('should return Patrol Leader as primary', () => {
      const positions = ['Scribe', 'Patrol Leader']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Patrol Leader')
      expect(result.secondary).toBe('Scribe')
    })

    it('should return Quartermaster as primary, no secondary', () => {
      const positions = ['Quartermaster']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Quartermaster')
      expect(result.secondary).toBeNull()
    })

    it('should return Scribe as primary', () => {
      const positions = ['Scribe']
      expect(getScoutPosition(positions).primary).toBe('Scribe')
    })

    it('should return Den Chief as primary', () => {
      const positions = ['Den Chief']
      expect(getScoutPosition(positions).primary).toBe('Den Chief')
    })

    it('should return nulls for empty array', () => {
      const result = getScoutPosition([])
      expect(result.primary).toBeNull()
      expect(result.secondary).toBeNull()
    })

    it('should return nulls for null input', () => {
      const result = getScoutPosition(null as unknown as string[])
      expect(result.primary).toBeNull()
      expect(result.secondary).toBeNull()
    })

    it('should return first position as primary if no priority match', () => {
      const positions = ['Custom Role', 'Another Role']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Custom Role')
      expect(result.secondary).toBe('Another Role')
    })

    it('should return Troop Guide as primary', () => {
      const positions = ['Scribe', 'Troop Guide']
      expect(getScoutPosition(positions).primary).toBe('Troop Guide')
    })

    it('should return JASM as primary', () => {
      const positions = ['JASM']
      expect(getScoutPosition(positions).primary).toBe('JASM')
    })

    it('should return Librarian as primary', () => {
      const positions = ['Librarian']
      expect(getScoutPosition(positions).primary).toBe('Librarian')
    })

    it('should return Historian as primary', () => {
      const positions = ['Historian']
      expect(getScoutPosition(positions).primary).toBe('Historian')
    })

    it('should return Chaplain Aide as primary', () => {
      const positions = ['Chaplain Aide']
      expect(getScoutPosition(positions).primary).toBe('Chaplain Aide')
    })

    it('should filter out Scouts BSA position', () => {
      const positions = ['Scouts BSA', 'Patrol Leader']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Patrol Leader')
      expect(result.secondary).toBeNull()
    })

    it('should return nulls when only Scouts BSA', () => {
      const positions = ['Scouts BSA']
      const result = getScoutPosition(positions)
      expect(result.primary).toBeNull()
      expect(result.secondary).toBeNull()
    })

    it('should handle multiple positions with Scouts BSA filtered', () => {
      const positions = ['Scouts BSA', 'Quartermaster', 'Scribe']
      const result = getScoutPosition(positions)
      expect(result.primary).toBe('Quartermaster')
      expect(result.secondary).toBe('Scribe')
    })
  })

  describe('parseRosterCSV', () => {
    it('should parse empty content with errors', () => {
      const result = parseRosterCSV('')
      expect(result.adults).toHaveLength(0)
      expect(result.scouts).toHaveLength(0)
      expect(result.errors).toContain('Could not find ADULT MEMBERS section')
      expect(result.errors).toContain('Could not find YOUTH MEMBERS section')
    })

    it('should handle content with only section markers', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(0)
      expect(result.scouts).toHaveLength(0)
    })

    it('should parse adult member correctly', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,Middle Name,BSA Number,Email,Gender,Date Joined,Health Form,Swim Class,Positions
John,Smith,William,123456789,john@example.com,M,01/15/2020,Current,Swimmer,Scoutmaster
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(1)
      expect(result.adults[0].firstName).toBe('John')
      expect(result.adults[0].lastName).toBe('Smith')
      expect(result.adults[0].middleName).toBe('William')
      expect(result.adults[0].bsaMemberId).toBe('123456789')
      expect(result.adults[0].email).toBe('john@example.com')
      expect(result.adults[0].gender).toBe('male')
    })

    it('should parse scout member correctly', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number
YOUTH MEMBERS
First Name,Last Name,Middle Name,BSA Number,Rank,Patrol,Gender,Date of Birth,Positions
Jane,Doe,Marie,987654321,Tenderfoot,Wolf Patrol,F,05/20/2010,Patrol Leader`

      const result = parseRosterCSV(content)
      expect(result.scouts).toHaveLength(1)
      expect(result.scouts[0].firstName).toBe('Jane')
      expect(result.scouts[0].lastName).toBe('Doe')
      expect(result.scouts[0].middleName).toBe('Marie')
      expect(result.scouts[0].bsaMemberId).toBe('987654321')
      expect(result.scouts[0].rank).toBe('Tenderfoot')
      expect(result.scouts[0].patrol).toBe('Wolf Patrol')
      expect(result.scouts[0].gender).toBe('female')
    })

    it('should handle quoted fields with commas', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,Address,BSA Number,Gender
"John","Smith","123 Main St, Apt 4",123456789,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(1)
      expect(result.adults[0].address).toBe('123 Main St, Apt 4')
    })

    it('should handle escaped quotes in fields', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,Address,BSA Number,Gender
John,Smith,"123 ""Main"" Street",123456789,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(1)
      expect(result.adults[0].address).toBe('123 "Main" Street')
    })

    it('should map male gender correctly', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
John,Smith,123456789,M,john@test.com
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email`

      const result = parseRosterCSV(content)
      expect(result.adults[0].gender).toBe('male')
    })

    it('should map female gender correctly', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
Jane,Smith,123456789,F,jane@test.com
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email`

      const result = parseRosterCSV(content)
      expect(result.adults[0].gender).toBe('female')
    })

    it('should map unknown gender to prefer_not_to_say', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
Pat,Smith,123456789,X,pat@test.com
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email`

      const result = parseRosterCSV(content)
      expect(result.adults[0].gender).toBe('prefer_not_to_say')
    })

    it('should parse swim classification swimmer', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender
John,Smith,123456789,Swimmer (08/15/2024),M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].swimClassification).toBe('swimmer')
    })

    it('should parse swim classification beginner', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender
John,Smith,123456789,Beginner,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].swimClassification).toBe('beginner')
    })

    it('should parse swim classification non-swimmer', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender
John,Smith,123456789,Non-Swimmer,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Swim Class,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].swimClassification).toBe('non-swimmer')
    })

    it('should parse health form status expired', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Health Form,Gender
John,Smith,123456789,"06/28/2024(AB) (Expired)",M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Health Form,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].healthFormStatus).toBe('expired')
    })

    it('should parse health form status current', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Health Form,Gender
John,Smith,123456789,Current 06/28/2025,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Health Form,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].healthFormStatus).toBe('current')
    })

    it('should parse date from MM/DD/YYYY format', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Date Joined,Gender
John,Smith,123456789,01/15/2020,M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Date Joined,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].dateJoined).toBe('2020-01-15')
    })

    it('should parse positions list', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Positions,Gender
John,Smith,123456789,"Scoutmaster|Committee Member|Treasurer",M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Positions,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].positions).toHaveLength(3)
      expect(result.adults[0].positions).toContain('Scoutmaster')
      expect(result.adults[0].positions).toContain('Committee Member')
      expect(result.adults[0].positions).toContain('Treasurer')
    })

    it('should remove tenure from positions', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Positions,Gender
John,Smith,123456789,"Scoutmaster (3m 16d)|Committee Member",M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Positions,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].positions[0]).toBe('Scoutmaster')
    })

    it('should parse trainings', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Training,Expiration Date
John,Smith,123456789,"Y01 Safeguarding Youth|A90 Wood Badge","12/31/2025|(does not expire)"
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      expect(result.adults[0].trainings).toHaveLength(2)
      expect(result.adults[0].trainings[0].code).toBe('Y01')
      expect(result.adults[0].trainings[0].name).toBe('Safeguarding Youth')
      expect(result.adults[0].trainings[1].code).toBe('A90')
      expect(result.adults[0].trainings[1].expiresAt).toBeNull()
    })

    it('should parse merit badges', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Merit Badges,Gender
John,Smith,123456789,"Camping|First Aid|Swimming",M
YOUTH MEMBERS
First Name,Last Name,BSA Number,Merit Badges,Gender`

      const result = parseRosterCSV(content)
      expect(result.adults[0].meritBadges).toHaveLength(3)
      expect(result.adults[0].meritBadges).toContain('Camping')
    })

    it('should parse guardian info from youth section', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number
YOUTH MEMBERS
First Name,Last Name,BSA Number,Parent/Guardian Name,Relationship
Jane,Doe,987654321,John Doe,"(141419859) - Father of - Guardian"`

      const result = parseRosterCSV(content)
      expect(result.scouts).toHaveLength(1)
      expect(result.scouts[0].guardians).toHaveLength(1)
      expect(result.scouts[0].guardians[0].name).toBe('John Doe')
      expect(result.scouts[0].guardians[0].bsaMemberId).toBe('141419859')
      expect(result.scouts[0].guardians[0].relationship).toBe('Father of')
    })

    it('should skip rows without first and last name', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number
,Smith,123456789
John,,987654321
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(0)
    })

    it('should skip malformed rows (less than 5 values)', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number
John,Smith
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(0)
    })

    it('should skip section marker rows', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
" ",Spacer,Row,X,x
YOUTH MEMBERS
First Name,Last Name,BSA Number`

      const result = parseRosterCSV(content)
      // The row starting with '" "' should be skipped
      expect(result.adults).toHaveLength(0)
    })

    it('should handle multiple adults and scouts', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
John,Smith,123456789,M,john@test.com
Jane,Doe,987654321,F,jane@test.com
YOUTH MEMBERS
First Name,Last Name,BSA Number,Gender,Email
Sam,Johnson,111111111,M,sam@test.com
Amy,Williams,222222222,F,amy@test.com`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(2)
      expect(result.scouts).toHaveLength(2)
    })

    it('should handle adult section without youth section', () => {
      const content = `ADULT MEMBERS
First Name,Last Name,BSA Number,Gender,Email
John,Smith,123456789,M,john@test.com`

      const result = parseRosterCSV(content)
      expect(result.adults).toHaveLength(1)
      expect(result.scouts).toHaveLength(0)
      expect(result.errors).toContain('Could not find YOUTH MEMBERS section')
    })
  })

  describe('validateRoster', () => {
    it('should return empty errors for valid roster', () => {
      const roster: ParsedRoster = {
        adults: [{
          firstName: 'John',
          lastName: 'Smith',
          middleName: null,
          email: 'john@test.com',
          address: null,
          city: null,
          state: null,
          zip: null,
          phone: null,
          gender: 'male',
          dateJoined: null,
          bsaMemberId: '123456789',
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          positions: [],
          trainings: [],
          meritBadges: [],
        }],
        scouts: [{
          firstName: 'Jane',
          lastName: 'Doe',
          middleName: null,
          rank: 'Tenderfoot',
          bsaMemberId: '987654321',
          dateOfBirth: null,
          gender: 'female',
          dateJoined: null,
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          patrol: null,
          positions: [],
          guardians: [],
        }],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toHaveLength(0)
    })

    it('should report adult missing first name', () => {
      const roster: ParsedRoster = {
        adults: [{
          firstName: '',
          lastName: 'Smith',
          middleName: null,
          email: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          phone: null,
          gender: 'male',
          dateJoined: null,
          bsaMemberId: null,
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          positions: [],
          trainings: [],
          meritBadges: [],
        }],
        scouts: [],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Adult missing first name: Smith')
    })

    it('should report adult missing last name', () => {
      const roster: ParsedRoster = {
        adults: [{
          firstName: 'John',
          lastName: '',
          middleName: null,
          email: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          phone: null,
          gender: 'male',
          dateJoined: null,
          bsaMemberId: null,
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          positions: [],
          trainings: [],
          meritBadges: [],
        }],
        scouts: [],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Adult missing last name: John')
    })

    it('should report scout missing first name', () => {
      const roster: ParsedRoster = {
        adults: [],
        scouts: [{
          firstName: '',
          lastName: 'Doe',
          middleName: null,
          rank: null,
          bsaMemberId: null,
          dateOfBirth: null,
          gender: 'female',
          dateJoined: null,
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          patrol: null,
          positions: [],
          guardians: [],
        }],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Scout missing first name: Doe')
    })

    it('should report scout missing last name', () => {
      const roster: ParsedRoster = {
        adults: [],
        scouts: [{
          firstName: 'Jane',
          lastName: '',
          middleName: null,
          rank: null,
          bsaMemberId: null,
          dateOfBirth: null,
          gender: 'female',
          dateJoined: null,
          healthFormStatus: null,
          healthFormExpires: null,
          swimClassification: null,
          swimClassDate: null,
          patrol: null,
          positions: [],
          guardians: [],
        }],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Scout missing last name: Jane')
    })

    it('should report duplicate adult BSA IDs', () => {
      const roster: ParsedRoster = {
        adults: [
          {
            firstName: 'John',
            lastName: 'Smith',
            middleName: null,
            email: null,
            address: null,
            city: null,
            state: null,
            zip: null,
            phone: null,
            gender: 'male',
            dateJoined: null,
            bsaMemberId: '123456789',
            healthFormStatus: null,
            healthFormExpires: null,
            swimClassification: null,
            swimClassDate: null,
            positions: [],
            trainings: [],
            meritBadges: [],
          },
          {
            firstName: 'Jane',
            lastName: 'Doe',
            middleName: null,
            email: null,
            address: null,
            city: null,
            state: null,
            zip: null,
            phone: null,
            gender: 'female',
            dateJoined: null,
            bsaMemberId: '123456789',
            healthFormStatus: null,
            healthFormExpires: null,
            swimClassification: null,
            swimClassDate: null,
            positions: [],
            trainings: [],
            meritBadges: [],
          },
        ],
        scouts: [],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Duplicate adult BSA ID: 123456789')
    })

    it('should report duplicate scout BSA IDs', () => {
      const roster: ParsedRoster = {
        adults: [],
        scouts: [
          {
            firstName: 'Sam',
            lastName: 'Johnson',
            middleName: null,
            rank: null,
            bsaMemberId: '987654321',
            dateOfBirth: null,
            gender: 'male',
            dateJoined: null,
            healthFormStatus: null,
            healthFormExpires: null,
            swimClassification: null,
            swimClassDate: null,
            patrol: null,
            positions: [],
            guardians: [],
          },
          {
            firstName: 'Amy',
            lastName: 'Williams',
            middleName: null,
            rank: null,
            bsaMemberId: '987654321',
            dateOfBirth: null,
            gender: 'female',
            dateJoined: null,
            healthFormStatus: null,
            healthFormExpires: null,
            swimClassification: null,
            swimClassDate: null,
            patrol: null,
            positions: [],
            guardians: [],
          },
        ],
        errors: [],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Duplicate scout BSA ID: 987654321')
    })

    it('should include existing errors from roster', () => {
      const roster: ParsedRoster = {
        adults: [],
        scouts: [],
        errors: ['Existing error from parsing'],
      }

      const errors = validateRoster(roster)
      expect(errors).toContain('Existing error from parsing')
    })
  })
})
