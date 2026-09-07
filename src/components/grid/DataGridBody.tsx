'use client'

import type { ReactNode } from 'react'
import { Empty, Spin } from 'antd'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RowData } from '@tanstack/react-table'

import type { Row } from './core'
import { FlatGridRow, SortableFlatGridRow, type GridRowClasses } from './core'
import { virtualSpacers } from './core/virtual-geometry'
import styles from './DataGrid.module.css'

/**
 * Fixed row-height estimate for the virtualizer. Rows are uniform in practice
 * (`.td`: 2px padding + 1px border + one no-wrap text line), so a fixed
 * estimate avoids per-row measurement; positions stay self-consistent because
 * the spacer rows are sized from the same estimates.
 */
export const ROW_HEIGHT_ESTIMATE = 28

/** Rows rendered beyond the visible window on each side. */
export const ROW_OVERSCAN = 10

/**
 * CSS-module classes for body rows. They live here rather than in DataGrid
 * because this is the only component that renders rows.
 */
const rowClasses: GridRowClasses = {
  tr: styles.tr,
  trAlt: styles.trAlt,
  td: styles.td,
  tdNumeric: styles.tdNumeric,
  trActivatable: styles.trActivatable,
  trActivated: styles.trActivated,
  pinned: {
    pinned: styles.tdPinned,
    pinnedLeftEdge: styles.pinnedLeftEdge,
    pinnedRightEdge: styles.pinnedRightEdge,
  },
}

export interface DataGridBodyProps<T extends RowData> {
  rows: Row<T>[]
  /** The grid's single scroll viewport ref — the table wrapper (both axes).
   *  Its scrollLeft is mirrored into the header viewport. */
  bodyViewportRef: React.RefObject<HTMLDivElement | null>
  /** Mirrors scrollLeft into the header viewport. */
  onBodyScroll: (e: React.UIEvent<HTMLDivElement>) => void
  /** The shared colgroup element (the same instance the header table
   *  renders). Stable across scrolls, so React skips reconciling it. */
  colGroup: ReactNode
  isLoading: boolean
  emptyMessage: string
  visibleColumnCount: number
  /** Column ids whose body cells right-align (numeric columns). */
  numericColumnIds: ReadonlySet<string>
  /** True when the grid has an `onRowReorder`. Every row then renders in its
   *  sortable form — including while dragging is disabled — so drag-handle
   *  cells can always reach the drag context. */
  flatDndEnabled: boolean
  isDragEnabled: boolean
  draggedNodeId: string | null
  flatRowId: (row: Row<T>) => string
  /** Row activation; see `DataGridProps.onRowActivate`. */
  onRowActivate?: (row: T) => void
  activatedRowId?: string | null
  getRowActivateLabel?: (row: T) => string
}

/**
 * The scrolling body viewport, split from the grid so it alone owns the row
 * virtualizer: every overscan-window shift re-renders whichever component
 * holds the virtualizer, and when that was the whole grid the header's antd
 * controls (filter popovers, floating-filter inputs) re-rendered per shift —
 * visible as scroll stutter. Confined here, a shift re-renders only the
 * ~viewport of body rows; the header, toolbar, and filters stay untouched.
 */
export default function DataGridBody<T extends RowData>({
  rows,
  bodyViewportRef,
  onBodyScroll,
  colGroup,
  isLoading,
  emptyMessage,
  visibleColumnCount,
  numericColumnIds,
  flatDndEnabled,
  isDragEnabled,
  draggedNodeId,
  flatRowId,
  onRowActivate,
  activatedRowId,
  getRowActivateLabel,
}: DataGridBodyProps<T>) {
  // ─── Row virtualization ──────────────────────────────────
  // Only the visible window of rows (plus overscan) is mounted, ag-grid
  // style. The offsets render as spacer rows (real <tr>s) so the body stays a
  // genuine table — colgroup column alignment with the header table is
  // untouched.
  //
  // The virtualizer is created by its own hook on every render and read
  // immediately through getVirtualItems()/getTotalSize(), so no instance of it
  // is held across renders: the window is recomputed from the current scroll
  // offset and row count each time this component renders.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    // The table wrapper is the grid's single vertical + horizontal scroller.
    getScrollElement: () => bodyViewportRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: ROW_OVERSCAN,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  const { top: spacerTop, bottom: spacerBottom } = virtualSpacers({
    firstRowStart: virtualRows[0]?.start ?? 0,
    lastRowEnd: virtualRows[virtualRows.length - 1]?.end ?? 0,
    totalSize: rowVirtualizer.getTotalSize(),
    // Estimated and rendered geometry share one coordinate space here: the
    // rows flow at their natural height and nothing outside this table is
    // positioned from the virtualizer's offsets, so the spacers are unscaled.
    rowScale: 1,
    hasRows: virtualRows.length > 0,
  })

  // While loading (or with no rows) the rows are replaced by a status overlay.
  // The overlay is a sibling of the scrolling wrapper — anchored to the
  // VISIBLE body viewport, not the table: a wide table in a narrow window
  // centers a spanning status <td> at half the scroll width, which can sit
  // entirely off-screen.
  const showStatusOverlay = isLoading || rows.length === 0

  return (
    <div className={styles.bodyArea}>
      <div
        className={styles.tableWrapper}
        ref={bodyViewportRef}
        onScroll={onBodyScroll}
        // Marks the single scroll viewport, so a test can give it a height.
        // The virtualizer sizes its window from this element's offsetHeight,
        // and a zero height yields an EMPTY range rather than an
        // overscan-sized one (virtual-core's calculateRange returns null when
        // outerSize is 0) — so in a layoutless environment like jsdom no rows
        // render at all until this element measures non-zero.
        data-grid-body-viewport=""
      >
        <table className={styles.tableElement}>
          {colGroup}
          <tbody>
            {!showStatusOverlay && (
              <>
                {/* Virtual offset spacers: real table rows standing in for the
                    unrendered rows above/below the window. Zero padding and
                    border so they add no width — the header and body tables'
                    scrollWidth must match. */}
                {spacerTop > 0 && (
                  <tr aria-hidden="true">
                    <td
                      className={styles.virtualSpacer}
                      colSpan={visibleColumnCount + 1}
                      style={{ height: spacerTop }}
                    />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  // Zebra striping keys off the absolute display index so
                  // stripes don't shift as the window moves.
                  const index = virtualRow.index

                  // Both flat forms take the same activation set, resolved
                  // once so the plain and sortable rows cannot disagree.
                  const activation = onRowActivate
                    ? {
                        onActivate: () => onRowActivate(row.original),
                        isActivated: flatRowId(row) === activatedRowId,
                        activateLabel: getRowActivateLabel?.(row.original),
                      }
                    : undefined

                  if (flatDndEnabled) {
                    const nodeId = flatRowId(row)
                    return (
                      <SortableFlatGridRow
                        key={row.id}
                        row={row}
                        index={index}
                        classes={rowClasses}
                        numericColumnIds={numericColumnIds}
                        nodeId={nodeId}
                        isDragging={draggedNodeId === nodeId}
                        isDragEnabled={isDragEnabled}
                        {...activation}
                      />
                    )
                  }

                  return (
                    <FlatGridRow
                      key={row.id}
                      row={row}
                      index={index}
                      classes={rowClasses}
                      numericColumnIds={numericColumnIds}
                      {...activation}
                    />
                  )
                })}
                {spacerBottom > 0 && (
                  <tr aria-hidden="true">
                    <td
                      className={styles.virtualSpacer}
                      colSpan={visibleColumnCount + 1}
                      style={{ height: spacerBottom }}
                    />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      {showStatusOverlay && (
        <div className={styles.statusOverlay}>
          {isLoading ? (
            <Spin size="large" />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={emptyMessage}
            />
          )}
        </div>
      )}
    </div>
  )
}
