'use client'

import { useMemo } from 'react'
import type { RowData } from '@tanstack/react-table'

import type {
  Column,
  ColumnDef,
  ColumnOrderState,
  Table,
  VisibilityState,
} from './index'
import type { GridColumnContext } from '../types'
import { applySafeAccessor } from './column-accessors'
import { applyColumnType } from './column-types'
import { reconcileColumnOrder } from './column-order'
import { rowsHaveId, withIdColumn } from './id-column'
import { mergeColumnVisibility } from './use-grid-table'
import { resolveFilterType, type FilterType } from './filters'

/**
 * Resolves a column's filter/data type. An explicit `meta.filterType`
 * (including one applied by a `columnType`) always wins; otherwise the type is
 * inferred from the column's data by sampling its faceted unique values:
 *   - all sampled values are numbers      → 'number'
 *   - all sampled values are Dates        → 'date'
 *   - otherwise                           → 'text'
 * Empty/mixed data falls back to 'text'. Drives both the per-column filter UI
 * and numeric cell alignment, so the two never disagree.
 */
export const resolveColumnFilterType = <T extends RowData,>(
  column: Column<T, unknown>,
): FilterType => {
  const meta = column.columnDef.meta
  if (meta?.filterType) return resolveFilterType(meta.filterType)

  // Display columns (actions, drag grips — no accessor) have no values to
  // sample; TanStack's faceted-values util throws on them.
  if (!column.accessorFn) return 'text'

  const sample: unknown[] = []
  for (const v of column.getFacetedUniqueValues().keys()) {
    if (v === null || v === undefined || v === '') continue
    sample.push(v)
    if (sample.length >= 20) break // enough to infer; avoid scanning huge sets
  }
  if (sample.length === 0) return 'text'

  if (sample.every((v) => typeof v === 'number')) return 'number'
  if (sample.every((v) => v instanceof Date)) return 'date'
  return 'text'
}

export interface UseGridColumnsOptions<T extends RowData> {
  /** The grid's `columns` prop — a static array or a function of the column
   *  context. */
  columns:
    | ColumnDef<T, any>[]
    | ((context: GridColumnContext) => ColumnDef<T, any>[])
  /** The context handed to the function form of `columns`. */
  columnContext: GridColumnContext
  /** The grid's row data — read only to decide whether an `Id` column can be
   *  appended (the rows must carry an `id`). */
  data: T[]
  /** The grid's `includeIdColumn` prop. */
  includeIdColumn: boolean
  /** The user's column-chooser show/hide choices. */
  userColumnVisibility: VisibilityState
  /** The user's raw column order (what persists). */
  columnOrder: ColumnOrderState
}

export interface UseGridColumnsResult<T extends RowData> {
  /** The defs actually handed to TanStack: safe accessors applied, column
   *  types expanded, and the `Id` column appended when applicable. */
  resolvedColumns: ColumnDef<T, any>[]
  /** The merged consumer / user / default visibility map. */
  columnVisibility: VisibilityState
  /** The column order handed to TanStack — the user's order reconciled
   *  against the live defs. */
  effectiveColumnOrder: ColumnOrderState
  /** True when any def is a column group (grouped headers / bands). */
  hasGroupedHeaders: boolean
  /** Whether header-drag and chooser column reordering are offered. */
  columnReorderEnabled: boolean
}

/**
 * Turns the grid's `columns` prop into everything TanStack needs to build its
 * columns: the resolved defs, the merged visibility map, and the reconciled
 * column order.
 *
 * Split out of the component because these five results are one dependency
 * chain — each memo keys on the previous one's identity, and rebuilding the
 * defs on every render made TanStack rebuild its headers, which replaced the
 * filter Popover's trigger DOM node; antd read that as a click-outside and
 * closed the open popover on every checkbox toggle.
 */
export function useGridColumns<T extends RowData>({
  columns: columnsProp,
  columnContext,
  data,
  includeIdColumn,
  userColumnVisibility,
  columnOrder,
}: UseGridColumnsOptions<T>): UseGridColumnsResult<T> {
  // Resolved outside the memo below and passed as a boolean: keying the column
  // defs on `data` would rebuild them on every refetch, which is the header
  // churn the note on resolvedColumns describes. rowsHaveId reads one row.
  const injectIdColumn = includeIdColumn && rowsHaveId(data)

  const columns = useMemo(() => {
    const resolved =
      typeof columnsProp === 'function'
        ? columnsProp(columnContext)
        : columnsProp
    return withIdColumn(resolved, injectIdColumn)
  }, [columnsProp, columnContext, injectIdColumn])

  // applySafeAccessor must run before applyColumnType (the type's raw-value
  // reader handles accessorFns but not dotted keys). Memoized on `columns`:
  // see the note on this hook for what rebuilding these defs costs.
  const resolvedColumns = useMemo(
    () =>
      columns.map((col) =>
        applyColumnType(applySafeAccessor(col as ColumnDef<T, unknown>)),
      ) as ColumnDef<T, any>[],
    [columns],
  )

  // meta.unavailable → columnVisibility, recursing into grouped defs (TanStack
  // shrinks a band's colSpan as its leaves hide).
  const consumerColumnVisibility = useMemo<VisibilityState>(() => {
    const visibility: VisibilityState = {}
    const collect = (cols: typeof resolvedColumns) => {
      for (const col of cols) {
        const children = (col as { columns?: typeof resolvedColumns }).columns
        if (children) collect(children)
        const meta = col.meta
        if (meta?.unavailable === undefined) continue
        const id =
          col.id ??
          (col as { accessorKey?: string | number }).accessorKey?.toString()
        if (id) visibility[id] = !meta.unavailable
      }
    }
    collect(resolvedColumns)
    return visibility
  }, [resolvedColumns])

  // meta.hiddenByDefault → the layer *below* the user's choices, so the column
  // starts hidden, stays in the chooser, and returns to hidden on reset.
  const defaultColumnVisibility = useMemo<VisibilityState>(() => {
    const visibility: VisibilityState = {}
    const collect = (cols: typeof resolvedColumns) => {
      for (const col of cols) {
        const children = (col as { columns?: typeof resolvedColumns }).columns
        if (children) collect(children)
        if (col.meta?.hiddenByDefault !== true) continue
        const id =
          col.id ??
          (col as { accessorKey?: string | number }).accessorKey?.toString()
        if (id) visibility[id] = false
      }
    }
    collect(resolvedColumns)
    return visibility
  }, [resolvedColumns])

  // The user's Choose Columns choices layer on top: consumer-hidden columns
  // stay hidden (and out of the chooser); user choices win everywhere else.
  const columnVisibility = useMemo<VisibilityState>(
    () =>
      mergeColumnVisibility(
        consumerColumnVisibility,
        userColumnVisibility,
        defaultColumnVisibility,
      ),
    [consumerColumnVisibility, userColumnVisibility, defaultColumnVisibility],
  )

  // Leaf column ids in DEF order (recursing bands), for reconciling the
  // persisted/user column order against the live defs.
  const leafColumnIds = useMemo<string[]>(() => {
    const ids: string[] = []
    const collect = (cols: typeof resolvedColumns) => {
      for (const col of cols) {
        const children = (col as { columns?: typeof resolvedColumns }).columns
        if (children) {
          collect(children)
          continue
        }
        const id =
          col.id ??
          (col as { accessorKey?: string | number }).accessorKey?.toString()
        if (id) ids.push(id)
      }
    }
    collect(resolvedColumns)
    return ids
  }, [resolvedColumns])

  // The order actually fed to TanStack: the user's order reconciled against the
  // live defs so removed columns drop out and columns added since (or absent
  // from a persisted order) land at their def position instead of being
  // appended to the end. The RAW gridState.columnOrder is what persists — this
  // derivative never round-trips to storage, so defs changing between pages
  // can't rewrite the stored order.
  const effectiveColumnOrder = useMemo(
    () => reconcileColumnOrder(columnOrder, leafColumnIds),
    [columnOrder, leafColumnIds],
  )

  // Column reordering is on for every grid EXCEPT grouped-header grids:
  // reordering leaves across band boundaries would split bands, so the
  // simplest safe scope is to disable header-drag reordering when any def is a
  // band. (The chooser's reorder is likewise gated on this.)
  const hasGroupedHeaders = useMemo(
    () =>
      resolvedColumns.some(
        (col) => (col as { columns?: unknown[] }).columns !== undefined,
      ),
    [resolvedColumns],
  )

  return {
    resolvedColumns,
    columnVisibility,
    effectiveColumnOrder,
    hasGroupedHeaders,
    columnReorderEnabled: !hasGroupedHeaders,
  }
}

/**
 * Column ids whose BODY cells right-align: an explicit `meta.align` wins,
 * otherwise numeric columns (resolved by {@link resolveColumnFilterType}, the
 * same resolution the filter UI uses, so the two never disagree). Headers stay
 * left-aligned regardless.
 *
 * Deliberately not memoized. `useTable` returns a fresh object every render
 * (it spreads the table instance together with the current options and state),
 * so a memo keyed on the table would recompute every render anyway — and it
 * has to, because the inference samples faceted values, which stay empty until
 * rows arrive. The work is one pass over the leaf columns.
 */
export function resolveNumericColumnIds<T extends RowData>(
  table: Table<T>,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const column of table.getAllLeafColumns()) {
    const align = column.columnDef.meta?.align
    if (align === 'left') continue
    if (align === 'right' || resolveColumnFilterType(column) === 'number') {
      ids.add(column.id)
    }
  }
  return ids
}
