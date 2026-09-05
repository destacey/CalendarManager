import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { render } from '../../test/utils'
import { GroupCard } from './MapEvents'

const group = {
  key: 'daily standup|scrum',
  title: 'Daily Standup',
  categories: 'Scrum',
  typeName: 'Work',
  eventCount: 23,
  timedMinutes: 690,
  allDayCount: 0,
  eventIds: [1, 2, 3]
}

const renderCard = (props: { selected: boolean; dragActive: boolean }) => {
  render(
    <DndContext>
      <GroupCard group={group} onSelect={vi.fn()} {...props} />
    </DndContext>
  )
  return screen.getByRole('button', { name: /Daily Standup, 23 events/ })
}

const opacityOf = (el: HTMLElement) => el.style.opacity

describe('GroupCard', () => {
  it('is fully opaque when nothing is being dragged', () => {
    expect(opacityOf(renderCard({ selected: false, dragActive: false }))).toBe('1')
  })

  it('stays opaque when selected but idle', () => {
    expect(opacityOf(renderCard({ selected: true, dragActive: false }))).toBe('1')
  })

  /* The bug: dragging three selected groups dimmed only the card under the
     cursor, so the other two looked like they were staying behind even though
     the overlay said "3 groups". */
  it('dims while any card of its selection is being dragged', () => {
    expect(opacityOf(renderCard({ selected: true, dragActive: true }))).toBe('0.4')
  })

  it('does not dim an unselected card during a drag', () => {
    expect(opacityOf(renderCard({ selected: false, dragActive: true }))).toBe('1')
  })

  it('marks its selected state for assistive tech', () => {
    expect(renderCard({ selected: true, dragActive: false })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
