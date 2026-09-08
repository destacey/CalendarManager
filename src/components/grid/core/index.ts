// Shared grid engine powering the reusable DataGrid (components/grid).

import type {
  Cell as CellCore,
  CellContext as CellContextCore,
  Column as ColumnCore,
  ColumnDef as ColumnDefCore,
  FilterFn as FilterFnCore,
  Header as HeaderCore,
  HeaderContext as HeaderContextCore,
  HeaderGroup as HeaderGroupCore,
  Row as RowCore,
  RowData as RowDataCore,
  SortFn as SortFnCore,
  TableOptions as TableOptionsCore,
  TableState as TableStateCore,
} from '@tanstack/table-core'
import type { ReactTable } from '@tanstack/react-table'

import type { DataGridFeatures } from './grid-features'

// TanStack table types with the grid's feature set pre-bound.
//
// v9 puts a TFeatures generic first on every public type (ColumnDef<TFeatures,
// TData, TValue>), so importing these straight from '@tanstack/react-table'
// binds the ROW type to the features slot and fails to compile. Binding it
// once here keeps call sites at the familiar (TData, TValue) arity and makes
// this the only place that knows which features the grid runs on. Import
// table types from this barrel, never from '@tanstack/react-table' directly.
export type Cell<TData extends RowDataCore, TValue> = CellCore<
  DataGridFeatures,
  TData,
  TValue
>
export type Column<TData extends RowDataCore, TValue> = ColumnCore<
  DataGridFeatures,
  TData,
  TValue
>
export type ColumnDef<TData extends RowDataCore, TValue = unknown> =
  ColumnDefCore<DataGridFeatures, TData, TValue>
export type Header<TData extends RowDataCore, TValue> = HeaderCore<
  DataGridFeatures,
  TData,
  TValue
>
export type HeaderGroup<TData extends RowDataCore> = HeaderGroupCore<
  DataGridFeatures,
  TData
>
export type Row<TData extends RowDataCore> = RowCore<DataGridFeatures, TData>
export type Table<TData extends RowDataCore> = ReactTable<
  DataGridFeatures,
  TData
>
export type TableOptions<TData extends RowDataCore> = TableOptionsCore<
  DataGridFeatures,
  TData
>
export type {
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  ColumnPinningPosition,
  RowData,
  SortingState,
} from '@tanstack/react-table'
export type { DataGridFeatures } from './grid-features'
export { dataGridFeatures } from './grid-features'

export type TableState = TableStateCore<DataGridFeatures>
export type FilterFn<TData extends RowDataCore> = FilterFnCore<
  DataGridFeatures,
  TData
>
export type SortingFn<TData extends RowDataCore> = SortFnCore<
  DataGridFeatures,
  TData
>
export type CellContext<TData extends RowDataCore, TValue> = CellContextCore<
  DataGridFeatures,
  TData,
  TValue
>
export type HeaderContext<TData extends RowDataCore, TValue> = HeaderContextCore<
  DataGridFeatures,
  TData,
  TValue
>
export type { ColumnVisibilityState as VisibilityState } from '@tanstack/react-table'
export { flexRender } from '@tanstack/react-table'

// Shared column meta types (+ TanStack ColumnMeta module augmentation)
export type {
  FilterOption,
  DataGridColumnType,
  DataGridColumnMeta,
} from './types'

// Filter functions
export {
  stringContainsFilter,
  setContainsFilter,
  numberRangeFilter,
} from './grid-filters'

// Descriptor filter engine + filter UI (popup, floating row, set/date panels)
export * from './filters'

// Column types (declarative via meta.columnType) + helpers
export { applyColumnType, YES, NO, YES_NO_COLUMN_SIZE } from './column-types'

// Reusable row-actions column (⋯ dropdown, per-row getItems)
export { createActionsColumn, ACTIONS_COLUMN_SIZE } from './actions-column'
export type { ActionsColumnOptions } from './actions-column'

// Sorting utilities
export { dateSortBy, sortEmptyLast } from './grid-sorting'

// CSV export
export { exportGridToCsv } from './grid-export'

// Auto-injected identifier column
export {
  ID_COLUMN_ID,
  createIdColumn,
  hasIdColumn,
  rowsHaveId,
  withIdColumn,
} from './id-column'

// Table config + shared state hooks
export {
  mergeColumnVisibility,
  useGridState,
  useGridTable,
} from './use-grid-table'
export type {
  GridState,
  UseGridStateOptions,
  UseGridTableOptions,
} from './use-grid-table'

// Column layout persistence (opt-in via DataGrid's persistStateKey prop)
export {
  GRID_PERSISTENCE_ENABLED_KEY,
  GRID_STATE_KEY_PREFIX,
  GRID_STATE_VERSION,
  clearAllGridColumnState,
  gridStateStorageKey,
  isGridPersistenceEnabled,
  isPersistedColumnState,
  useGridColumnStatePersistence,
} from './use-grid-persistence'
export type { PersistedColumnState } from './use-grid-persistence'

// Column pinning (sticky rendering over TanStack's columnPinning state)
export {
  getPinnedBandOffsets,
  getPinnedOffsets,
  pinnedCellClassNames,
  pinnedCellStyle,
} from './column-pinning'
export type {
  PinnedCellClasses,
  PinnedColumnOffsets,
} from './column-pinning'

// Column autosize (measure rendered content, apply via columnSizing)
export {
  AUTOSIZE_MAX_WIDTH,
  AUTOSIZE_MIN_WIDTH,
  computeAutosizeWidth,
  measureColumnContent,
} from './column-autosize'
export type {
  AutosizeWidthInput,
  ColumnContentMeasurement,
} from './column-autosize'

// Per-column header menu (⋮ — sort, pin, autosize, choose columns, reset)
export {
  ColumnChooserModal,
  ColumnMenuTrigger,
  buildColumnMenuItems,
  getColumnChooserOptions,
} from './column-menu'
export type {
  ColumnChooserModalProps,
  ColumnChooserOption,
  ColumnMenuItemsInput,
  ColumnMenuTriggerProps,
} from './column-menu'

// Toolbar (search, row count, refresh, clear, export, help)
export { default as GridToolbar } from './grid-toolbar'
export type { GridToolbarProps } from './grid-toolbar'

// Row renderer — the flat row-renderer seam (no tree mode in this app)
export { FlatGridRow, SortableFlatGridRow } from './grid-row'
export type {
  FlatGridRowProps,
  GridRowClasses,
  SortableFlatGridRowProps,
} from './grid-row'

// Header sort/resize cell
export {
  GridHeaderCell,
  GridHeaderContent,
  useResizeClickGuard,
} from './grid-header-row'
export type {
  GridHeaderCellClasses,
  GridHeaderCellProps,
  ResizeClickGuard,
} from './grid-header-row'

// Footer row (ColumnDef.footer totals)
export { GridFooterRow, hasVisibleFooter } from './grid-footer-row'
export type {
  GridFooterRowClasses,
  GridFooterRowProps,
} from './grid-footer-row'

// DnD — shared mechanics (flat row reorder; there is no tree-only
// reparenting projection in this app — see dnd/grid-dnd.tsx)
export {
  DRAG_ACTIVATION_DISTANCE,
  GridSortableRow,
  useGridDndSensors,
  DragHandleCell,
  useGridDragHandle,
} from './dnd/grid-dnd'
