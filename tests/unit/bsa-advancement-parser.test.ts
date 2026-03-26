/**
 * Tests for Scoutbook Troop Advancement CSV Parser
 * Covers both old (pre-2026) and new (2026+) Scoutbook export formats
 */

import { describe, it, expect } from 'vitest'
import {
  detectColumns,
  parseTroopAdvancementCSV,
  validateParsedData,
  getParsedDataSummary,
} from '@/lib/import/scoutbook-troop-advancement-parser'

// Old format header (pre-2026)
const OLD_HEADER = 'bsamemberid,firstname,nickname,middlename,lastname,advancementtype,advancement,version,awarded,datecompleted,approved,markedcompleteddate,markedcompleteduserid,markedcompletedby,counselorapprovedby,counselorapproveddate,leaderapprovedby,leaderapproveddate,awardedby,awardeddate,id,unitnumber,unittypeid'

// New format header (2026+)
const NEW_HEADER = 'BSA Member ID, First Name, Middle Name, Last Name, Advancement Type, Advancement, Version, Date Completed, Approved, Awarded, Marked Completed By, Marked Completed Date, Counselor Approved By, Counselor Approved Date, Leader Approved By, Leader Approved Date, Awarded By, Awarded Date'

describe('Scoutbook Troop Advancement Parser', () => {
  describe('detectColumns', () => {
    it('should detect columns from old format headers', () => {
      const cols = detectColumns(OLD_HEADER)
      expect(cols.bsaMemberId).toBe(0)
      expect(cols.firstName).toBe(1)
      expect(cols.middleName).toBe(3)
      expect(cols.lastName).toBe(4)
      expect(cols.advancementType).toBe(5)
      expect(cols.advancement).toBe(6)
      expect(cols.version).toBe(7)
      expect(cols.awarded).toBe(8)
      expect(cols.dateCompleted).toBe(9)
      expect(cols.approved).toBe(10)
      expect(cols.markedCompletedDate).toBe(11)
      expect(cols.awardedDate).toBe(19)
    })

    it('should detect columns from new format headers', () => {
      const cols = detectColumns(NEW_HEADER)
      expect(cols.bsaMemberId).toBe(0)
      expect(cols.firstName).toBe(1)
      expect(cols.middleName).toBe(2)
      expect(cols.lastName).toBe(3)
      expect(cols.advancementType).toBe(4)
      expect(cols.advancement).toBe(5)
      expect(cols.version).toBe(6)
      expect(cols.dateCompleted).toBe(7)
      expect(cols.approved).toBe(8)
      expect(cols.awarded).toBe(9)
      expect(cols.awardedDate).toBe(17)
    })

    it('should throw error for missing required columns', () => {
      expect(() => detectColumns('Name, Age, Score')).toThrow('Missing required columns')
      expect(() => detectColumns('Name, Age, Score')).toThrow('bsamemberid')
    })

    it('should handle extra unknown columns gracefully', () => {
      const header = 'bsamemberid,firstname,middlename,lastname,advancementtype,advancement,version,extra_col_1,extra_col_2'
      const cols = detectColumns(header)
      expect(cols.bsaMemberId).toBe(0)
      expect(cols.advancementType).toBe(4)
    })
  })

  describe('boolean parsing', () => {
    it('should parse old format booleans (1/0) correctly', () => {
      const csv = [
        OLD_HEADER,
        '"133456904","George","","Ernest","Anderson","Rank","Scout Rank","2016",1,3/25/2021 12:00:00 AM,1,3/25/2021 12:00:00 AM,9994,"Nancy Randall","",/  /,"Nancy Randall",4/1/2021 12:00:00 AM,"Nancy Randall",6/6/2021 12:00:00 AM,38,9297,2',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.errors).toEqual([])
      expect(result.scouts.size).toBe(1)
      const scout = result.scouts.get('133456904')!
      expect(scout.ranks).toHaveLength(1)
      expect(scout.ranks[0].awarded).toBe(true)
    })

    it('should parse new format booleans (True/False) correctly', () => {
      const csv = [
        NEW_HEADER,
        '"135636690","Hadelyn","Eve","Becker","Rank","Scout Rank","2016","3/25/2021","True","True","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.errors).toEqual([])
      expect(result.scouts.size).toBe(1)
      const scout = result.scouts.get('135636690')!
      expect(scout.ranks).toHaveLength(1)
      expect(scout.ranks[0].awarded).toBe(true)
    })
  })

  describe('parseTroopAdvancementCSV - old format', () => {
    it('should parse ranks from old format', () => {
      const csv = [
        OLD_HEADER,
        '"100001","John","","Alan","Smith","Rank","Scout Rank","2016",1,3/25/2021 12:00:00 AM,1,/  /,0,"","",/  /,"Leader",4/1/2021 12:00:00 AM,"Leader",6/6/2021 12:00:00 AM,38,9297,2',
        '"100001","John","","Alan","Smith","Rank","Tenderfoot Rank","2016",1,8/2/2021 12:00:00 AM,1,/  /,0,"","",/  /,"Leader",8/3/2021 12:00:00 AM,"Leader",10/21/2021 12:00:00 AM,37,9297,2',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.errors).toEqual([])
      const scout = result.scouts.get('100001')!
      expect(scout.ranks).toHaveLength(2)
      expect(scout.ranks[0].rankCode).toBe('scout')
      expect(scout.ranks[0].awardedDate).toBe('2021-06-06')
      expect(scout.ranks[1].rankCode).toBe('tenderfoot')
    })

    it('should parse merit badges from old format', () => {
      const csv = [
        OLD_HEADER,
        '"100001","John","","Alan","Smith","Merit Badges","Camping MB","2021",1,5/15/2022 12:00:00 AM,1,/  /,0,"","",/  /,"Leader",5/15/2022 12:00:00 AM,"Leader",6/1/2022 12:00:00 AM,38,9297,2',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')!
      expect(scout.meritBadges).toHaveLength(1)
      expect(scout.meritBadges[0].normalizedName).toBe('camping')
    })

    it('should parse rank requirements from old format', () => {
      const csv = [
        OLD_HEADER,
        '"100001","John","","Alan","Smith","Scout Rank Requirements","1a","2016",0,3/20/2021 12:00:00 AM,1,3/20/2021 12:00:00 AM,0,"","",/  /,"",/  /,"",/  /,0,9297,2',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')!
      expect(scout.rankRequirements).toHaveLength(1)
      expect(scout.rankRequirements[0].rankCode).toBe('scout')
      expect(scout.rankRequirements[0].requirementNumber).toBe('1a')
      expect(scout.rankRequirements[0].completedDate).toBe('2021-03-20')
    })
  })

  describe('parseTroopAdvancementCSV - new format', () => {
    it('should parse ranks from new format', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Rank","Scout Rank","2016","3/25/2021 12:00:00 AM","True","True","","","","","","","","6/6/2021 12:00:00 AM"',
        '"100001","John","Alan","Smith","Rank","Tenderfoot Rank","2016","8/2/2021 12:00:00 AM","True","True","","","","","","","","10/21/2021 12:00:00 AM"',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.errors).toEqual([])
      expect(result.scouts.size).toBe(1)
      const scout = result.scouts.get('100001')!
      expect(scout.ranks).toHaveLength(2)
      expect(scout.ranks[0].rankCode).toBe('scout')
      expect(scout.ranks[0].awarded).toBe(true)
      expect(scout.ranks[0].awardedDate).toBe('2021-06-06')
      expect(scout.ranks[1].rankCode).toBe('tenderfoot')
      expect(scout.ranks[1].awardedDate).toBe('2021-10-21')
    })

    it('should parse merit badges from new format', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Merit Badges","Camping MB","2021","5/15/2022 12:00:00 AM","True","True","","","","","","","","6/1/2022 12:00:00 AM"',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')!
      expect(scout.meritBadges).toHaveLength(1)
      expect(scout.meritBadges[0].normalizedName).toBe('camping')
      expect(scout.meritBadges[0].awarded).toBe(true)
    })

    it('should parse rank requirements from new format', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Scout Rank Requirements","1a","2016","3/20/2021 12:00:00 AM","True","False","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')!
      expect(scout.rankRequirements).toHaveLength(1)
      expect(scout.rankRequirements[0].rankCode).toBe('scout')
      expect(scout.rankRequirements[0].requirementNumber).toBe('1a')
      expect(scout.rankRequirements[0].completedDate).toBe('2021-03-20')
    })

    it('should parse merit badge requirements from new format', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Camping Merit Badge Requirements","5a","2021","7/10/2022 12:00:00 AM","True","False","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')!
      expect(scout.meritBadgeRequirements).toHaveLength(1)
      expect(scout.meritBadgeRequirements[0].normalizedName).toBe('camping')
      expect(scout.meritBadgeRequirements[0].requirementNumber).toBe('5a')
    })

    it('should skip rows with False awarded for ranks', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Rank","Scout Rank","2016","","False","False","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      const scout = result.scouts.get('100001')
      // Scout exists but with no ranks (row was processed but rank not added)
      expect(scout?.ranks || []).toHaveLength(0)
    })

    it('should handle multiple scouts in new format', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Rank","Scout Rank","2016","3/25/2021","True","True","","","","","","","","6/6/2021"',
        '"100002","Jane","Marie","Doe","Rank","Scout Rank","2016","4/10/2021","True","True","","","","","","","","7/1/2021"',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.scouts.size).toBe(2)
      expect(result.summary.scoutCount).toBe(2)
      expect(result.summary.rankCount).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('should return error for empty content', () => {
      const result = parseTroopAdvancementCSV('')
      expect(result.errors).toContain('Empty file — no header row found')
    })

    it('should return error for invalid header', () => {
      const result = parseTroopAdvancementCSV('Name, Age, Score\n1,2,3')
      expect(result.errors[0]).toContain('Missing required columns')
    })

    it('should skip non-numeric BSA member IDs', () => {
      const csv = [
        NEW_HEADER,
        '"abc","John","Alan","Smith","Rank","Scout Rank","2016","3/25/2021","True","True","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      expect(result.scouts.size).toBe(0)
      expect(result.summary.skippedRows).toBe(1)
    })

    it('should handle rows with empty advancement type gracefully', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Awards","Religious emblem - Youth","1910","","False","False","","","","","","","",""',
      ].join('\n')

      const result = parseTroopAdvancementCSV(csv)
      // Awards are classified as "other" and skipped
      expect(result.summary.skippedRows).toBe(1)
    })
  })

  describe('validateParsedData', () => {
    it('should report error when no scouts found', () => {
      const data = parseTroopAdvancementCSV(NEW_HEADER + '\n')
      const errors = validateParsedData(data)
      expect(errors).toContain('No scouts found in the file')
    })

    it('should report error when no advancement data found', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Awards","Something","2016","","False","False","","","","","","","",""',
      ].join('\n')
      const data = parseTroopAdvancementCSV(csv)
      const errors = validateParsedData(data)
      expect(errors).toContain('No advancement data found in the file')
    })
  })

  describe('getParsedDataSummary', () => {
    it('should return correct summary counts', () => {
      const csv = [
        NEW_HEADER,
        '"100001","John","Alan","Smith","Rank","Scout Rank","2016","3/25/2021","True","True","","","","","","","","6/6/2021"',
        '"100001","John","Alan","Smith","Merit Badges","Camping MB","2021","5/15/2022","True","True","","","","","","","","6/1/2022"',
        '"100001","John","Alan","Smith","Scout Rank Requirements","1a","2016","3/20/2021","True","False","","","","","","","",""',
      ].join('\n')

      const data = parseTroopAdvancementCSV(csv)
      const summary = getParsedDataSummary(data)

      expect(summary.scoutCount).toBe(1)
      expect(summary.ranks).toBe(1)
      expect(summary.meritBadges).toBe(1)
      expect(summary.rankRequirements).toBe(1)
      expect(summary.totalAdvancement).toBe(3)
    })
  })
})
