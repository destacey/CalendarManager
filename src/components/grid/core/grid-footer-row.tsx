'use client'

import { flexRender } from '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'
import type { Table } from './index'
import { getOrderedVisibleLeafColumns } from './column-order'
import {
  getPinnedOffsets,
  pinnedCellClassNames,
  pinnedCellStyle,
  type PinnedCellClasses,
} from './column-pinning'

/**
 * CSS-module class names the owning grid supplies for the footer row's cells.
 * Mirrors {@link GridRowClasses} (grid-row.tsx) — a plain base class plus
 * optional numeric/pinned modifiers — so the shared markup here picks up the
 * grid's own footer styling without hard-coding a stylesheet import.
 */
export interface GridFooterRowClasses {
  td: string
  /** Applied to a footer cell whose column right-aligns its body cells. */
  tdNumeric?: string
  /** Sticky/edge classes for a pinned column's footer cell. */
  pinned?: PinnedCellClasses
}

export interface GridFooterRowProps<T extends RowData> {
  table: Table<T>
  classes: GridFooterRowClasses
  /** Column ids whose cells right-align (numeric columns) — the same set the
   *  grid's body rows use, so a numeric total lines up under its column's
   *  data rather than sitting left-aligned beneath right-aligned figures. */
  numericColumnIds?: ReadonlySet<string>
}

/**
 * True when at least one visible leaf column declares a `ColumnDef.footer`.
 * {@link GridFooterRow} uses this itself to render nothing, and the owning
 * grid uses the same check to decide whether to mount the footer's viewport
 * at all — so a grid with no footer costs nothing, not even an empty
 * `<table>`.
 */
export function hasVisibleFooter<T extends RowData>(
  table: Table<T>,
): boolean {
  return getOrderedVisibleLeafColumns(table).some(
    (column) => column.columnDef.footer != null,
  )
}

/**
 * The footer's `<tfoot>`: one cell per visible leaf column that declares
 * `ColumnDef.footer` (e.g. a column total), plus the trailing filler cell
 * that keeps the row edge-to-edge — mirrors {@link FlatGridRow}'s shape
 * (grid-row.tsx), rendered into a `<table>` the owning grid assembles (with
 * the same shared colgroup the header and body tables use).
 *
 * Column order, visibility, and pinning offsets all come from
 * {@link getOrderedVisibleLeafColumns} — the SAME geometry the header row
 * renders from — rather than a second, independently-derived ordering, so a
 * total stays under its column through hide, pin, and reorder.
 *
 * A `Header` (not just a `Column`) is still needed per cell — only `Header`
 * exposes `getContext()`, which `flexRender` needs to invoke `columnDef.footer`
 * — so each ordered column's `Header` is looked up by id from
 * `table.getFooterGroups()[0]` (TanStack's own leaf footer group, reversed
 * from `getHeaderGroups()`), rather than reading iteration order from it.
 *
 * Renders nothing at all when no visible column declares a footer.
 */
export function GridFooterRow<T extends RowData>({
  table,
  classes,
  numericColumnIds,
}: GridFooterRowProps<T>) {
  const visibleColumns = getOrderedVisibleLeafColumns(table)
  const hasFooter = visibleColumns.some(
    (column) => column.columnDef.footer != null,
  )
  if (!hasFooter) return null

  // getFooterGroups() is [...getHeaderGroups()].reverse(), so index 0 is the
  // leaf-level group (closest to the body) regardless of column grouping.
  const leafFooterGroup = table.getFooterGroups()[0]
  const headersByColumnId = new Map(
    leafFooterGroup.headers.map((header) => [header.column.id, header]),
  )

  return (
    <tfoot>
      <tr>
        {visibleColumns.map((column) => {
          const header = headersByColumnId.get(column.id)
          const pinned = getPinnedOffsets(column)
          const pinnedClassName =
            classes.pinned && pinned
              ? ` ${pinnedCellClassNames(pinned, classes.pinned)}`
              : ''
          const numericClassName =
            classes.tdNumeric && numericColumnIds?.has(column.id)
              ? ` ${classes.tdNumeric}`
              : ''

          return (
            <td
              key={column.id}
              data-column-id={column.id}
              className={`${classes.td}${numericClassName}${pinnedClassName}`}
              style={pinnedCellStyle(pinned)}
            >
              {header
                ? flexRender(column.columnDef.footer, header.getContext())
                : null}
            </td>
          )
        })}
        {/* Filler cell keeps the row edge-to-edge, matching the header and
            body rows' trailing filler cell. */}
        <td aria-hidden="true" className={classes.td} />
      </tr>
    </tfoot>
  )
}
