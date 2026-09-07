import { describe, it, expect, vi } from 'vitest'

// dayLabel() parses and reformats real date strings via dayjs. The global
// dayjs mock in src/test/setup.ts answers every call with one fixed value, so
// opt this file back into the real library.
vi.unmock('dayjs')

import { canFloatingEditDate, describeDateFilter } from './filter-summary'
import type { ColumnFilterModel } from './filter-model'

const date = (
  conditions: Extract<ColumnFilterModel, { type: 'date' }>['conditions'],
): ColumnFilterModel => ({ type: 'date', conditions, join: 'AND' })

describe('canFloatingEditDate', () => {
  it('is true for no filter and a single equals', () => {
    // Act / Assert
    expect(canFloatingEditDate(undefined)).toBe(true)
    expect(canFloatingEditDate(date([{ op: 'equals', value: '2026-06-21' }]))).toBe(
      true,
    )
  })

  it('is false for non-equals operators, ranges, and multiple conditions', () => {
    // Act / Assert
    expect(canFloatingEditDate(date([{ op: 'before', value: '2026-06-21' }]))).toBe(
      false,
    )
    expect(
      canFloatingEditDate(
        date([{ op: 'inRange', value: '2026-06-21', valueTo: '2026-06-27' }]),
      ),
    ).toBe(false)
    expect(
      canFloatingEditDate(
        date([
          { op: 'equals', value: '2026-06-21' },
          { op: 'equals', value: '2026-06-22' },
        ]),
      ),
    ).toBe(false)
  })

  it('is false for a dateSet (date-tree) selection', () => {
    // Act / Assert
    expect(
      canFloatingEditDate({ type: 'dateSet', values: ['2026-06-21'] }),
    ).toBe(false)
  })
})

describe('describeDateFilter', () => {
  it('summarizes single-condition operators', () => {
    // Act / Assert
    expect(describeDateFilter(date([{ op: 'equals', value: '2026-06-21' }]))).toBe(
      '2026-06-21',
    )
    expect(describeDateFilter(date([{ op: 'before', value: '2026-06-21' }]))).toBe(
      '< 2026-06-21',
    )
    expect(describeDateFilter(date([{ op: 'after', value: '2026-06-21' }]))).toBe(
      '> 2026-06-21',
    )
    expect(
      describeDateFilter(
        date([{ op: 'inRange', value: '2026-06-21', valueTo: '2026-06-27' }]),
      ),
    ).toBe('2026-06-21 – 2026-06-27')
    expect(describeDateFilter(date([{ op: 'blank', value: null }]))).toBe('Blank')
  })

  it('summarizes multiple conditions and dateSet selections', () => {
    // Act / Assert
    expect(
      describeDateFilter(
        date([
          { op: 'after', value: '2026-06-01' },
          { op: 'before', value: '2026-06-30' },
        ]),
      ),
    ).toBe('Multiple conditions')
    expect(
      describeDateFilter({ type: 'dateSet', values: ['2026-06-21'] }),
    ).toBe('2026-06-21')
    expect(
      describeDateFilter({
        type: 'dateSet',
        values: ['2026-06-21', '2026-06-22'],
      }),
    ).toBe('2 dates')
  })

  it('returns empty string when there is nothing to summarize', () => {
    // Act / Assert
    expect(describeDateFilter(undefined)).toBe('')
    expect(describeDateFilter({ type: 'dateSet', values: [] })).toBe('')
    expect(describeDateFilter(date([{ op: 'equals', value: null }]))).toBe('')
  })
})
