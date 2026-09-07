// The DataGrid's public surface. Every consumer imports from here — never
// from './core' or './DataGrid' directly — so the grid's internals stay free
// to move.
//
// Two import paths appear below because `core/index.ts` deliberately does not
// route every submodule: `createCsvColumn` lives in `core/csv-column`, which
// the core barrel leaves alone, so it is re-exported by its own path rather
// than widening that barrel.
export { default as DataGrid } from './DataGrid'
export type {
  DataGridProps,
  DataGridHandle,
  GridColumnContext,
  RowReorderEvent,
  FilterOption,
  DataGridColumnType,
  DataGridColumnMeta,
} from './types'
export { createActionsColumn, createIdColumn, applyColumnType } from './core'
export { createCsvColumn } from './core/csv-column'
export type { ColumnDef, Row, SortingState, Table, Column } from './core'
