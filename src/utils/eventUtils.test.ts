import { describe, it, expect } from 'vitest'
import { getEventBackgroundColor } from './eventUtils'

describe('eventUtils', () => {
  describe('getEventBackgroundColor', () => {
    it('returns correct color for busy status', () => {
      expect(getEventBackgroundColor('busy')).toBe('#1890ff')
    })

    it('returns correct color for tentative status', () => {
      expect(getEventBackgroundColor('tentative')).toBe('#faad14')
    })

    it('returns correct color for free status', () => {
      expect(getEventBackgroundColor('free')).toBe('#52c41a')
    })

    it('returns correct color for oof (out of office) status', () => {
      expect(getEventBackgroundColor('oof')).toBe('#ff4d4f')
    })

    it('returns correct color for workingElsewhere status', () => {
      expect(getEventBackgroundColor('workingElsewhere')).toBe('#722ed1')
    })

    it('returns default color for unknown status', () => {
      expect(getEventBackgroundColor('unknown')).toBe('#8c8c8c')
      expect(getEventBackgroundColor('')).toBe('#8c8c8c')
    })
  })
})