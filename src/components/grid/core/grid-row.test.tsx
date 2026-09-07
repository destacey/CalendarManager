import { render, screen, fireEvent } from '@testing-library/react'
import { FlatGridRow, type GridRowClasses } from './grid-row'
import { buildHeadlessTable } from './test-table'
import type { ColumnDef } from './index'

/**
 * `isInteractiveTarget` and `activationProps` in grid-row.tsx are pure
 * functions with no exports of their own — they are exercised here through
 * `FlatGridRow`'s real, rendered `<tr>` so the file stays untouched (no new
 * exports needed to make it testable).
 */

interface TestRow {
  id: number
}

const classes: GridRowClasses = {
  tr: 'tr',
  trAlt: 'trAlt',
  td: 'td',
}

const columns: ColumnDef<TestRow, any>[] = [
  {
    id: 'text',
    accessorKey: 'id',
    cell: () => <span data-testid="plain-text">Plain text</span>,
  },
  {
    id: 'button',
    accessorKey: 'id',
    cell: () => <button data-testid="btn">Click</button>,
  },
  {
    id: 'link',
    accessorKey: 'id',
    cell: () => (
      <a href="#" data-testid="link">
        Link
      </a>
    ),
  },
  {
    id: 'input',
    accessorKey: 'id',
    cell: () => <input data-testid="input" />,
  },
  {
    id: 'select',
    accessorKey: 'id',
    cell: () => (
      <select data-testid="select">
        <option value="a">a</option>
      </select>
    ),
  },
  {
    id: 'textarea',
    accessorKey: 'id',
    cell: () => <textarea data-testid="textarea" />,
  },
  {
    id: 'roleButton',
    accessorKey: 'id',
    cell: () => (
      <span role="button" data-testid="role-button">
        X
      </span>
    ),
  },
  {
    id: 'ignore',
    accessorKey: 'id',
    cell: () => (
      <div data-row-activate="ignore" data-testid="ignore-wrapper">
        <span data-testid="ignore-child">nested</span>
      </div>
    ),
  },
]

/** Renders a single real `FlatGridRow` inside a `<table>`, optionally nested
 *  inside an outer interactive element to probe the bound of the search. */
function renderFlatRow({
  onActivate,
  wrapInOuterButton = false,
}: {
  onActivate?: () => void
  wrapInOuterButton?: boolean
} = {}) {
  const table = buildHeadlessTable<TestRow>([{ id: 1 }], columns)
  const row = table.getRowModel().rows[0]

  const ui = (
    <table>
      <tbody>
        <FlatGridRow
          row={row}
          index={0}
          classes={classes}
          onActivate={onActivate}
          activateLabel="Row 1"
        />
      </tbody>
    </table>
  )

  return render(wrapInOuterButton ? <div role="button">{ui}</div> : ui)
}

describe('isInteractiveTarget (via FlatGridRow click handling)', () => {
  it.each([
    ['button', 'btn'],
    ['link', 'link'],
    ['input', 'input'],
    ['select', 'select'],
    ['textarea', 'textarea'],
  ])('does not activate the row when clicking a %s', (_label, testId) => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId(testId))

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('does not activate the row when clicking an element with role="button"', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId('role-button'))

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('does not activate the row when clicking an element marked data-row-activate="ignore"', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId('ignore-wrapper'))

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('does not activate the row when clicking a descendant of a data-row-activate="ignore" element', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId('ignore-child'))

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('activates the row when clicking plain cell text', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId('plain-text'))

    // Assert
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('still activates on plain cell text when an outer ancestor is itself interactive', () => {
    // Arrange — wrap the whole table in an outer role="button" element (e.g.
    // the grid embedded inside another clickable component). An activatable
    // row always carries role="button" itself, and closest() resolves to the
    // *nearest* match — so it finds the row long before it would ever reach
    // this outer element. This exercises the `hit !== row` self-exclusion
    // clause, exactly as the plain-cell-text test above does; the outer
    // wrapper never becomes reachable and does not add coverage of a
    // separate "bounded search" guard (see grid-row.tsx's `isInteractiveTarget`:
    // its `row.contains(hit)` clause is unreachable from any real caller,
    // because both call sites only exist when the row itself matches the
    // interactive selector). This test documents the observable behavior —
    // an interactive ancestor around the grid doesn't break activation — not
    // the containment guard.
    const onActivate = vi.fn()
    renderFlatRow({ onActivate, wrapInOuterButton: true })

    // Act
    fireEvent.click(screen.getByTestId('plain-text'))

    // Assert
    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})

describe('activationProps (via FlatGridRow keyboard/click handling)', () => {
  it('calls onActivate on a plain click on the row', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act
    fireEvent.click(screen.getByTestId('plain-text'))

    // Assert
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('calls onActivate and prevents default on Enter', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })
    const row = screen.getByRole('button', { name: 'Row 1' })

    // Act — fireEvent's return value is the DOM dispatchEvent result: false
    // means some handler called preventDefault on a cancelable event.
    const notCanceled = fireEvent.keyDown(row, { key: 'Enter' })

    // Assert
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(notCanceled).toBe(false)
  })

  it('calls onActivate and prevents default on Space', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })
    const row = screen.getByRole('button', { name: 'Row 1' })

    // Act
    const notCanceled = fireEvent.keyDown(row, { key: ' ' })

    // Assert
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(notCanceled).toBe(false)
  })

  it('does nothing on an unrelated key', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })
    const row = screen.getByRole('button', { name: 'Row 1' })

    // Act
    const notCanceled = fireEvent.keyDown(row, { key: 'a' })

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
    expect(notCanceled).toBe(true)
  })

  it('does not call onActivate on Enter/Space when the target is interactive', () => {
    // Arrange
    const onActivate = vi.fn()
    renderFlatRow({ onActivate })

    // Act — focus + keydown on the button itself; the row's onKeyDown handler
    // still fires (event bubbles to the <tr>) but must see an interactive
    // target and bail out.
    fireEvent.keyDown(screen.getByTestId('btn'), { key: 'Enter' })

    // Assert
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('renders no activation affordance and does nothing when onActivate is omitted', () => {
    // Arrange
    const { container } = renderFlatRow()
    const row = container.querySelector('tr')

    // Assert — no role/tabIndex/aria-label leak onto a non-activatable row.
    expect(row).not.toBeNull()
    expect(row).not.toHaveAttribute('role')
    expect(row).not.toHaveAttribute('tabindex')
    expect(row).not.toHaveAttribute('aria-label')

    // Act / Assert — nothing throws with no onActivate wired up.
    expect(() => fireEvent.click(screen.getByTestId('plain-text'))).not.toThrow()
    expect(() => fireEvent.keyDown(row!, { key: 'Enter' })).not.toThrow()
    expect(() => fireEvent.keyDown(row!, { key: ' ' })).not.toThrow()
  })
})
