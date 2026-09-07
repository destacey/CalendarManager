import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ColumnDef } from './index'
import type { ColumnVisibilityState as VisibilityState } from '@tanstack/react-table'
import type { Table, TableState } from './index'

import { buildHeadlessTable } from './test-table'

import {
  COLUMN_MENU_KEYS,
  ColumnChooserModal,
  ColumnMenuTrigger,
  buildColumnMenuItems,
  getColumnChooserOptions,
  type ColumnMenuItemsInput,
  type ColumnMenuTriggerProps,
} from './column-menu'

type Item = { name: string; team: string; secret: string; flagged: string }

const data: Item[] = [
  { name: 'Widget', team: 'Falcons', secret: 'x', flagged: 'y' },
]

const buildChooserTable = (
  columns: ColumnDef<Item, any>[],
  columnVisibility: VisibilityState = {},
) => {
  const state: Partial<TableState> = {
    columnVisibility,
    columnPinning: { start: [], end: [] },
    columnSizing: {},
  }
  return buildHeadlessTable<Item>(data, columns, state)
}

/** Flattened keys of a built items array (submenu children inlined). */
const itemKeys = (items: ReturnType<typeof buildColumnMenuItems>): string[] =>
  (items ?? []).flatMap((item) => {
    if (!item || !('key' in item) || item.key == null) return []
    const children =
      'children' in item && Array.isArray(item.children)
        ? itemKeys(item.children as ReturnType<typeof buildColumnMenuItems>)
        : []
    return [String(item.key), ...children]
  })

const baseInput: ColumnMenuItemsInput = {
  canSort: true,
  sortState: false,
  canPin: true,
  pinnedState: false,
  canResize: true,
  hasHidableColumns: true,
}

describe('column-menu', () => {
  describe('getColumnChooserOptions', () => {
    it('lists hidable leaf columns with their visibility', () => {
      // Arrange
      const table = buildChooserTable(
        [
          { id: 'name', accessorKey: 'name', header: 'Name' },
          { id: 'team', accessorKey: 'team', header: 'Team' },
        ],
        { team: false },
      )

      // Act
      const options = getColumnChooserOptions(table)

      // Assert
      expect(options).toEqual([
        { id: 'name', label: 'Name', visible: true },
        { id: 'team', label: 'Team', visible: false },
      ])
    })

    it('keeps a hiddenByDefault column listed, so the user can bring it back', () => {
      // Arrange — the injected Id column's shape: hidden, but not meta.unavailable
      const table = buildChooserTable(
        [
          { id: 'name', accessorKey: 'name', header: 'Name' },
          {
            id: 'id',
            accessorKey: 'id',
            header: 'Id',
            meta: { hiddenByDefault: true },
          },
        ],
        { id: false },
      )

      // Act
      const options = getColumnChooserOptions(table)

      // Assert
      expect(options).toEqual([
        { id: 'name', label: 'Name', visible: true },
        { id: 'id', label: 'Id', visible: false },
      ])
    })

    it('excludes consumer-hidden (meta.unavailable), unhidable, and unlabeled columns', () => {
      // Arrange — meta.unavailable=true is consumer-controlled; enableHiding=false is
      // locked; an empty header with no exportHeader (actions-style) has no
      // displayable label
      const table = buildChooserTable([
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'secret',
          accessorKey: 'secret',
          header: 'Secret',
          meta: { unavailable: true },
        },
        {
          id: 'flagged',
          accessorKey: 'flagged',
          header: 'Flagged',
          enableHiding: false,
        },
        { id: 'actions', header: '' },
      ])

      // Act
      const options = getColumnChooserOptions(table)

      // Assert
      expect(options.map((o) => o.id)).toEqual(['name'])
    })

    it('stays excluded even when the user had previously chosen to show it — unavailable beats any saved preference', () => {
      // Arrange — a saved layout from before the column became unavailable
      // would carry an explicit `secret: true` in columnVisibility; that
      // saved choice must not defeat the consumer's permission flag.
      const table = buildChooserTable(
        [
          { id: 'name', accessorKey: 'name', header: 'Name' },
          {
            id: 'secret',
            accessorKey: 'secret',
            header: 'Secret',
            meta: { unavailable: true },
          },
        ],
        { secret: true },
      )

      // Act
      const options = getColumnChooserOptions(table)

      // Assert — absent from the chooser regardless of the saved visibility
      expect(options.map((o) => o.id)).toEqual(['name'])
    })

    it('falls back to meta.exportHeader when the header is not a string', () => {
      // Arrange
      const table = buildChooserTable([
        {
          id: 'name',
          accessorKey: 'name',
          header: () => null,
          meta: { exportHeader: 'Name (export)' },
        },
      ])

      // Act
      const options = getColumnChooserOptions(table)

      // Assert
      expect(options).toEqual([
        { id: 'name', label: 'Name (export)', visible: true },
      ])
    })

    it('resolves visibility through grouped column defs', () => {
      // Arrange
      const table = buildChooserTable([
        {
          id: 'group',
          header: 'Group',
          columns: [
            { id: 'name', accessorKey: 'name', header: 'Name' },
            { id: 'team', accessorKey: 'team', header: 'Team' },
          ],
        },
      ])

      // Act
      const options = getColumnChooserOptions(table)

      // Assert — leaves only, no band entry
      expect(options.map((o) => o.id)).toEqual(['name', 'team'])
    })
  })

  describe('buildColumnMenuItems', () => {
    it('builds the full menu for a sortable, pinnable, resizable column', () => {
      // Arrange / Act
      const keys = itemKeys(buildColumnMenuItems(baseInput))

      // Assert
      expect(keys).toEqual([
        COLUMN_MENU_KEYS.sortAsc,
        COLUMN_MENU_KEYS.sortDesc,
        COLUMN_MENU_KEYS.pin,
        COLUMN_MENU_KEYS.pinLeft,
        COLUMN_MENU_KEYS.pinRight,
        COLUMN_MENU_KEYS.pinNone,
        COLUMN_MENU_KEYS.autosizeThis,
        COLUMN_MENU_KEYS.autosizeAll,
        COLUMN_MENU_KEYS.chooseColumns,
        COLUMN_MENU_KEYS.reset,
      ])
    })

    it('adds Clear Sort only while the column is sorted', () => {
      // Arrange / Act
      const unsorted = itemKeys(buildColumnMenuItems(baseInput))
      const sorted = itemKeys(
        buildColumnMenuItems({ ...baseInput, sortState: 'asc' }),
      )

      // Assert
      expect(unsorted).not.toContain(COLUMN_MENU_KEYS.sortClear)
      expect(sorted).toContain(COLUMN_MENU_KEYS.sortClear)
    })

    it('omits sections a column does not support', () => {
      // Arrange / Act — e.g. the actions column: no sort, no pin, no resize
      const keys = itemKeys(
        buildColumnMenuItems({
          ...baseInput,
          canSort: false,
          canPin: false,
          canResize: false,
          hasHidableColumns: false,
        }),
      )

      // Assert — Autosize All and Reset remain grid-level actions
      expect(keys).toEqual([
        COLUMN_MENU_KEYS.autosizeAll,
        COLUMN_MENU_KEYS.reset,
      ])
    })

    it('marks the active pin option with a check icon', () => {
      // Arrange / Act
      const items = buildColumnMenuItems({
        ...baseInput,
        pinnedState: 'start',
      })
      const pin = (items ?? []).find(
        (item) => item && 'key' in item && item.key === COLUMN_MENU_KEYS.pin,
      ) as { children: { key: string; icon?: unknown }[] }

      // Assert — only Pin Left carries the check
      const iconsByKey = Object.fromEntries(
        pin.children.map((child) => [child.key, child.icon !== undefined]),
      )
      expect(iconsByKey).toEqual({
        [COLUMN_MENU_KEYS.pinLeft]: true,
        [COLUMN_MENU_KEYS.pinRight]: false,
        [COLUMN_MENU_KEYS.pinNone]: false,
      })
    })
  })

  describe('ColumnChooserModal', () => {
    const chooserColumns: ColumnDef<Item, any>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      { id: 'team', accessorKey: 'team', header: 'Team' },
      { id: 'flagged', accessorKey: 'flagged', header: 'Flagged' },
    ]

    const renderModal = (
      columnVisibility: VisibilityState = {},
      onToggleColumn = vi.fn(),
      onClose = vi.fn(),
    ) => {
      const table = buildChooserTable(chooserColumns, columnVisibility)
      render(
        <ColumnChooserModal
          table={table}
          open
          onClose={onClose}
          onToggleColumn={onToggleColumn}
        />,
      )
      return { onToggleColumn, onClose }
    }

    /** The checkbox input inside the row labeled `label`. */
    const checkboxFor = (label: string) =>
      screen
        .getByText(label)
        .closest('label')!
        .querySelector('input[type="checkbox"]') as HTMLInputElement

    it('lists every hidable column with its current visibility', () => {
      // Arrange / Act
      renderModal({ team: false })

      // Assert
      expect(checkboxFor('Name').checked).toBe(true)
      expect(checkboxFor('Team').checked).toBe(false)
      expect(checkboxFor('Flagged').checked).toBe(true)
    })

    it('toggles apply per column without closing the modal', () => {
      // Arrange
      const { onToggleColumn, onClose } = renderModal({ team: false })

      // Act — hide one column, show another (multiple changes in one visit)
      fireEvent.click(checkboxFor('Flagged'))
      fireEvent.click(checkboxFor('Team'))

      // Assert
      expect(onToggleColumn).toHaveBeenNthCalledWith(1, 'flagged', false)
      expect(onToggleColumn).toHaveBeenNthCalledWith(2, 'team', true)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('locks the last visible column on', () => {
      // Arrange / Act — only Name still visible
      const { onToggleColumn } = renderModal({ team: false, flagged: false })

      // Assert — its checkbox is disabled and clicking does nothing
      expect(checkboxFor('Name').disabled).toBe(true)
      fireEvent.click(checkboxFor('Name'))
      expect(onToggleColumn).not.toHaveBeenCalled()
    })

    it('filters the list by search', () => {
      // Arrange
      renderModal()

      // Act
      fireEvent.change(screen.getByPlaceholderText('Search columns...'), {
        target: { value: 'tea' },
      })

      // Assert
      expect(screen.getByText('Team')).toBeInTheDocument()
      expect(screen.queryByText('Flagged')).not.toBeInTheDocument()
    })

    it('closes via the Done button', () => {
      // Arrange
      const { onClose } = renderModal()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('ColumnMenuTrigger', () => {
    const menuColumns: ColumnDef<Item, any>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      { id: 'team', accessorKey: 'team', header: 'Team' },
    ]

    const buildMenuTable = (state: Partial<TableState> = {}) =>
      buildHeadlessTable<Item>(data, menuColumns, {
        columnVisibility: {},
        columnPinning: { start: [], end: [] },
        columnSizing: {},
        sorting: [],
        ...state,
      })

    /** Mirrors the grid's real usage: the grid owns the open-menu id and
     *  toggles it via onOpenChange — a bare `open` prop would never flip. */
    function ControlledTrigger({
      table,
      columnId = 'name',
      hasHidableColumns = true,
      onOpenColumnChooser = vi.fn(),
      onAutosizeColumn = vi.fn(),
      onAutosizeAllColumns = vi.fn(),
      onResetColumns = vi.fn(),
    }: {
      table: Table<Item>
      columnId?: string
    } & Partial<
      Pick<
        ColumnMenuTriggerProps<Item>,
        | 'hasHidableColumns'
        | 'onOpenColumnChooser'
        | 'onAutosizeColumn'
        | 'onAutosizeAllColumns'
        | 'onResetColumns'
      >
    >) {
      const [open, setOpen] = useState(false)
      const header = table.getFlatHeaders().find((h) => h.column.id === columnId)!
      return (
        <ColumnMenuTrigger
          header={header}
          table={table}
          open={open}
          onOpenChange={setOpen}
          hasHidableColumns={hasHidableColumns}
          onOpenColumnChooser={onOpenColumnChooser}
          onAutosizeColumn={onAutosizeColumn}
          onAutosizeAllColumns={onAutosizeAllColumns}
          onResetColumns={onResetColumns}
        />
      )
    }

    const renderTrigger = (
      table: Table<Item>,
      overrides: Partial<{
        columnId: string
        hasHidableColumns: boolean
        onOpenColumnChooser: () => void
        onAutosizeColumn: (columnId: string) => void
        onAutosizeAllColumns: () => void
        onResetColumns: () => void
      }> = {},
    ) => {
      const callbacks = {
        onOpenColumnChooser: vi.fn(),
        onAutosizeColumn: vi.fn(),
        onAutosizeAllColumns: vi.fn(),
        onResetColumns: vi.fn(),
        ...overrides,
      }
      render(
        <ControlledTrigger
          table={table}
          columnId={overrides.columnId}
          hasHidableColumns={overrides.hasHidableColumns}
          {...callbacks}
        />,
      )
      return callbacks
    }

    /** Opens the dropdown by clicking the `⋮` trigger button. */
    const openMenu = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Column menu' }))

    /** Hovers the "Pin Column" item to reveal its submenu, then returns the
     *  named child item (substring match — the icon's own label is folded
     *  into the item's accessible name, e.g. "pin-left Pin Left"). */
    const openPinSubmenu = async (name: RegExp) => {
      const pinParent = await screen.findByRole('menuitem', {
        name: /pin column/i,
      })
      fireEvent.mouseEnter(pinParent)
      return screen.findByRole('menuitem', { name })
    }

    it('sets ascending sort with the clicked column id, not flipped desc', async () => {
      // Arrange
      const table = buildMenuTable()
      const setSortingSpy = vi.spyOn(table, 'setSorting')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /sort ascending/i,
      })
      fireEvent.click(item)

      // Assert — desc: false, or a swapped case would pass this
      expect(setSortingSpy).toHaveBeenCalledWith([{ id: 'name', desc: false }])
    })

    it('sets descending sort with the clicked column id', async () => {
      // Arrange
      const table = buildMenuTable()
      const setSortingSpy = vi.spyOn(table, 'setSorting')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /sort descending/i,
      })
      fireEvent.click(item)

      // Assert — desc: true, or a swapped case would pass this
      expect(setSortingSpy).toHaveBeenCalledWith([{ id: 'name', desc: true }])
    })

    it('clears sort for just the clicked column while the column is sorted', async () => {
      // Arrange — Clear Sort only appears while this column is sorted
      const table = buildMenuTable({ sorting: [{ id: 'name', desc: false }] })
      const setSortingSpy = vi.spyOn(table, 'setSorting')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', { name: /clear sort/i })
      fireEvent.click(item)
      const updater = setSortingSpy.mock.calls[0][0] as (
        prev: { id: string; desc: boolean }[],
      ) => { id: string; desc: boolean }[]

      // Assert — filters out this column's own sort entry
      expect(
        updater([
          { id: 'name', desc: false },
          { id: 'team', desc: true },
        ]),
      ).toEqual([{ id: 'team', desc: true }])
    })

    it('pins the column left', async () => {
      // Arrange
      const table = buildMenuTable()
      const header = table.getFlatHeaders().find((h) => h.column.id === 'name')!
      const pinSpy = vi.spyOn(header.column, 'pin')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await openPinSubmenu(/pin left/i)
      fireEvent.click(item)

      // Assert — 'start', or a swapped side would pass this
      expect(pinSpy).toHaveBeenCalledWith('start')
    })

    it('pins the column right', async () => {
      // Arrange
      const table = buildMenuTable()
      const header = table.getFlatHeaders().find((h) => h.column.id === 'name')!
      const pinSpy = vi.spyOn(header.column, 'pin')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await openPinSubmenu(/pin right/i)
      fireEvent.click(item)

      // Assert — 'end', or a swapped side would pass this
      expect(pinSpy).toHaveBeenCalledWith('end')
    })

    it('unpins a currently pinned column via No Pin', async () => {
      // Arrange — start pinned left, so pinnedState is truthy going in
      const table = buildMenuTable({ columnPinning: { start: ['name'], end: [] } })
      const header = table.getFlatHeaders().find((h) => h.column.id === 'name')!
      const pinSpy = vi.spyOn(header.column, 'pin')
      renderTrigger(table)

      // Act
      openMenu()
      const item = await openPinSubmenu(/no pin/i)
      fireEvent.click(item)

      // Assert
      expect(pinSpy).toHaveBeenCalledWith(false)
    })

    it('opens the Choose Columns modal trigger callback (the menu\'s way of hiding a column)', async () => {
      // Arrange
      const table = buildMenuTable()
      const { onOpenColumnChooser } = renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /choose columns/i,
      })
      fireEvent.click(item)

      // Assert
      expect(onOpenColumnChooser).toHaveBeenCalledTimes(1)
    })

    it('autosizes just the clicked column, passing its id', async () => {
      // Arrange
      const table = buildMenuTable()
      const { onAutosizeColumn } = renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /autosize this column/i,
      })
      fireEvent.click(item)

      // Assert
      expect(onAutosizeColumn).toHaveBeenCalledWith('name')
    })

    it('autosizes all columns', async () => {
      // Arrange
      const table = buildMenuTable()
      const { onAutosizeAllColumns } = renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /autosize all columns/i,
      })
      fireEvent.click(item)

      // Assert
      expect(onAutosizeAllColumns).toHaveBeenCalledTimes(1)
    })

    it('resets columns', async () => {
      // Arrange
      const table = buildMenuTable()
      const { onResetColumns } = renderTrigger(table)

      // Act
      openMenu()
      const item = await screen.findByRole('menuitem', {
        name: /reset columns/i,
      })
      fireEvent.click(item)

      // Assert
      expect(onResetColumns).toHaveBeenCalledTimes(1)
    })
  })
})
