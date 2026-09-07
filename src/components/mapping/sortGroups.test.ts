import { describe, it, expect } from 'vitest'
import { sortGroups } from './MapEvents'
import { UnmappedGroup } from '../../api/mapping'

const group = (over: Partial<UnmappedGroup>): UnmappedGroup => ({
  key: over.title ?? 'k',
  title: 'Standup',
  categories: '',
  typeName: 'Work',
  eventCount: 1,
  timedMinutes: 30,
  allDayCount: 0,
  eventIds: [1],
  ...over
})

const titles = (groups: UnmappedGroup[]) => groups.map(g => g.title)

describe('sortGroups', () => {
  describe('by count', () => {
    const groups = [
      group({ title: 'Once', eventCount: 1 }),
      group({ title: 'Often', eventCount: 23 }),
      group({ title: 'Sometimes', eventCount: 5 })
    ]

    /* The default, because the group worth deciding about is the one covering
       the most events. */
    it('puts the biggest first when descending', () => {
      expect(titles(sortGroups(groups, 'count', true))).toEqual(['Often', 'Sometimes', 'Once'])
    })

    it('puts the smallest first when ascending', () => {
      expect(titles(sortGroups(groups, 'count', false))).toEqual(['Once', 'Sometimes', 'Often'])
    })

    it('breaks a tie on title, so the order never wobbles', () => {
      const tied = [
        group({ title: 'Beta', eventCount: 3 }),
        group({ title: 'Alpha', eventCount: 3 })
      ]

      expect(titles(sortGroups(tied, 'count', true))).toEqual(['Alpha', 'Beta'])
    })
  })

  describe('by title', () => {
    const groups = [
      group({ title: 'Retro' }),
      group({ title: 'Daily Standup' }),
      group({ title: 'sprint planning' })
    ]

    it('sorts A to Z', () => {
      expect(titles(sortGroups(groups, 'title', false))).toEqual([
        'Daily Standup',
        'Retro',
        'sprint planning'
      ])
    })

    it('sorts Z to A', () => {
      expect(titles(sortGroups(groups, 'title', true))).toEqual([
        'sprint planning',
        'Retro',
        'Daily Standup'
      ])
    })

    /* localeCompare, so case does not split the alphabet in two. */
    it('ignores case', () => {
      const mixed = [group({ title: 'beta' }), group({ title: 'Alpha' })]

      expect(titles(sortGroups(mixed, 'title', false))).toEqual(['Alpha', 'beta'])
    })
  })

  describe('by category', () => {
    const groups = [
      group({ title: 'Retro', categories: 'Scrum' }),
      group({ title: 'Interview', categories: 'Hiring' }),
      group({ title: 'Lunch', categories: '' })
    ]

    it('sorts A to Z', () => {
      expect(titles(sortGroups(groups, 'category', false))).toEqual([
        'Interview',
        'Retro',
        'Lunch'
      ])
    })

    /* An absence is not a name: putting "no categories" among the As or the
       Zs would only ever be arbitrary, so it sits at the end either way. */
    it('keeps groups with no category last in both directions', () => {
      expect(titles(sortGroups(groups, 'category', true))).toEqual([
        'Retro',
        'Interview',
        'Lunch'
      ])
    })

    it('breaks a tie on title', () => {
      const tied = [
        group({ title: 'Zulu', categories: 'Scrum' }),
        group({ title: 'Alpha', categories: 'Scrum' })
      ]

      expect(titles(sortGroups(tied, 'category', true))).toEqual(['Alpha', 'Zulu'])
    })
  })

  it('leaves the caller their own array', () => {
    const groups = [group({ title: 'B', eventCount: 1 }), group({ title: 'A', eventCount: 9 })]

    sortGroups(groups, 'title', false)

    expect(titles(groups)).toEqual(['B', 'A'])
  })
})
