import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  metaHelper,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

import type { DataGridColumnMeta } from './types'

/**
 * The TanStack feature set this grid is built from.
 *
 * v9 makes features opt-in: only what is registered here is linked into the
 * bundle, and only registered features contribute options, state slices, and
 * table/column methods. Adding a capability to the grid means registering its
 * feature here first — otherwise the option silently does nothing.
 *
 * Faceting is registered deliberately: it powers the set-filter panels'
 * distinct value lists.
 *
 * `columnMeta` is a type-only slot: v9 replaces v8's global `ColumnMeta`
 * declaration merging with per-feature-set typing, so `column.meta` is typed
 * as {@link DataGridColumnMeta} for this grid without leaking those fields
 * onto every TanStack table in the app. The value is phantom — stripped at
 * runtime, only its type is read.
 */
export const dataGridFeatures = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  facetedRowModel: createFacetedRowModel(),
  // Distinct-value sets behind the set-filter panels AND the data-driven
  // column-type inference. It is a slot of its own: without it
  // getFacetedUniqueValues() returns an empty map and every column silently
  // infers as text.
  facetedUniqueValues: createFacetedUniqueValues(),
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  // v9 resolves a string `sortFn` against this registry instead of a global
  // list of built-ins, so an unregistered name is a compile error rather than
  // a sort that silently does nothing. Register a built-in before using it.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
  },
  columnMeta: metaHelper<DataGridColumnMeta>(),
})

/** The feature set's type — the first generic on every v9 table type. */
export type DataGridFeatures = typeof dataGridFeatures
