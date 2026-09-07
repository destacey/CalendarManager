import type { ColumnDef, SortingState, Table } from './core'
import type { RowData } from '@tanstack/react-table'

// Column meta + filter option types moved to the shared grid core (including
// the TanStack ColumnMeta module augmentation); re-exported so DataGrid
// consumers keep a single import surface.
export type {
  FilterOption,
  DataGridColumnType,
  DataGridColumnMeta,
} from './core/types'

/**
 * Context passed to the `columns` function prop.
 * Provides drag-and-drop state so domain code can build columns reactively.
 */
export interface GridColumnContext {
  isDragEnabled: boolean
}

/**
 * Props for the DataGrid component.
 */
export interface DataGridProps<T extends RowData> {
  /**
   * Row data. May be undefined while loading (e.g. straight from a query
   * hook) — treated as an empty grid, matching the old ag-grid `rowData`
   * tolerance.
   */
  data: T[] | undefined
  /** Loading state. */
  isLoading?: boolean
  /**
   * Column definitions. Can be a static array or a function that receives
   * {@link GridColumnContext} and returns columns.
   */
  columns:
    | ColumnDef<T, any>[]
    | ((context: GridColumnContext) => ColumnDef<T, any>[])
  /**
   * Appends a hidden `Id` column when the rows carry an `id` and the columns
   * don't already define one, so a user can unhide it via Choose Columns and
   * export the ids an import file needs. On by default; pass `false` for grids
   * whose `id` is a client-side row key rather than a persisted record id.
   */
  includeIdColumn?: boolean

  // -- Toolbar --
  onRefresh?: () => Promise<any> | void
  /** Slot for domain-specific actions rendered on the left of the toolbar. */
  leftSlot?: React.ReactNode
  /** Content rendered inside the help popover. */
  helpContent?: React.ReactNode
  /** Slot for actions rendered just before the export/help group (a divider
   *  separates it from export). For grid-specific toggles. */
  actionsSlot?: React.ReactNode
  /** Slot for actions rendered on the far right of the toolbar. */
  rightSlot?: React.ReactNode
  emptyMessage?: string
  /** Fixed height in pixels. When omitted, the grid auto-sizes to fill the remaining viewport height. */
  height?: number
  /** File name prefix for CSV export (e.g., 'projects'). */
  csvFileName?: string

  // -- Behavior toggles --
  /**
   * Sort applied on mount (ag-grid `sort: 'asc'` equivalent), e.g.
   * `[{ id: 'done', desc: true }]`. Read once — later changes don't reset
   * the user's sorting.
   */
  initialSorting?: SortingState
  /**
   * Preset for the two situations grids are used in.
   *
   * `'advanced'` (default) is the data-exploration surface: toolbar, filters,
   * column menu, and a body that fills the remaining viewport height.
   *
   * `'simple'` is a grid inside a record section — read-and-click over a small,
   * bounded set. No toolbar or filters (the section heading above already says
   * what it is), and the height fits the rows rather than running to the bottom
   * of the page. Individual flags still override the preset.
   */
  variant?: 'simple' | 'advanced'
  /** Whether to show the global search input. Default: true. */
  includeGlobalSearch?: boolean
  /** Whether to show the CSV export button. Default: true. */
  includeExportButton?: boolean
  /**
   * Whether columns are filterable at all — enables the per-column filter popup
   * (opened from the header filter icon). Default: true. When false, no column
   * filtering UI is shown regardless of `includeFloatingFilters`.
   */
  includeColumnFilters?: boolean
  /**
   * Whether to show the inline floating-filter row beneath the header — a
   * compact single-condition editor per column, in addition to the popup.
   * Default: true. Ignored when `includeColumnFilters` is false.
   */
  includeFloatingFilters?: boolean

  // -- Row identity --
  /** Stable row id (required for `onRowReorder`). Falls back to
   *  `row.original.id`, then TanStack's index-based id. */
  getRowId?: (row: T) => string

  // -- Grid state --
  /**
   * Opt-in localStorage persistence of the user's column layout (sizing,
   * show/hide choices, pinning) under `calendar-grid:{key}:v2`. Keys are per page
   * context — stable, human-readable, route-independent kebab-case (e.g.
   * 'ppm-projects', 'team-backlog'); shared grid components should expose
   * this as a pass-through prop so each page site supplies its own. Omit for
   * no persistence. Sorting/filters/search are deliberately not persisted.
   */
  persistStateKey?: string
  /**
   * Fires with the displayed rows (post filter + sort, in display order)
   * whenever that set changes — including on mount. For consumers deriving
   * external UI (e.g. a chart) from the grid state.
   */
  onDisplayedRowsChange?: (rows: T[]) => void

  // -- Row activation (enabled when provided) --
  /**
   * Makes whole rows openable: click, or Enter/Space with the row focused.
   * Supplying it turns each body row into a focusable `role="button"`, so the
   * list is navigable by keyboard without a link in every primary cell.
   *
   * Clicks on interactive cell content (links, buttons, inputs, and anything
   * marked `data-row-activate="ignore"`) are left alone — an actions dropdown
   * inside an activatable row still just opens the dropdown.
   */
  onRowActivate?: (row: T) => void
  /**
   * The activated row's id, matched against {@link getRowId}. Drives the
   * highlight; the grid does not track it, so the consumer owns the value and
   * can keep it in the URL.
   */
  activatedRowId?: string | null
  /**
   * Accessible name for an activatable row, e.g. `(row) => row.name`. Without
   * it the row's button role announces its whole flattened text.
   */
  getRowActivateLabel?: (row: T) => string

  // -- Flat row reorder (enabled when provided) --
  /**
   * Called after a row-drag drop with the displayed rows in post-drop order.
   * Dragging auto-disables while sorted/filtered/searched (the displayed
   * order wouldn't be the data order) or loading — column functions read
   * `context.isDragEnabled` to render their drag handle accordingly.
   */
  onRowReorder?: (event: RowReorderEvent<T>) => void | Promise<void>
}

/** Payload for {@link DataGridProps.onRowReorder}. */
export interface RowReorderEvent<T extends RowData> {
  /** All displayed rows in their post-drop order. */
  orderedData: T[]
  /** The dragged row's id. */
  activeId: string
  /** The dragged row's displayed index before the drop. */
  fromIndex: number
  /** The dragged row's displayed index after the drop. */
  toIndex: number
}

/**
 * Handle exposed by DataGrid via ref.
 */
export interface DataGridHandle<T extends RowData> {
  /** The underlying TanStack table instance. */
  table: Table<T>
  /** The displayed (post filter + sort) rows' data, in display order. */
  getDisplayedRows: () => T[]
}
