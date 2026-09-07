import type { ColumnDef } from './index'
import type { TableState } from './index'

import { buildHeadlessTable } from './test-table'

import {
  getOrderedAllLeafColumns,
  getOrderedVisibleLeafColumns,
  reconcileColumnOrder,
  reorderIds,
} from './column-order'

describe('column-order', () => {
  describe('reconcileColumnOrder', () => {
    it('returns the def order when the stored order is empty', () => {
      // Arrange
      const current = ['a', 'b', 'c']

      // Act
      const result = reconcileColumnOrder([], current)

      // Assert
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('preserves a stored reordering of unchanged columns', () => {
      // Arrange
      const stored = ['c', 'a', 'b']
      const current = ['a', 'b', 'c']

      // Act
      const result = reconcileColumnOrder(stored, current)

      // Assert
      expect(result).toEqual(['c', 'a', 'b'])
    })

    it('drops stored ids for columns that no longer exist', () => {
      // Arrange — 'x' was removed from the defs
      const stored = ['c', 'x', 'a', 'b']
      const current = ['a', 'b', 'c']

      // Act
      const result = reconcileColumnOrder(stored, current)

      // Assert
      expect(result).toEqual(['c', 'a', 'b'])
    })

    it('inserts a newly added column at its def position, not the end', () => {
      // Arrange — 'b' is new (stored order predates it); def order is a,b,c,d
      const stored = ['d', 'a', 'c']
      const current = ['a', 'b', 'c', 'd']

      // Act
      const result = reconcileColumnOrder(stored, current)

      // Assert — 'b' lands between 'a' and 'c' (its def neighbours), while the
      // stored reordering of the others is preserved
      expect(result).toEqual(['d', 'a', 'b', 'c'])
    })

    it('places a new first-def column ahead of its def-later neighbour', () => {
      // Arrange — 'a' is new and sits first in the defs
      const stored = ['c', 'b']
      const current = ['a', 'b', 'c']

      // Act
      const result = reconcileColumnOrder(stored, current)

      // Assert — 'a' precedes 'b' (its only already-placed def-later neighbour)
      expect(result).toEqual(['a', 'c', 'b'])
    })

    it('appends a new last-def column after all stored ids', () => {
      // Arrange — 'c' is new and sits last in the defs
      const stored = ['b', 'a']
      const current = ['a', 'b', 'c']

      // Act
      const result = reconcileColumnOrder(stored, current)

      // Assert
      expect(result).toEqual(['b', 'a', 'c'])
    })
  })

  describe('reorderIds', () => {
    it('moves the active id to the over id position', () => {
      // Arrange / Act
      const result = reorderIds(['a', 'b', 'c', 'd'], 'b', 'd')

      // Assert
      expect(result).toEqual(['a', 'c', 'd', 'b'])
    })

    it('returns the same reference for a no-op move (same id)', () => {
      // Arrange
      const ids = ['a', 'b', 'c']

      // Act
      const result = reorderIds(ids, 'b', 'b')

      // Assert
      expect(result).toBe(ids)
    })

    it('returns the same reference when either id is absent', () => {
      // Arrange
      const ids = ['a', 'b', 'c']

      // Act / Assert
      expect(reorderIds(ids, 'z', 'a')).toBe(ids)
      expect(reorderIds(ids, 'a', 'z')).toBe(ids)
    })
  })

  // Guards the composition the whole feature rests on: columnOrder governs the
  // center section only; each pinned section follows its columnPinning array.
  describe('columnOrder × pinning composition (TanStack)', () => {
    type Item = { a: string; b: string; c: string; d: string }
    const data: Item[] = [{ a: '1', b: '2', c: '3', d: '4' }]
    const columns: ColumnDef<Item, any>[] = [
      { id: 'a', accessorKey: 'a', header: 'A' },
      { id: 'b', accessorKey: 'b', header: 'B' },
      { id: 'c', accessorKey: 'c', header: 'C' },
      { id: 'd', accessorKey: 'd', header: 'D' },
    ]

    const buildTable = (state: Partial<TableState>) =>
      buildHeadlessTable<Item>(data, columns, {
        columnPinning: { start: [], end: [] },
        columnOrder: [],
        ...state,
      })

    /** Rendered leaf order the grid's colgroup uses. */
    const renderedOrder = (table: ReturnType<typeof buildTable>) =>
      [
        ...table.getStartVisibleLeafColumns(),
        ...table.getCenterVisibleLeafColumns(),
        ...table.getEndVisibleLeafColumns(),
      ].map((col) => col.id)

    it('reorders the center section by columnOrder', () => {
      // Arrange / Act
      const table = buildTable({ columnOrder: ['c', 'a', 'b', 'd'] })

      // Assert
      expect(renderedOrder(table)).toEqual(['c', 'a', 'b', 'd'])
    })

    it('orders pinned sections by the pin array, not columnOrder', () => {
      // Arrange — pin d then a left; columnOrder tries the opposite order
      const table = buildTable({
        columnPinning: { start: ['d', 'a'], end: [] },
        columnOrder: ['a', 'b', 'c', 'd'],
      })

      // Act / Assert — left section follows the pin array [d, a]; center keeps
      // columnOrder for the rest
      expect(renderedOrder(table)).toEqual(['d', 'a', 'b', 'c'])
    })

    it('applies columnOrder only within the center when some columns are pinned', () => {
      // Arrange — b pinned right; center order reversed
      const table = buildTable({
        columnPinning: { start: [], end: ['b'] },
        columnOrder: ['d', 'c', 'a', 'b'],
      })

      // Act / Assert — center is [d, c, a] (columnOrder minus pinned), b sticks right
      expect(renderedOrder(table)).toEqual(['d', 'c', 'a', 'b'])
    })
  })

  // getOrderedVisibleLeafColumns/getOrderedAllLeafColumns were ported
  // byte-identically (Task 11) but never got a test of their own. They are
  // correct by delegation — relaying TanStack's already-visibility-aware
  // getStart()/getAfter() rather than summing widths themselves — but the
  // header row, CSV export, and the footer row all depend on them now, and
  // they are exactly what keeps a total (or a sticky pinned column) aligned
  // under its column.
  describe('getOrderedVisibleLeafColumns', () => {
    type Item = { a: string; b: string; c: string; d: string }
    const data: Item[] = [{ a: '1', b: '2', c: '3', d: '4' }]
    const columns: ColumnDef<Item, any>[] = [
      { id: 'a', accessorKey: 'a', header: 'A' },
      { id: 'b', accessorKey: 'b', header: 'B' },
      { id: 'c', accessorKey: 'c', header: 'C' },
      { id: 'd', accessorKey: 'd', header: 'D' },
    ]

    const buildTable = (state: Partial<TableState>) =>
      buildHeadlessTable<Item>(data, columns, {
        columnPinning: { start: [], end: [] },
        columnOrder: [],
        columnVisibility: {},
        ...state,
      })

    const ids = (table: ReturnType<typeof buildTable>) =>
      getOrderedVisibleLeafColumns(table).map((column) => column.id)

    it('excludes a hidden column', () => {
      // Arrange / Act
      const table = buildTable({ columnVisibility: { b: false } })

      // Assert
      expect(ids(table)).toEqual(['a', 'c', 'd'])
    })

    it('does not shift the offsets of pinned columns after a hidden column sitting among them', () => {
      // Arrange — pin a, b, c left; b is hidden, so it must not consume width
      // in c's sticky offset (the misaligned-frozen-column bug this exists to
      // prevent: a hidden pinned column's width silently leaking into the
      // offset of the pinned column after it).
      const table = buildTable({
        columnPinning: { start: ['a', 'b', 'c'], end: [] },
        columnVisibility: { b: false },
      })

      // Act
      const ordered = getOrderedVisibleLeafColumns(table)

      // Assert — b is excluded, and c's start offset is exactly a's own size
      // (not a's size plus the hidden b's)
      expect(ordered.map((column) => column.id)).toEqual(['a', 'c', 'd'])
      const [colA, colC] = ordered
      expect(colC.getStart('start')).toBe(colA.getSize())
    })

    it('reflects a centre-column reorder', () => {
      // Arrange / Act — nothing pinned, so the whole order is the center
      // section and follows columnOrder directly
      const table = buildTable({ columnOrder: ['d', 'b', 'a', 'c'] })

      // Assert
      expect(ids(table)).toEqual(['d', 'b', 'a', 'c'])
    })

    it('cannot move a pinned column into the center via columnOrder', () => {
      // Arrange — 'a' is pinned left; columnOrder tries to place it after 'b'
      const table = buildTable({
        columnPinning: { start: ['a'], end: [] },
        columnOrder: ['b', 'a', 'c', 'd'],
      })

      // Act / Assert — 'a' still renders first (pinned-left), regardless of
      // where columnOrder puts it; the center section (b, c, d) follows
      // columnOrder for the rest
      expect(ids(table)).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  describe('getOrderedAllLeafColumns', () => {
    type Item = { a: string; b: string; c: string; d: string }
    const data: Item[] = [{ a: '1', b: '2', c: '3', d: '4' }]
    const columns: ColumnDef<Item, any>[] = [
      { id: 'a', accessorKey: 'a', header: 'A' },
      { id: 'b', accessorKey: 'b', header: 'B' },
      { id: 'c', accessorKey: 'c', header: 'C' },
      { id: 'd', accessorKey: 'd', header: 'D' },
    ]

    const buildTable = (state: Partial<TableState>) =>
      buildHeadlessTable<Item>(data, columns, {
        columnPinning: { start: [], end: [] },
        columnOrder: [],
        columnVisibility: {},
        ...state,
      })

    const ids = (table: ReturnType<typeof buildTable>) =>
      getOrderedAllLeafColumns(table).map((column) => column.id)

    it('keeps a hidden column in the list, unlike getOrderedVisibleLeafColumns', () => {
      // Arrange / Act
      const table = buildTable({ columnVisibility: { b: false } })

      // Assert — still in its def position; only visibility differs from
      // getOrderedVisibleLeafColumns, not membership
      expect(ids(table)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('a hidden column among pinned ones does not shift the other pinned columns', () => {
      // Arrange — pin a, b, c left; b is hidden
      const table = buildTable({
        columnPinning: { start: ['a', 'b', 'c'], end: [] },
        columnVisibility: { b: false },
      })

      // Act / Assert — the pin array's order is preserved verbatim (hidden or
      // not), and the unpinned column stays in the center
      expect(ids(table)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('orders pinned sections by the pin array, not columnOrder', () => {
      // Arrange
      const table = buildTable({
        columnPinning: { start: ['d', 'a'], end: [] },
        columnOrder: ['a', 'b', 'c', 'd'],
      })

      // Act / Assert
      expect(ids(table)).toEqual(['d', 'a', 'b', 'c'])
    })
  })
})
