import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The grid renders date filter panels, which need the real dayjs — the global
// test setup replaces the module with a single fixed-value stub.
vi.unmock('dayjs')

// CSV export writes through the native save dialog (src/api/files), not a
// browser download. Mocking `saveFile` captures the exact bytes while leaving
// the CSV generation real, so these tests assert on real CSV content.
vi.mock('../../api/files', () => ({ saveFile: vi.fn() }))

/**
 * dnd-kit cannot be driven in jsdom: collision detection needs real element
 * geometry and jsdom reports everything zero-sized. So no test here simulates a
 * drag. The row-reorder PAYLOAD, though, is pure arithmetic computed in
 * DataGrid's own drop handler — this records the props of every DndContext the
 * grid mounts (while still rendering the real one, so nothing else changes) so
 * a test can invoke that handler directly.
 */
const dnd = vi.hoisted(() => ({ contexts: [] as any[] }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: any) => {
      dnd.contexts.push(props)
      return createElement(actual.DndContext, props)
    },
  }
})

import { createRef } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../test/utils'
import { saveFile } from '../../api/files'
import DataGrid from './DataGrid'
import styles from './DataGrid.module.css'
import {
  DragHandleCell,
  SET_FILTER_BLANK,
  createActionsColumn,
  gridStateStorageKey,
  type ColumnDef,
} from './core'
import { createCsvColumn } from './core/csv-column'
import type {
  DataGridColumnMeta,
  DataGridHandle,
  GridColumnContext,
  RowReorderEvent,
} from './types'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * virtual-core's calculateRange returns an EMPTY range (not an overscan-sized
 * one) at zero height, so without this the grid renders a header and no body
 * rows at all, and every "no rows" assertion would pass for the wrong reason.
 * The component carries `data-grid-body-viewport` on that element precisely so
 * a test can give it a height.
 *
 * Row heights need no equivalent stub: DataGridBody never calls
 * `measureElement`, so the virtualizer keeps its 28px estimate throughout.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

interface Flag {
  id: number
  name: string
  isEnabled: boolean
  type: string
}

const DATA: Flag[] = [
  { id: 1, name: 'planning-poker', isEnabled: true, type: 'System' },
  { id: 2, name: 'roadmap', isEnabled: false, type: 'User' },
  { id: 3, name: 'insights', isEnabled: true, type: 'User' },
]

const columns: ColumnDef<Flag, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  {
    id: 'type',
    accessorKey: 'type',
    header: 'Type',
    meta: {
      filterType: 'set',
      filterOptions: [
        { label: 'System', value: 'System' },
        { label: 'User', value: 'User' },
      ],
    } satisfies DataGridColumnMeta,
  },
  {
    id: 'isEnabled',
    accessorKey: 'isEnabled',
    header: 'Enabled',
    meta: { columnType: 'yesNo' } satisfies DataGridColumnMeta,
  },
]

type GridProps = Partial<Parameters<typeof DataGrid<Flag>>[0]> & {
  ref?: React.Ref<DataGridHandle<Flag>>
}

const renderGrid = ({ ref, ...props }: GridProps = {}) =>
  render(<DataGrid<Flag> ref={ref} data={DATA} columns={columns} {...props} />)

/** Cells for a given column id across all body rows. */
const bodyCells = (columnId: string) =>
  Array.from(
    document.querySelectorAll(`tbody td[data-column-id="${columnId}"]`),
  ) as HTMLTableCellElement[]

/** data-column-id of every leaf header cell, in rendered order. */
const headerOrder = () => {
  const headerRow = document.querySelector(
    'thead tr:not([data-role])',
  ) as HTMLElement
  return Array.from(headerRow.querySelectorAll('th[data-column-id]')).map(
    (th) => th.getAttribute('data-column-id'),
  )
}

const floatingRow = () =>
  document.querySelector(
    'tr[data-role="floating-filters"]',
  ) as HTMLTableRowElement

/** The CSV export button's `<button>`. */
const exportButton = () =>
  document
    .querySelector('[aria-label="download"]')
    ?.closest('button') as HTMLButtonElement

/**
 * Clicks the toolbar export button and waits for the save to be attempted.
 * Export goes through an async native save dialog, so unlike the synchronous
 * browser download it replaced, the click does not finish the work.
 */
const clickExport = async () => {
  fireEvent.click(exportButton())
  await waitFor(() => expect(saveFile).toHaveBeenCalled())
}

/** The CSV text handed to the last `saveFile` call, minus the UTF-8 BOM. */
const lastCsv = () =>
  new TextDecoder()
    .decode(vi.mocked(saveFile).mock.calls.at(-1)![1])
    .replace(/^﻿/, '')

/** The grid's ROW drag context (the header's carries `modifiers`; the column
 *  chooser's has no `onDragStart`). Latest render wins. */
const rowDragEnd = () => {
  const ctx = [...dnd.contexts]
    .reverse()
    .find((props) => !props.modifiers && props.onDragStart)
  if (!ctx) throw new Error('no row DndContext mounted')
  return ctx.onDragEnd as (event: DragEndEvent) => void
}

/** Invokes the row drop handler directly — see the `@dnd-kit/core` mock. */
const dropRow = (activeId: string, overId: string | null) =>
  act(() => {
    rowDragEnd()({
      active: { id: activeId },
      over: overId === null ? null : { id: overId },
    } as unknown as DragEndEvent)
  })

beforeEach(() => {
  dnd.contexts.length = 0
  vi.mocked(saveFile).mockReset()
  vi.mocked(saveFile).mockResolvedValue(true)
})

describe('DataGrid', () => {
  describe('basics', () => {
    it('renders a header cell per column', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Type')).toBeInTheDocument()
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })

    it('renders a row per data item', () => {
      // Arrange / Act
      renderGrid()

      // Assert — name cells reflect the three rows
      const names = bodyCells('name').map((c) => c.textContent)
      expect(names).toEqual(['planning-poker', 'roadmap', 'insights'])
    })

    it('shows the empty message when there is no data', () => {
      // Arrange / Act
      renderGrid({ data: [], emptyMessage: 'Nothing here' })

      // Assert
      expect(screen.getByText('Nothing here')).toBeInTheDocument()
      expect(bodyCells('name')).toHaveLength(0)
    })

    it('treats undefined data (query still loading) as an empty grid', () => {
      // Arrange / Act — consumers pass query-hook data straight through, which
      // is undefined until the fetch resolves
      renderGrid({ data: undefined, isLoading: true })

      // Assert — loading spinner, no crash, zero row count
      expect(document.querySelector('.ant-spin')).toBeInTheDocument()
      expect(screen.getByText('0 of 0')).toBeInTheDocument()
    })

    it('shows a loading spinner when isLoading', () => {
      // Arrange / Act
      const { container } = renderGrid({ isLoading: true })

      // Assert — antd Spin renders .ant-spin
      expect(container.querySelector('.ant-spin')).toBeInTheDocument()
    })

    it('reports displayed-of-total count in the toolbar', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(screen.getByText('3 of 3')).toBeInTheDocument()
    })
  })

  describe('meta.unavailable', () => {
    it('omits a column from the DOM when meta.unavailable is true', () => {
      // Arrange
      const hiddenCols: ColumnDef<Flag, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'type',
          accessorKey: 'type',
          header: 'Type',
          meta: { unavailable: true } satisfies DataGridColumnMeta,
        },
      ]

      // Act
      renderGrid({ columns: hiddenCols })

      // Assert — Type header absent, its cells absent, Name still present
      expect(screen.queryByText('Type')).not.toBeInTheDocument()
      expect(bodyCells('type')).toHaveLength(0)
      expect(screen.getByText('Name')).toBeInTheDocument()
    })

    it('shows the column when meta.unavailable is false', () => {
      // Arrange
      const cols: ColumnDef<Flag, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'type',
          accessorKey: 'type',
          header: 'Type',
          meta: { unavailable: false } satisfies DataGridColumnMeta,
        },
      ]

      // Act
      renderGrid({ columns: cols })

      // Assert
      expect(screen.getByText('Type')).toBeInTheDocument()
      expect(bodyCells('type').length).toBeGreaterThan(0)
    })

    it('stays hidden even when a persisted layout says the user showed it', async () => {
      // meta.unavailable is a PERMISSION, not a preference: mergeColumnVisibility
      // forces it hidden AFTER the user's saved layer is applied, and the column
      // chooser omits it entirely. Nothing could test the two together until the
      // component wired them.
      // Arrange — a stored layout that explicitly marks `type` visible
      window.localStorage.clear()
      window.localStorage.setItem(
        gridStateStorageKey('permission-grid'),
        JSON.stringify({
          columnSizing: {},
          userColumnVisibility: { type: true },
          columnPinning: { start: [], end: [] },
        }),
      )
      const cols: ColumnDef<Flag, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'type',
          accessorKey: 'type',
          header: 'Type',
          meta: { unavailable: true } satisfies DataGridColumnMeta,
        },
        {
          id: 'isEnabled',
          accessorKey: 'isEnabled',
          header: 'Enabled',
          meta: { columnType: 'yesNo' } satisfies DataGridColumnMeta,
        },
      ]

      try {
        // Act
        renderGrid({ columns: cols, persistStateKey: 'permission-grid' })

        // Assert — absent from the body and the header
        expect(bodyCells('type')).toHaveLength(0)
        expect(
          document.querySelector('th[data-column-id="type"]'),
        ).not.toBeInTheDocument()
        expect(headerOrder()).toEqual(['name', 'isEnabled'])

        // Act — open Choose Columns from any column's menu
        fireEvent.click(screen.getAllByLabelText('Column menu')[0])
        fireEvent.click(await screen.findByText('Choose Columns'))
        const chooser = await screen.findByRole('dialog')

        // Assert — the user cannot even ask for it back
        expect(within(chooser).getByText('Name')).toBeInTheDocument()
        expect(within(chooser).getByText('Enabled')).toBeInTheDocument()
        expect(within(chooser).queryByText('Type')).not.toBeInTheDocument()
      } finally {
        window.localStorage.clear()
      }
    })
  })

  describe('yesNo column type', () => {
    it('renders boolean values as Yes / No', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      const enabled = bodyCells('isEnabled').map((c) => c.textContent)
      expect(enabled).toEqual(['Yes', 'No', 'Yes'])
    })

    it('exports yesNo columns as Yes / No (not true / false)', async () => {
      // Arrange
      renderGrid()

      // Act
      await clickExport()

      // Assert — the generated CSV contains Yes/No, not true/false
      expect(saveFile).toHaveBeenCalledTimes(1)
      const csv = lastCsv()
      expect(csv).toContain('Yes')
      expect(csv).toContain('No')
      expect(csv).not.toMatch(/\btrue\b/)
      expect(csv).not.toMatch(/\bfalse\b/)
    })
  })

  describe('auto-injected Id column', () => {
    it('is hidden on a grid whose rows carry an id', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(bodyCells('id')).toHaveLength(0)
    })

    it('stays out of the export while hidden', async () => {
      // Arrange
      renderGrid()

      // Act
      await clickExport()

      // Assert — the header row names the visible columns only
      const csv = lastCsv()
      expect(csv).toContain('Name')
      expect(csv.split('\n')[0]).not.toContain('Id')
    })

    it('is not added when the consumer opts out', () => {
      // Arrange / Act
      renderGrid({ includeIdColumn: false })

      // Assert
      expect(bodyCells('id')).toHaveLength(0)
    })

    it('leaves a consumer-defined id column visible', () => {
      // Arrange — the consumer claims `id` themselves
      const cols: ColumnDef<Flag, unknown>[] = [
        { id: 'id', accessorKey: 'id', header: 'Job Id' },
        { id: 'name', accessorKey: 'name', header: 'Name' },
      ]

      // Act
      renderGrid({ columns: cols })

      // Assert — the consumer's column renders, unaffected by injection
      expect(screen.getByText('Job Id')).toBeInTheDocument()
      expect(bodyCells('id').map((c) => c.textContent)).toEqual(['1', '2', '3'])
    })

    it('is not added when the rows have no id', () => {
      // Arrange
      interface Keyed {
        key: number
        name: string
      }
      const cols: ColumnDef<Keyed, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
      ]

      // Act
      render(
        <DataGrid<Keyed> data={[{ key: 1, name: 'Alpha' }]} columns={cols} />,
      )

      // Assert
      expect(bodyCells('id')).toHaveLength(0)
    })
  })

  describe('CSV export', () => {
    interface Obj {
      key: number
      name: string
      status: { name: string }
      team: { name: string } | null
    }

    const OBJ_DATA: Obj[] = [
      {
        key: 1,
        name: 'Alpha',
        status: { name: 'Active' },
        team: { name: 'Juice' },
      },
      { key: 2, name: 'Beta', status: { name: 'Closed' }, team: null },
    ]

    /** Renders an Obj grid, exports, and returns the CSV. */
    const exportCsv = async (cols: ColumnDef<Obj, unknown>[]) => {
      render(<DataGrid<Obj> data={OBJ_DATA} columns={cols} />)
      await clickExport()
      expect(saveFile).toHaveBeenCalledTimes(1)
      return lastCsv()
    }

    it('exports values from nested accessorKeys (status.name, team.name)', async () => {
      // Arrange — columns whose accessorKey is a dot-path into the row
      const cols: ColumnDef<Obj, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        { id: 'status', accessorKey: 'status.name', header: 'Status' },
        { id: 'team', accessorKey: 'team.name', header: 'Team' },
      ]

      // Act
      const csv = await exportCsv(cols)

      // Assert — nested values are present, not blank
      expect(csv).toContain('Active')
      expect(csv).toContain('Closed')
      expect(csv).toContain('Juice')
    })

    it('excludes hidden columns (meta.unavailable) from the export', async () => {
      // Arrange — Status is hidden via meta.unavailable
      const cols: ColumnDef<Obj, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'status',
          accessorKey: 'status.name',
          header: 'Status',
          meta: { unavailable: true } satisfies DataGridColumnMeta,
        },
      ]

      // Act
      const csv = await exportCsv(cols)

      // Assert — the hidden Status column's header and data are absent
      expect(csv).toContain('Name')
      expect(csv).not.toContain('Status')
      expect(csv).not.toContain('Active')
    })

    it('reports a real write failure instead of claiming success', async () => {
      // A cancelled dialog resolves false; a permission error REJECTS, and
      // nothing below the grid catches it.
      // Arrange
      vi.mocked(saveFile).mockRejectedValue(new Error('EACCES'))
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      try {
        renderGrid()

        // Act
        await clickExport()

        // Assert — the failure surfaces rather than leaving an unhandled
        // rejection, and the button becomes usable again
        expect(
          await screen.findByText('Could not save the export'),
        ).toBeInTheDocument()
        await waitFor(() => expect(exportButton()).not.toBeDisabled())
      } finally {
        consoleError.mockRestore()
      }
    })

    it('says nothing when the user cancels the save dialog', async () => {
      // Arrange — `false` means cancelled: neither a success nor a failure
      vi.mocked(saveFile).mockResolvedValue(false)
      renderGrid()

      // Act
      await clickExport()

      // Assert
      await waitFor(() => expect(exportButton()).not.toBeDisabled())
      expect(screen.queryByText('Exported to CSV')).not.toBeInTheDocument()
      expect(
        screen.queryByText('Could not save the export'),
      ).not.toBeInTheDocument()
    })
  })

  describe('filter type inference (no explicit meta.filterType)', () => {
    it('infers a number filter for a numeric column (renders a number input)', () => {
      // Arrange — an id column with numeric values and no meta.filterType
      const cols: ColumnDef<Flag, unknown>[] = [
        { id: 'id', accessorKey: 'id', header: 'Id' },
        { id: 'name', accessorKey: 'name', header: 'Name' },
      ]

      // Act
      renderGrid({ columns: cols })

      // Assert — the numeric column's floating input is a spinbutton
      // (antd InputNumber), while the text column is a plain textbox.
      const row = floatingRow()
      expect(row.querySelector('input[role="spinbutton"]')).toBeInTheDocument()
      expect(row.querySelectorAll('input[type="text"]').length).toBeGreaterThan(
        0,
      )
    })

    it('infers a text filter for a string column (renders a text input)', () => {
      // Arrange — a name column with string values and no meta.filterType
      const cols: ColumnDef<Flag, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
      ]

      // Act — opt out of the injected Id column, which would infer numeric
      renderGrid({ columns: cols, includeIdColumn: false })

      // Assert — no number spinner; a text input is present
      const row = floatingRow()
      expect(
        row.querySelector('input[role="spinbutton"]'),
      ).not.toBeInTheDocument()
      expect(row.querySelector('input[type="text"]')).toBeInTheDocument()
    })
  })

  describe('global search', () => {
    it('filters rows to those matching the search text', () => {
      // Arrange
      renderGrid()

      // Act
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'road' },
      })

      // Assert
      expect(bodyCells('name').map((c) => c.textContent)).toEqual(['roadmap'])
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
    })
  })

  describe('floating filter row', () => {
    it('renders by default', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(floatingRow()).toBeInTheDocument()
    })

    it('is hidden when includeFloatingFilters is false', () => {
      // Arrange / Act
      renderGrid({ includeFloatingFilters: false })

      // Assert
      expect(floatingRow()).not.toBeInTheDocument()
    })

    it('is hidden when includeColumnFilters is false', () => {
      // Arrange / Act
      renderGrid({ includeColumnFilters: false })

      // Assert
      expect(floatingRow()).not.toBeInTheDocument()
    })
  })

  describe('set filter (Excel-style panel)', () => {
    it('renders a filter trigger for each set column (box + icon, no inline select)', () => {
      // Arrange / Act
      renderGrid()

      // Assert — set columns (Type, Enabled) each expose a "Filter column"
      // trigger, and there is no inline antd Select in the floating row.
      const triggers = within(floatingRow()).getAllByRole('button', {
        name: /Filter column/,
      })
      expect(triggers.length).toBeGreaterThanOrEqual(2)
      expect(floatingRow().querySelector('.ant-select')).not.toBeInTheDocument()
    })

    // The set panel (Select All + value checkboxes) opens in an antd Popover
    // portal, which is unreliable to drive in jsdom. The SetFilterPanel's own
    // behavior is unit-tested directly in set-filter-panel.test.tsx.
  })

  describe('set filter behavior (through the grid)', () => {
    it('filters a set column to the chosen value via the descriptor engine', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act
      act(() => {
        ref
          .current!.table.getColumn('type')!
          .setFilterValue({ type: 'set', values: ['System'] })
      })

      // Assert — only the System row remains
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'planning-poker',
      ])
    })

    it('filters blank cells via the (Blanks) sentinel', () => {
      // Arrange — a nullable Team column with one blank row
      interface Item {
        id: number
        name: string
        team: string | null
      }
      const data: Item[] = [
        { id: 1, name: 'alpha', team: 'Juice' },
        { id: 2, name: 'beta', team: null },
      ]
      const cols: ColumnDef<Item, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        {
          id: 'team',
          accessorKey: 'team',
          header: 'Team',
          meta: { filterType: 'set' },
        },
      ]
      const ref = createRef<DataGridHandle<Item>>()
      render(<DataGrid<Item> ref={ref} data={data} columns={cols} />)

      // Act / Assert — a value-only selection hides the blank row
      act(() => {
        ref
          .current!.table.getColumn('team')!
          .setFilterValue({ type: 'set', values: ['Juice'] })
      })
      expect(bodyCells('name').map((c) => c.textContent)).toEqual(['alpha'])

      // Act / Assert — selecting only (Blanks) shows just the blank row
      act(() => {
        ref
          .current!.table.getColumn('team')!
          .setFilterValue({ type: 'set', values: [SET_FILTER_BLANK] })
      })
      expect(bodyCells('name').map((c) => c.textContent)).toEqual(['beta'])
    })

    it('filters a multi-value (createCsvColumn) column on an individual token', () => {
      // Arrange — a Tags column whose rows each hold several tags
      interface Item {
        id: number
        name: string
        tags: string[]
      }
      const data: Item[] = [
        { id: 1, name: 'alpha', tags: ['red', 'blue'] },
        { id: 2, name: 'beta', tags: ['green'] },
        { id: 3, name: 'gamma', tags: ['blue', 'green'] },
      ]
      const cols: ColumnDef<Item, unknown>[] = [
        { id: 'name', accessorKey: 'name', header: 'Name' },
        createCsvColumn<Item>({
          id: 'tags',
          header: 'Tags',
          getValues: (row) => row.tags,
        }) as ColumnDef<Item, unknown>,
      ]
      const ref = createRef<DataGridHandle<Item>>()
      render(<DataGrid<Item> ref={ref} data={data} columns={cols} />)

      // Act — filter to the 'blue' token
      act(() => {
        ref
          .current!.table.getColumn('tags')!
          .setFilterValue({ type: 'set', values: ['blue'] })
      })

      // Assert — rows sharing 'blue' remain (matched per-token, not on the
      // whole joined "red, blue" string)
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'alpha',
        'gamma',
      ])
    })

    it('filters a yesNo column on the Yes/No display value (not true/false)', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act — filter Enabled to "Yes"
      act(() => {
        ref
          .current!.table.getColumn('isEnabled')!
          .setFilterValue({ type: 'set', values: ['Yes'] })
      })

      // Assert — only the two enabled rows remain
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'planning-poker',
        'insights',
      ])
    })
  })

  describe('sorting', () => {
    it('sorts a column ascending on header click', () => {
      // Arrange
      renderGrid()

      // Act
      fireEvent.click(screen.getByText('Name'))

      // Assert — alphabetical
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'insights',
        'planning-poker',
        'roadmap',
      ])
    })

    // The rows sort even when the header is stale, because the row model reads
    // the sort state directly — so asserting order alone let a frozen
    // getIsSorted() ship. These assert the indicator the user actually sees.
    it('shows an ascending indicator on the sorted header', () => {
      // Arrange
      const { container } = renderGrid()
      const header = screen.getByText('Name').closest('th')!

      // Act
      fireEvent.click(screen.getByText('Name'))

      // Assert
      expect(
        header.querySelectorAll('[class*="anticon-arrow-up"]'),
      ).toHaveLength(1)
      expect(
        container.querySelectorAll('[class*="anticon-arrow-down"]'),
      ).toHaveLength(0)
    })

    it('flips the indicator to descending on a second click', () => {
      // Arrange
      renderGrid()
      const header = screen.getByText('Name').closest('th')!

      // Act
      fireEvent.click(screen.getByText('Name'))
      fireEvent.click(screen.getByText('Name'))

      // Assert
      expect(
        header.querySelectorAll('[class*="anticon-arrow-down"]'),
      ).toHaveLength(1)
      expect(
        header.querySelectorAll('[class*="anticon-arrow-up"]'),
      ).toHaveLength(0)
    })

    it('clears the indicator on the third click', () => {
      // Arrange
      renderGrid()
      const header = screen.getByText('Name').closest('th')!

      // Act
      fireEvent.click(screen.getByText('Name'))
      fireEvent.click(screen.getByText('Name'))
      fireEvent.click(screen.getByText('Name'))

      // Assert
      expect(header.querySelectorAll('[class*="anticon-arrow"]')).toHaveLength(
        0,
      )
    })
  })

  describe('full-width filler structure', () => {
    it('adds a trailing filler col plus filler header/body cells', () => {
      // Arrange / Act
      const { container } = renderGrid()

      // Assert — one <col> more than visible columns (the filler) in EACH of
      // the two tables (split header + body viewports share one colgroup)
      const tables = container.querySelectorAll('table')
      expect(tables).toHaveLength(2)
      tables.forEach((t) =>
        expect(t.querySelectorAll('colgroup col')).toHaveLength(
          columns.length + 1,
        ),
      )

      // Header row ends in an aria-hidden filler th
      const headerRow = container.querySelector(
        'thead tr',
      ) as HTMLTableRowElement
      const headerCells = headerRow.querySelectorAll('th')
      expect(headerCells[headerCells.length - 1]).toHaveAttribute(
        'aria-hidden',
        'true',
      )

      // Each body row ends in an aria-hidden filler td
      const firstBodyRow = container.querySelector(
        'tbody tr',
      ) as HTMLTableRowElement
      const bodyRowCells = firstBodyRow.querySelectorAll('td')
      expect(bodyRowCells[bodyRowCells.length - 1]).toHaveAttribute(
        'aria-hidden',
        'true',
      )
    })

    it('adds a filler cell to the floating filter row', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      const cells = floatingRow().querySelectorAll('th')
      expect(cells[cells.length - 1]).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('toolbar behavior', () => {
    it('calls onRefresh when the refresh button is clicked', () => {
      // Arrange
      const onRefresh = vi.fn()
      const { container } = renderGrid({ onRefresh })

      // Act — the refresh button carries a reload icon (aria-label="reload")
      const reloadBtn = container
        .querySelector('[aria-label="reload"]')
        ?.closest('button') as HTMLButtonElement
      fireEvent.click(reloadBtn)

      // Assert
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('clears active filters and sorting via Clear', () => {
      // Arrange
      const { container } = renderGrid()
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'road' },
      })
      expect(screen.getByText('1 of 3')).toBeInTheDocument()

      // Act — the clear button carries a clear icon (aria-label="clear")
      const clearBtn = container
        .querySelector('[aria-label="clear"]')
        ?.closest('button') as HTMLButtonElement
      fireEvent.click(clearBtn)

      // Assert — all rows shown again
      expect(screen.getByText('3 of 3')).toBeInTheDocument()
    })

    it('renders the rightSlot content', () => {
      // Arrange / Act
      renderGrid({ rightSlot: <button>Custom action</button> })

      // Assert
      expect(
        screen.getByRole('button', { name: 'Custom action' }),
      ).toBeInTheDocument()
    })

    it('hides the global search when includeGlobalSearch is false', () => {
      // Arrange / Act
      renderGrid({ includeGlobalSearch: false })

      // Assert
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
  })

  describe('grouped headers (ColGroupDef-style bands)', () => {
    // Two bands over three leaves, plus one ungrouped column: the band row
    // must span its leaves via colSpan and pass the ungrouped column through
    // as an empty placeholder cell.
    const groupedColumns = [
      {
        id: 'info',
        header: 'Info',
        columns: [
          { id: 'name', accessorKey: 'name', header: 'Name' },
          { id: 'type', accessorKey: 'type', header: 'Type' },
        ],
      },
      {
        id: 'state',
        header: 'State',
        columns: [
          {
            id: 'isEnabled',
            accessorKey: 'isEnabled',
            header: 'Enabled',
            meta: { columnType: 'yesNo' } satisfies DataGridColumnMeta,
          },
        ],
      },
      { id: 'id', accessorKey: 'id', header: 'Id' },
    ] as ColumnDef<Flag, unknown>[]

    const bandRows = () =>
      Array.from(
        document.querySelectorAll('tr[data-role="header-band"]'),
      ) as HTMLTableRowElement[]

    it('renders one band row with group labels spanning their leaves', () => {
      // Arrange / Act
      renderGrid({ columns: groupedColumns })

      // Assert — a single band row above the leaf header row
      const bands = bandRows()
      expect(bands).toHaveLength(1)

      // Group cells span their visible leaves; the ungrouped column passes
      // through as a placeholder; the trailing filler cell closes the row.
      const cells = Array.from(bands[0].cells)
      expect(cells.map((c) => c.textContent)).toEqual(['Info', 'State', '', ''])
      expect(cells.map((c) => c.colSpan)).toEqual([2, 1, 1, 1])

      // Empty placeholder + filler cells are hidden from assistive tech.
      expect(cells.map((c) => c.getAttribute('aria-hidden'))).toEqual([
        null,
        null,
        'true',
        'true',
      ])
    })

    it('renders no band row for flat (ungrouped) columns', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(bandRows()).toHaveLength(0)
    })

    it('renders the floating filter row exactly once', () => {
      // Arrange / Act
      renderGrid({ columns: groupedColumns })

      // Assert
      expect(
        document.querySelectorAll('tr[data-role="floating-filters"]'),
      ).toHaveLength(1)
    })

    it('sorts a grouped leaf column on header click', () => {
      // Arrange
      renderGrid({ columns: groupedColumns })

      // Act — click the leaf header, not the band
      fireEvent.click(screen.getByText('Name'))

      // Assert — rows sort ascending by name
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'insights',
        'planning-poker',
        'roadmap',
      ])
    })

    it('applies meta.columnType to leaves nested under a band', () => {
      // Arrange / Act
      renderGrid({ columns: groupedColumns })

      // Assert — the yesNo type formats the grouped Enabled leaf
      expect(bodyCells('isEnabled').map((c) => c.textContent)).toEqual([
        'Yes',
        'No',
        'Yes',
      ])
    })

    it('hides a grouped leaf via meta.unavailable and shrinks the band colSpan', () => {
      // Arrange — hide Type inside the Info band
      const cols = [
        {
          id: 'info',
          header: 'Info',
          columns: [
            { id: 'name', accessorKey: 'name', header: 'Name' },
            {
              id: 'type',
              accessorKey: 'type',
              header: 'Type',
              meta: { unavailable: true } satisfies DataGridColumnMeta,
            },
          ],
        },
        { id: 'id', accessorKey: 'id', header: 'Id' },
      ] as ColumnDef<Flag, unknown>[]

      // Act
      renderGrid({ columns: cols })

      // Assert — Type is gone and Info spans only the remaining leaf
      expect(screen.queryByText('Type')).not.toBeInTheDocument()
      const infoCell = Array.from(bandRows()[0].cells).find(
        (c) => c.textContent === 'Info',
      )
      expect(infoCell?.colSpan).toBe(1)
    })

    it('exports band labels as a prelude row above the leaf headers', async () => {
      // Arrange
      renderGrid({ columns: groupedColumns })

      // Act
      await clickExport()

      // Assert — band row (label at each group's first column, blank across
      // the span, ungrouped Id blank), then leaf headers, then data
      expect(saveFile).toHaveBeenCalledTimes(1)
      const lines = lastCsv().split('\n')
      expect(lines[0]).toBe('Info,,State,')
      expect(lines[1]).toBe('Name,Type,Enabled,Id')
      expect(lines[2]).toContain('planning-poker')
    })
  })

  describe('displayed-rows surface (onDisplayedRowsChange / getDisplayedRows)', () => {
    it('fires on mount with all rows in display order', () => {
      // Arrange / Act
      const onDisplayedRowsChange = vi.fn()
      renderGrid({ onDisplayedRowsChange })

      // Assert
      expect(onDisplayedRowsChange).toHaveBeenCalled()
      const last = onDisplayedRowsChange.mock.calls.at(-1)![0] as Flag[]
      expect(last.map((f) => f.name)).toEqual([
        'planning-poker',
        'roadmap',
        'insights',
      ])
    })

    it('fires with the filtered subset when the global search changes', () => {
      // Arrange
      const onDisplayedRowsChange = vi.fn()
      renderGrid({ onDisplayedRowsChange })

      // Act
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'road' },
      })

      // Assert
      const last = onDisplayedRowsChange.mock.calls.at(-1)![0] as Flag[]
      expect(last.map((f) => f.name)).toEqual(['roadmap'])
    })

    it('fires with the re-sorted order when a sort is applied', () => {
      // Arrange
      const onDisplayedRowsChange = vi.fn()
      renderGrid({ onDisplayedRowsChange })

      // Act
      fireEvent.click(screen.getByText('Name'))

      // Assert
      const last = onDisplayedRowsChange.mock.calls.at(-1)![0] as Flag[]
      expect(last.map((f) => f.name)).toEqual([
        'insights',
        'planning-poker',
        'roadmap',
      ])
    })

    it('exposes the displayed rows via the handle', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act — filter, then read the handle
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'insights' },
      })
      const displayed = ref.current!.getDisplayedRows()

      // Assert
      expect(displayed.map((f) => f.name)).toEqual(['insights'])
    })
  })

  describe('flat row-reorder DnD (onRowReorder)', () => {
    it('wraps rows in sortable rows keyed by getRowId', () => {
      // Arrange / Act
      renderGrid({
        onRowReorder: vi.fn(),
        getRowId: (row) => `flag-${row.id}`,
      })

      // Assert — each body row carries its sortable data-row-id
      const rowIds = Array.from(
        document.querySelectorAll('tbody tr[data-row-id]'),
      ).map((tr) => tr.getAttribute('data-row-id'))
      expect(rowIds).toEqual(['flag-1', 'flag-2', 'flag-3'])
    })

    it('renders plain rows (no sortable wrapper) without onRowReorder', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(document.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(0)
    })

    it('reports drag disabled through the column context while sorted', () => {
      // Arrange — a columns function that surfaces context.isDragEnabled
      const seen: boolean[] = []
      renderGrid({
        onRowReorder: vi.fn(),
        getRowId: (row) => String(row.id),
        columns: (context: GridColumnContext) => {
          seen.push(context.isDragEnabled)
          return columns
        },
      })
      expect(seen.at(-1)).toBe(true)

      // Act — apply a sort (displayed order no longer the data order)
      fireEvent.click(screen.getByText('Name'))

      // Assert
      expect(seen.at(-1)).toBe(false)
    })
  })

  describe('row-reorder payload (the drop handler DataGrid computes)', () => {
    // core/dnd/grid-dnd.tsx supplies only sensors and the sortable wrapper —
    // no index arithmetic. The RowReorderEvent payload is computed here, in
    // DataGrid, and is pure: these invoke the drop handler directly rather
    // than dragging (dnd-kit needs real geometry; jsdom has none).
    const FIVE: Flag[] = [1, 2, 3, 4, 5].map((n) => ({
      id: n,
      name: `flag-${n}`,
      isEnabled: n % 2 === 1,
      type: 'User',
    }))

    const renderReorderable = () => {
      const onRowReorder = vi.fn<(e: RowReorderEvent<Flag>) => void>()
      render(
        <DataGrid<Flag>
          data={FIVE}
          columns={columns}
          onRowReorder={onRowReorder}
          getRowId={(row) => String(row.id)}
        />,
      )
      return onRowReorder
    }

    const names = (event: RowReorderEvent<Flag>) =>
      event.orderedData.map((f) => f.name)

    it('moves a row down to the dropped row position', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act — drop flag-1 (index 0) onto flag-3 (index 2)
      dropRow('1', '3')

      // Assert
      expect(onRowReorder).toHaveBeenCalledTimes(1)
      const event = onRowReorder.mock.calls[0][0]
      expect(event.activeId).toBe('1')
      expect(event.fromIndex).toBe(0)
      expect(event.toIndex).toBe(2)
      expect(names(event)).toEqual([
        'flag-2',
        'flag-3',
        'flag-1',
        'flag-4',
        'flag-5',
      ])
    })

    it('moves a row up', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act — drop flag-4 (index 3) onto flag-2 (index 1)
      dropRow('4', '2')

      // Assert
      const event = onRowReorder.mock.calls[0][0]
      expect(event.fromIndex).toBe(3)
      expect(event.toIndex).toBe(1)
      expect(names(event)).toEqual([
        'flag-1',
        'flag-4',
        'flag-2',
        'flag-3',
        'flag-5',
      ])
    })

    it('moves a row to first', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act
      dropRow('5', '1')

      // Assert
      const event = onRowReorder.mock.calls[0][0]
      expect(event.fromIndex).toBe(4)
      expect(event.toIndex).toBe(0)
      expect(names(event)).toEqual([
        'flag-5',
        'flag-1',
        'flag-2',
        'flag-3',
        'flag-4',
      ])
    })

    it('moves a row to last', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act
      dropRow('1', '5')

      // Assert
      const event = onRowReorder.mock.calls[0][0]
      expect(event.fromIndex).toBe(0)
      expect(event.toIndex).toBe(4)
      expect(names(event)).toEqual([
        'flag-2',
        'flag-3',
        'flag-4',
        'flag-5',
        'flag-1',
      ])
    })

    it('reports nothing for a drop on the row itself', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act
      dropRow('3', '3')

      // Assert — a no-op drop must not fire a write
      expect(onRowReorder).not.toHaveBeenCalled()
    })

    it('reports nothing for a drop outside every row', () => {
      // Arrange
      const onRowReorder = renderReorderable()

      // Act — dnd-kit reports `over: null` when the pointer is off the list
      dropRow('3', null)

      // Assert
      expect(onRowReorder).not.toHaveBeenCalled()
    })
  })

  describe('row-reorder drag affordance (DragHandleCell)', () => {
    // The grip is the only conditional branch in core/dnd/grid-dnd.tsx and had
    // no coverage: enabled it carries dnd-kit's listeners and attributes,
    // disabled it carries none. Asserted, never dragged.
    const HANDLE_LABEL = 'Drag to reorder'

    const dragColumns = (
      context: GridColumnContext,
    ): ColumnDef<Flag, any>[] => [
      {
        id: 'drag',
        header: '',
        size: 40,
        enableSorting: false,
        enableColumnFilter: false,
        meta: { enableReordering: false },
        cell: () => (
          <DragHandleCell
            isDragEnabled={context.isDragEnabled}
            disabledTooltip="Clear sorting and filters to reorder flags"
          />
        ),
      },
      ...(columns as ColumnDef<Flag, any>[]),
    ]

    const renderWithHandle = () =>
      renderGrid({
        columns: dragColumns,
        onRowReorder: vi.fn(),
        getRowId: (row) => String(row.id),
      })

    const handle = () =>
      document.querySelector(`[aria-label="${HANDLE_LABEL}"]`) as HTMLElement

    it('spreads the drag listeners while reorder is live', () => {
      // Arrange / Act
      renderWithHandle()

      // Assert — dnd-kit's sortable attributes are on the grip, so a pointer
      // press on it can start a drag
      const grip = handle()
      expect(grip).toHaveAttribute('aria-roledescription', 'sortable')
      expect(grip).toHaveAttribute('role', 'button')
      expect(grip).toHaveAttribute('tabindex', '0')
      expect(grip).toHaveAttribute('aria-disabled', 'false')
      // setup.ts stubs getComputedStyle, so assert the inline style attribute
      expect(grip.getAttribute('style')).toContain('cursor: grab')
      expect(
        document.querySelectorAll(`[aria-label="${HANDLE_LABEL}"]`),
      ).toHaveLength(DATA.length)
    })

    it('spreads no listeners once the grid is sorted', () => {
      // A drag against a re-sorted view would reorder against an order the
      // user cannot see.
      // Arrange
      renderWithHandle()

      // Act
      fireEvent.click(screen.getByText('Name'))

      // Assert — the affordance is gone: no drag attributes, not focusable
      const grip = handle()
      expect(grip).not.toHaveAttribute('aria-roledescription')
      expect(grip).not.toHaveAttribute('role')
      expect(grip).not.toHaveAttribute('tabindex')
      expect(grip).toHaveAttribute('aria-disabled', 'true')
      expect(grip.getAttribute('style')).toContain('cursor: not-allowed')
    })

    it('spreads no listeners once the grid is globally searched', () => {
      // Arrange
      renderWithHandle()

      // Act — a term that still leaves a row (and so a grip) on screen
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'road' },
      })

      // Assert
      expect(handle()).not.toHaveAttribute('aria-roledescription')
      expect(handle()).toHaveAttribute('aria-disabled', 'true')
    })

    it('spreads no listeners once a column filter is active', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({
        ref,
        columns: dragColumns,
        onRowReorder: vi.fn(),
        getRowId: (row) => String(row.id),
      })
      expect(handle()).toHaveAttribute('aria-roledescription', 'sortable')

      // Act
      act(() => {
        ref
          .current!.table.getColumn('type')!
          .setFilterValue({ type: 'set', values: ['User'] })
      })

      // Assert
      expect(handle()).not.toHaveAttribute('aria-roledescription')
      expect(handle()).toHaveAttribute('aria-disabled', 'true')
    })

    it('reports drag disabled while the grid is loading', () => {
      // Arrange / Act — a loading grid shows the status overlay instead of
      // rows, so assert through the column context the grips read
      const seen: boolean[] = []
      renderGrid({
        isLoading: true,
        onRowReorder: vi.fn(),
        getRowId: (row) => String(row.id),
        columns: (context: GridColumnContext) => {
          seen.push(context.isDragEnabled)
          return columns
        },
      })

      // Assert
      expect(seen.at(-1)).toBe(false)
    })
  })

  describe('meta.headerTooltip', () => {
    const cols: ColumnDef<Flag, unknown>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        meta: { headerTooltip: 'The flag name' },
      },
    ]

    it('keeps click-to-sort working through the wrapped header label', () => {
      // Arrange — antd tooltips portal on hover (not renderable in jsdom);
      // assert the anchor renders and stays interactive.
      renderGrid({ columns: cols })
      const label = screen.getByText('Name')

      // Act
      fireEvent.click(label)

      // Assert — rows sort ascending by name
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'insights',
        'planning-poker',
        'roadmap',
      ])
    })

    it('exports the plain string header (no exportHeader override needed)', async () => {
      // Arrange
      renderGrid({ columns: cols, includeIdColumn: false })

      // Act
      await clickExport()

      // Assert
      expect(lastCsv().split('\n')[0]).toBe('Name')
    })
  })

  describe('dotted accessorKeys over optional relations', () => {
    interface Rel {
      id: number
      name: string
      team?: { name: string }
    }

    const rows: Rel[] = [
      { id: 1, name: 'alpha', team: { name: 'Juice' } },
      { id: 2, name: 'beta' }, // no team — the hop TanStack would warn on
    ]

    const cols: ColumnDef<Rel, unknown>[] = [
      { id: 'name', accessorKey: 'name', header: 'Name' },
      { accessorKey: 'team.name', header: 'Team' },
    ]

    it('renders values without TanStack deep-accessor dev warnings', () => {
      // Arrange
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        // Act
        render(<DataGrid<Rel> data={rows} columns={cols} />)

        // Assert — value renders, and no "deeply nested key" warning fired
        expect(screen.getByText('Juice')).toBeInTheDocument()
        const deepWarnings = warnSpy.mock.calls.filter((call) =>
          String(call[0]).includes('deeply nested'),
        )
        expect(deepWarnings).toHaveLength(0)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('keeps the TanStack-derived column id (dots to underscores)', () => {
      // Arrange / Act
      render(<DataGrid<Rel> data={rows} columns={cols} />)

      // Assert — body cells carry the derived data-column-id
      expect(
        document.querySelectorAll('tbody td[data-column-id="team_name"]'),
      ).toHaveLength(2)
    })
  })

  describe('row virtualization', () => {
    // The offsetHeight stub at the top of this file gives the body viewport a
    // 600px height; rows keep the virtualizer's 28px estimate. These pin the
    // resulting window plus the spacer geometry standing in for the
    // unrendered rows.
    const ROW_ESTIMATE = 28
    // 600px viewport ÷ 28px rows → indexes 0-21 visible, +10 overscan = 32.
    const WINDOW_SIZE = 32

    const BIG_DATA: Flag[] = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      name: `flag-${String(i + 1).padStart(3, '0')}`,
      isEnabled: i % 2 === 0,
      type: i % 3 === 0 ? 'System' : 'User',
    }))

    /** The single scrolling body viewport. */
    const bodyViewport = () =>
      document.querySelector('[data-grid-body-viewport]') as HTMLElement

    /** Spacer rows (aria-hidden <tr>s) with their pixel heights. */
    const spacerHeights = () =>
      Array.from(
        document.querySelectorAll('tbody tr[aria-hidden="true"] td'),
      ).map((td) => (td as HTMLElement).style.height)

    it('renders only the virtual window of a large dataset, keeping the row model complete', () => {
      // Arrange / Act
      renderGrid({ data: BIG_DATA })

      // Assert — the toolbar count (row model) sees all rows…
      expect(screen.getByText('200 of 200')).toBeInTheDocument()

      // …but the DOM holds only the window, from the top of the list
      const names = bodyCells('name').map((c) => c.textContent)
      expect(names).toHaveLength(WINDOW_SIZE)
      expect(names[0]).toBe('flag-001')
      expect(names[WINDOW_SIZE - 1]).toBe(`flag-0${WINDOW_SIZE}`)

      // A single bottom spacer holds the unrendered remainder's height so
      // scroll geometry matches the full dataset
      expect(spacerHeights()).toEqual([
        `${(BIG_DATA.length - WINDOW_SIZE) * ROW_ESTIMATE}px`,
      ])
    })

    it('moves the window (and adds a top spacer) when the body viewport scrolls', () => {
      // Arrange
      renderGrid({ data: BIG_DATA })
      const viewport = bodyViewport()

      // Act — scroll to row index 50
      viewport.scrollTop = 50 * ROW_ESTIMATE
      fireEvent.scroll(viewport)

      // Assert — the window re-anchors around index 50 (± overscan): rows
      // before index 40 are unmounted, replaced by a top spacer of their
      // exact height
      const names = bodyCells('name').map((c) => c.textContent)
      expect(names[0]).toBe('flag-041')
      expect(names).not.toContain('flag-001')
      expect(spacerHeights()[0]).toBe(`${40 * ROW_ESTIMATE}px`)
    })

    it('exports ALL rows to CSV, not just the rendered window', async () => {
      // Arrange
      renderGrid({ data: BIG_DATA })

      // Act
      await clickExport()

      // Assert — header row + one line per data row, including unrendered ones
      const csv = lastCsv()
      expect(csv.split('\n')).toHaveLength(BIG_DATA.length + 1)
      expect(csv).toContain('flag-200')
    })

    it('reports ALL displayed rows through onDisplayedRowsChange, not just the window', () => {
      // Arrange / Act
      const onDisplayedRowsChange = vi.fn()
      renderGrid({ data: BIG_DATA, onDisplayedRowsChange })

      // Assert
      const last = onDisplayedRowsChange.mock.calls.at(-1)![0] as Flag[]
      expect(last).toHaveLength(BIG_DATA.length)
    })
  })

  describe('initialSorting', () => {
    it('applies the initial sort on mount', () => {
      // Arrange / Act
      renderGrid({ initialSorting: [{ id: 'name', desc: true }] })

      // Assert — rows sorted descending by name without any user click
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'roadmap',
        'planning-poker',
        'insights',
      ])
    })

    it('clears the initial sort via the toolbar Clear button', () => {
      // Arrange
      const { container } = renderGrid({
        initialSorting: [{ id: 'name', desc: true }],
      })

      // Act — the clear button carries a clear icon (aria-label="clear")
      const clearBtn = container
        .querySelector('[aria-label="clear"]')
        ?.closest('button') as HTMLButtonElement
      fireEvent.click(clearBtn)

      // Assert — back to data order
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'planning-poker',
        'roadmap',
        'insights',
      ])
    })
  })

  describe('column menu', () => {
    it('renders a menu trigger in every leaf header cell', () => {
      // Arrange / Act
      renderGrid()

      // Assert — one ⋮ trigger per visible column
      expect(screen.getAllByLabelText('Column menu')).toHaveLength(
        columns.length,
      )
    })

    it('omits the menu on control columns (meta.enableReordering false)', () => {
      // Arrange — a control column, matching createActionsColumn's shape
      const withControl = [
        ...columns,
        {
          id: 'row-actions',
          header: '',
          enableSorting: false,
          enableResizing: false,
          meta: { enableReordering: false } satisfies DataGridColumnMeta,
          cell: () => null,
        },
      ] as ColumnDef<Flag, unknown>[]

      // Act
      renderGrid({ columns: withControl })

      // Assert — a trigger per real column, none on the control column
      expect(screen.getAllByLabelText('Column menu')).toHaveLength(
        columns.length,
      )
      expect(
        document
          .querySelector('th[data-column-id="row-actions"]')
          ?.querySelector('[aria-label="Column menu"]'),
      ).toBeNull()
    })

    it('opening the menu does not toggle the column sort', () => {
      // Arrange
      renderGrid()
      const namesBefore = bodyCells('name').map((c) => c.textContent)

      // Act — the trigger sits inside the sortable <th>
      fireEvent.click(screen.getAllByLabelText('Column menu')[0])

      // Assert — row order untouched
      expect(bodyCells('name').map((c) => c.textContent)).toEqual(namesBefore)
    })

    // antd 6 menu-item accessible names include the icon's own label ("sort-
    // descending Sort Descending"), so these match on the item's text rather
    // than an anchored accessible name. One dropdown per test: antd keeps a
    // closed dropdown's popup mounted, so opening a second would leave two
    // copies of every item in the document.
    const openMenuFor = (label: string) => {
      const th = screen.getByText(label).closest('th')!
      fireEvent.click(within(th).getByLabelText('Column menu'))
    }

    it('sets the column sort from the menu', async () => {
      // Arrange
      renderGrid()

      // Act
      openMenuFor('Name')
      fireEvent.click(await screen.findByText('Sort Descending'))

      // Assert
      expect(bodyCells('name').map((c) => c.textContent)).toEqual([
        'roadmap',
        'planning-poker',
        'insights',
      ])
    })

    it('restores the default column layout from the menu, leaving the sort alone', async () => {
      // Reset Columns is column state only — clearing sorting and filters is
      // the toolbar's Clear button.
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref, initialSorting: [{ id: 'name', desc: true }] })
      act(() => {
        ref.current!.table.getColumn('type')!.pin('start')
        ref.current!.table.setColumnOrder(['isEnabled', 'name', 'type'])
      })
      expect(headerOrder()[0]).toBe('type')

      // Act
      openMenuFor('Name')
      fireEvent.click(await screen.findByText('Reset Columns'))

      // Assert — layout back to the defs' order, sort untouched
      expect(headerOrder()).toEqual(['name', 'type', 'isEnabled'])
      expect(bodyCells('name')[0].textContent).toBe('roadmap')
    })
  })

  describe('column pinning', () => {
    it('reorders a left-pinned column to the front of both tables', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act
      act(() => {
        ref.current!.table.getColumn('type')!.pin('start')
      })

      // Assert — header and body cells lead with the pinned column. Target
      // the leaf header row explicitly (band/floating rows carry data-role),
      // so this survives grids with grouped headers.
      expect(headerOrder()[0]).toBe('type')
      const firstBodyRow = document.querySelector('tbody tr') as HTMLElement
      expect(
        firstBodyRow
          .querySelector('td[data-column-id]')
          ?.getAttribute('data-column-id'),
      ).toBe('type')
    })

    it('applies the sticky inset to pinned header and body cells', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act — pin two columns left; the second is offset by the first's width
      act(() => {
        ref.current!.table.getColumn('name')!.pin('start')
        ref.current!.table.getColumn('type')!.pin('start')
      })

      // Assert — the inline style, not toHaveStyle: setup.ts stubs
      // getComputedStyle with a fixed object
      const nameTh = document.querySelector(
        'th[data-column-id="name"]',
      ) as HTMLElement
      const typeTh = document.querySelector(
        'th[data-column-id="type"]',
      ) as HTMLElement
      expect(nameTh.style.left).toBe('0px')
      expect(typeTh.style.left).toBe(
        `${ref.current!.table.getColumn('name')!.getSize()}px`,
      )
      expect(bodyCells('name')[0].style.left).toBe('0px')
    })

    it('leaves unpinned cells without a sticky inset', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      const nameTh = document.querySelector(
        'th[data-column-id="name"]',
      ) as HTMLElement
      expect(nameTh.style.left).toBe('')
      expect(bodyCells('name')[0].style.left).toBe('')
    })
  })

  describe('column reordering', () => {
    it('renders columns in the applied columnOrder', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })
      expect(headerOrder()).toEqual(['name', 'type', 'isEnabled'])

      // Act — move isEnabled to the front
      act(() => {
        ref.current!.table.setColumnOrder(['isEnabled', 'name', 'type'])
      })

      // Assert — header and body cells both follow the new order
      expect(headerOrder()).toEqual(['isEnabled', 'name', 'type'])
      const firstBodyRow = document.querySelector('tbody tr') as HTMLElement
      expect(
        firstBodyRow
          .querySelector('td[data-column-id]')
          ?.getAttribute('data-column-id'),
      ).toBe('isEnabled')
    })

    /** Leaf header cells that are drag-reorderable (whole cell is the handle;
     *  dnd-kit stamps aria-roledescription="sortable" on it). */
    const reorderableHeaders = () =>
      document.querySelectorAll(
        'thead tr:not([data-role]) th[data-column-id][aria-roledescription="sortable"]',
      )

    it('makes every reorderable leaf header cell a drag handle', () => {
      // Arrange / Act
      renderGrid()

      // Assert — the whole cell is draggable (no separate grip element)
      expect(reorderableHeaders()).toHaveLength(3)
      expect(
        document.querySelectorAll('[aria-label="Reorder column"]'),
      ).toHaveLength(0)
    })

    it('makes no header cell a drag handle on a grouped-header grid', () => {
      // Arrange — a band splits reordering, so it is disabled
      const groupedColumns = [
        {
          id: 'group',
          header: 'Group',
          columns: [
            { id: 'name', accessorKey: 'name', header: 'Name' },
            { id: 'type', accessorKey: 'type', header: 'Type' },
          ],
        },
      ] as ColumnDef<Flag, unknown>[]

      // Act
      renderGrid({ columns: groupedColumns })

      // Assert
      expect(reorderableHeaders()).toHaveLength(0)
    })

    it('keeps the actions column from becoming a drag handle', () => {
      // Arrange — actions column opts out of reordering
      const withActions: ColumnDef<Flag, unknown>[] = [
        ...columns,
        createActionsColumn<Flag>({
          getItems: () => [{ key: 'edit', label: 'Edit' }],
        }) as ColumnDef<Flag, unknown>,
      ]

      // Act
      renderGrid({ columns: withActions })

      // Assert — the actions header is not draggable; the 3 data columns are
      const actionsTh = document.querySelector(
        'thead tr:not([data-role]) th[data-column-id="actions"]',
      ) as HTMLElement
      expect(actionsTh.getAttribute('aria-roledescription')).not.toBe(
        'sortable',
      )
      expect(reorderableHeaders()).toHaveLength(3)
    })

    it('exports CSV in the displayed column order', async () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref })

      // Act — reorder, then export
      act(() => {
        ref.current!.table.setColumnOrder(['type', 'isEnabled', 'name'])
      })
      await clickExport()

      // Assert — the header row of the CSV follows the display order
      expect(lastCsv().split('\n')[0]).toBe('Type,Enabled,Name')
    })
  })

  describe('column state persistence (persistStateKey)', () => {
    const STORAGE_KEY = gridStateStorageKey('test-grid')

    beforeEach(() => {
      // jsdom provides a real localStorage; clear it so each round-trip starts
      // from no stored layout.
      window.localStorage.clear()
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      window.localStorage.clear()
    })

    it('restores sizing, user visibility, and pinning from a stored entry', () => {
      // Arrange
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          columnSizing: { name: 240 },
          userColumnVisibility: { type: false },
          columnPinning: { start: ['isEnabled'], end: [] },
        }),
      )
      const ref = createRef<DataGridHandle<Flag>>()

      // Act
      renderGrid({ ref, persistStateKey: 'test-grid' })

      // Assert — the user-hidden column is gone from the DOM (the raw user
      // layer flows through mergeColumnVisibility), the pinned column leads,
      // and the stored width is applied
      expect(
        document.querySelector('th[data-column-id="type"]'),
      ).not.toBeInTheDocument()
      expect(headerOrder()[0]).toBe('isEnabled')
      expect(ref.current!.table.getColumn('name')!.getSize()).toBe(240)
    })

    it('saves changes and restores them on a fresh mount', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      const { unmount } = renderGrid({ ref, persistStateKey: 'test-grid' })

      // Act — resize and pin through the table (wired to useGridState), let
      // the debounce elapse, then remount
      act(() => {
        ref.current!.table.setColumnSizing({ name: 300 })
        ref.current!.table.getColumn('type')!.pin('start')
      })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      unmount()

      // Assert — the entry holds the full payload
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        columnSizing: { name: 300 },
        userColumnVisibility: {},
        columnPinning: { start: ['type'], end: [] },
      })

      // Act — fresh mount restores it
      const ref2 = createRef<DataGridHandle<Flag>>()
      renderGrid({ ref: ref2, persistStateKey: 'test-grid' })

      // Assert
      expect(ref2.current!.table.getColumn('name')!.getSize()).toBe(300)
      expect(headerOrder()[0]).toBe('type')
    })

    it('never touches storage without a persistStateKey', () => {
      // Arrange — the app's own providers (theme) use localStorage too, so
      // this is scoped to the grid's own key space.
      const getItemSpy = vi.spyOn(window.localStorage, 'getItem')
      const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
      const ref = createRef<DataGridHandle<Flag>>()

      try {
        // Act
        renderGrid({ ref })
        act(() => {
          ref.current!.table.setColumnSizing({ name: 300 })
          vi.advanceTimersByTime(1000)
        })

        // Assert
        const gridKeys = (calls: readonly unknown[][]) =>
          calls
            .map((call) => String(call[0]))
            .filter((key) => key.startsWith('calendar-grid'))
        expect(gridKeys(getItemSpy.mock.calls)).toEqual([])
        expect(gridKeys(setItemSpy.mock.calls)).toEqual([])
      } finally {
        getItemSpy.mockRestore()
        setItemSpy.mockRestore()
      }
    })

    it('persists a column reorder and restores it on a fresh mount', () => {
      // Arrange
      const ref = createRef<DataGridHandle<Flag>>()
      const { unmount } = renderGrid({ ref, persistStateKey: 'test-grid' })

      // Act — reorder, let the debounce elapse, remount
      act(() => {
        ref.current!.table.setColumnOrder(['isEnabled', 'name', 'type'])
      })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      unmount()

      // Assert — the payload carries the order
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        columnSizing: {},
        userColumnVisibility: {},
        columnPinning: { start: [], end: [] },
        columnOrder: ['isEnabled', 'name', 'type'],
      })

      // Act — fresh mount restores the display order
      renderGrid({ persistStateKey: 'test-grid' })

      // Assert
      expect(headerOrder()).toEqual(['isEnabled', 'name', 'type'])
    })
  })

  describe('numeric cell alignment', () => {
    // `id` is numeric in DATA, so its filter/data type infers to 'number'.
    const numericColumns: ColumnDef<Flag, unknown>[] = [
      ...columns,
      { id: 'id', accessorKey: 'id', header: 'Id' },
    ]

    it('right-aligns body cells of a data-inferred numeric column, but not its header', () => {
      // Arrange / Act
      renderGrid({ columns: numericColumns })

      // Assert — numeric cells carry the alignment class; the header and
      // text-column cells do not. CSS Modules resolve to hashed names under
      // vitest's css: true, so reference styles.* rather than a literal.
      expect(bodyCells('id')[0].className).toContain(styles.tdNumeric)
      expect(
        document.querySelector('th[data-column-id="id"]')?.className,
      ).not.toContain(styles.tdNumeric)
      expect(bodyCells('name')[0].className).not.toContain(styles.tdNumeric)
    })

    it('meta.align overrides the default in both directions', () => {
      // Arrange
      const overriddenColumns: ColumnDef<Flag, unknown>[] = [
        {
          id: 'name',
          accessorKey: 'name',
          header: 'Name',
          meta: { align: 'right' } satisfies DataGridColumnMeta,
        },
        {
          id: 'id',
          accessorKey: 'id',
          header: 'Id',
          meta: { align: 'left' } satisfies DataGridColumnMeta,
        },
      ]

      // Act
      renderGrid({ columns: overriddenColumns })

      // Assert
      expect(bodyCells('name')[0].className).toContain(styles.tdNumeric)
      expect(bodyCells('id')[0].className).not.toContain(styles.tdNumeric)
    })

    it('leaves boolean (yesNo set-filter) columns left-aligned', () => {
      // Arrange / Act
      renderGrid()

      // Assert
      expect(bodyCells('isEnabled')[0].className).not.toContain(
        styles.tdNumeric,
      )
    })
  })

  describe('row activation', () => {
    /** The body rows, in display order. */
    const bodyRows = () =>
      Array.from(document.querySelectorAll('tbody tr[role="button"]'))

    it('does not make rows buttons when onRowActivate is absent', () => {
      // Arrange / Act
      renderGrid()

      // Assert — a row that cannot be activated must not claim a button role
      // or take tab focus.
      expect(bodyRows()).toHaveLength(0)
    })

    it('activates the clicked row', () => {
      // Arrange
      const onRowActivate = vi.fn()
      renderGrid({ onRowActivate })

      // Act
      fireEvent.click(bodyCells('name')[1])

      // Assert — the row's data, not the TanStack row wrapper
      expect(onRowActivate).toHaveBeenCalledTimes(1)
      expect(onRowActivate).toHaveBeenCalledWith(DATA[1])
    })

    it('activates on Enter and Space', () => {
      // Arrange
      const onRowActivate = vi.fn()
      renderGrid({ onRowActivate })
      const row = bodyRows()[0]

      // Act
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })

      // Assert
      expect(onRowActivate).toHaveBeenCalledTimes(2)
      expect(onRowActivate).toHaveBeenNthCalledWith(1, DATA[0])
      expect(onRowActivate).toHaveBeenNthCalledWith(2, DATA[0])
    })

    it('ignores other keys', () => {
      // Arrange
      const onRowActivate = vi.fn()
      renderGrid({ onRowActivate })

      // Act
      fireEvent.keyDown(bodyRows()[0], { key: 'a' })

      // Assert
      expect(onRowActivate).not.toHaveBeenCalled()
    })

    it('makes every row focusable so the list is keyboard navigable', () => {
      // Arrange / Act
      renderGrid({ onRowActivate: vi.fn() })

      // Assert
      const rows = bodyRows()
      expect(rows).toHaveLength(DATA.length)
      rows.forEach((row) => expect(row).toHaveAttribute('tabindex', '0'))
    })

    it('names the row from getRowActivateLabel', () => {
      // Arrange / Act — without a label the button role would announce the
      // row's whole flattened text.
      renderGrid({
        onRowActivate: vi.fn(),
        getRowActivateLabel: (flag) => `Open ${flag.name}`,
      })

      // Assert
      expect(bodyRows()[0]).toHaveAttribute('aria-label', 'Open planning-poker')
    })

    it('leaves clicks on interactive cell content alone', () => {
      // Arrange — an actions button inside an activatable row must open its
      // own thing, not the row.
      const onRowActivate = vi.fn()
      const onButtonClick = vi.fn()
      renderGrid({
        columns: [
          {
            id: 'name',
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => (
              <button onClick={onButtonClick}>{row.original.name}</button>
            ),
          },
        ] as ColumnDef<Flag, unknown>[],
        onRowActivate,
      })

      // Act — the row is a button too, so scope the query to the cell
      fireEvent.click(
        within(bodyCells('name')[0]).getByRole('button', {
          name: 'planning-poker',
        }),
      )

      // Assert
      expect(onButtonClick).toHaveBeenCalledTimes(1)
      expect(onRowActivate).not.toHaveBeenCalled()
    })

    it('leaves keyboard activation of interactive cell content alone', () => {
      // Arrange — Enter on a focused in-cell button is that button's, and the
      // event bubbles to the row, so the row has to decline it too.
      const onRowActivate = vi.fn()
      renderGrid({
        columns: [
          {
            id: 'name',
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => <button>{row.original.name}</button>,
          },
        ] as ColumnDef<Flag, unknown>[],
        onRowActivate,
      })

      // Act — scope to the cell; the row carries a button role as well
      fireEvent.keyDown(
        within(bodyCells('name')[1]).getByRole('button', { name: 'roadmap' }),
        { key: 'Enter' },
      )

      // Assert
      expect(onRowActivate).not.toHaveBeenCalled()
    })

    it('respects an explicit data-row-activate="ignore" opt-out', () => {
      // Arrange — for non-semantic interactive content (a custom toggle) that
      // the interactive-element selector would not otherwise catch.
      const onRowActivate = vi.fn()
      renderGrid({
        columns: [
          {
            id: 'name',
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => (
              <span data-row-activate="ignore">{row.original.name}</span>
            ),
          },
        ] as ColumnDef<Flag, unknown>[],
        onRowActivate,
      })

      // Act
      fireEvent.click(screen.getByText('insights'))

      // Assert
      expect(onRowActivate).not.toHaveBeenCalled()
    })

    it('marks the activated row and only that row', () => {
      // Arrange / Act — activatedRowId is matched against the row id, which
      // falls back to row.original.id.
      renderGrid({ onRowActivate: vi.fn(), activatedRowId: '2' })

      // Assert — the highlight is a class on exactly one row
      const activated = document.querySelectorAll(
        `tbody tr.${styles.trActivated}`,
      )
      expect(activated).toHaveLength(1)
      expect(activated[0]).toHaveTextContent('roadmap')
    })

    it('marks no row when activatedRowId matches nothing', () => {
      // Arrange / Act — a stale id from a URL must not highlight a row, and
      // must not throw.
      renderGrid({ onRowActivate: vi.fn(), activatedRowId: '999' })

      // Assert
      expect(
        document.querySelectorAll(`tbody tr.${styles.trActivated}`),
      ).toHaveLength(0)
    })
  })
})
