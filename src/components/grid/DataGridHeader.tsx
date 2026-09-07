'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Popover } from 'antd'
import type { RowData } from '@tanstack/react-table'
import {
  DndContext,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
  closestCenter,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'

import type { Column, Header, Table } from './core'
import {
  CombinedFilterPanel,
  DateFilterPanel,
  FilterPopup,
  SetFilterPanel,
  getDayKeys,
  getPinnedBandOffsets,
  getPinnedOffsets,
  getSetValues,
  pinnedCellClassNames,
  pinnedCellStyle,
  renderFilterTrigger,
  renderFloatingFilterCell,
  renderSetFilterCell,
  type ColumnFilterModel,
  type FloatingFilterCellClasses,
  type PinnedCellClasses,
} from './core'
import {
  GridHeaderContent,
  SortableHeaderCell,
  useResizeClickGuard,
  type GridHeaderCellClasses,
} from './core/grid-header-row'
import { resolveColumnFilterType } from './core/use-grid-columns'
import { restrictToHorizontalAxis } from './core/use-column-reorder'
import styles from './DataGrid.module.css'

/** Stable empty set for columns with no expanded date-tree nodes yet. Never
 * mutated — toggles always copy before writing. */
const EMPTY_NODE_SET: Set<string> = new Set<string>()

const headerCellClasses: GridHeaderCellClasses = {
  th: styles.th,
  thSortable: styles.thSortable,
  thContent: styles.thContent,
  thText: styles.thText,
  resizer: styles.resizer,
  resizerActive: styles.resizerActive,
  thDraggable: styles.thDraggable,
  thDragging: styles.thDragging,
}

// Pinned-column sticky classes per cell kind. The edge classes (the divider
// between the pinned and scrolling sections) are shared.
const headerPinnedClasses: PinnedCellClasses = {
  pinned: styles.thPinned,
  pinnedLeftEdge: styles.pinnedLeftEdge,
  pinnedRightEdge: styles.pinnedRightEdge,
}

const filterPinnedClasses: PinnedCellClasses = {
  pinned: styles.filterThPinned,
  pinnedLeftEdge: styles.pinnedLeftEdge,
  pinnedRightEdge: styles.pinnedRightEdge,
}

const floatingCellClasses: FloatingFilterCellClasses = {
  cell: styles.floatingCell,
  summary: styles.setSummary,
  trigger: styles.filterTrigger,
  triggerActive: styles.filterTriggerActive,
}

export interface DataGridHeaderProps<T extends RowData> {
  table: Table<T>
  /** The shared colgroup element — the same instance the body table renders,
   *  so `table-layout: fixed` aligns the two tables' columns exactly. */
  colGroup: ReactNode
  /** The visible leaf columns' sortable ids in display order, namespaced
   *  `col:` (the ids the header cells' own useSortable use). */
  columnSortableIds: string[]
  /** The header viewport element. The body's onScroll writes its scrollLeft
   *  here, so the columns track the body's horizontal position. */
  headerViewportRef: React.RefObject<HTMLDivElement | null>
  /** Live width of the body's vertical scrollbar, for the header spacer that
   *  keeps header and body columns aligned. */
  scrollbarWidth: number
  /** `DataGridProps.includeColumnFilters` — whether columns are filterable
   *  at all (the header's filter-icon popup). */
  includeColumnFilters: boolean
  /** `DataGridProps.includeFloatingFilters` — whether the inline
   *  single-condition row is shown beneath the header. */
  includeFloatingFilters: boolean
  columnReorderEnabled: boolean
  /** dnd-kit sensors, shared with the grid's row-reorder context. */
  sensors: SensorDescriptor<SensorOptions>[]
  onColumnDragEnd: (event: DragEndEvent) => void
  /** The grid's `⋮` column-menu trigger for one leaf header. Supplied by the
   *  grid because the menu's actions (autosize, reset) act on grid-level
   *  state. */
  renderColumnMenu: (header: Header<T, unknown>) => ReactNode
}

/**
 * The header strip: the clipped header viewport (band rows, the leaf header
 * row, and the optional floating-filter row) plus the spacer that sits above
 * the body's vertical scrollbar.
 *
 * Split from DataGrid because the whole per-column filter layer belongs to it
 * and nothing else: the open-popover id and the date-tree expansion state are
 * read only here, so they live here rather than on the grid.
 */
export default function DataGridHeader<T extends RowData>({
  table,
  colGroup,
  columnSortableIds,
  headerViewportRef,
  scrollbarWidth,
  includeColumnFilters,
  includeFloatingFilters,
  columnReorderEnabled,
  sensors,
  onColumnDragEnd,
  renderColumnMenu,
}: DataGridHeaderProps<T>) {
  const resizeGuard = useResizeClickGuard()
  // One open filter popover at a time, owned here: a controlled popover must
  // keep its trigger DOM, so the open state cannot live inside the trigger.
  const [openFilterColumnId, setOpenFilterColumnId] = useState<string | null>(
    null,
  )
  // Expanded date-tree node keys per column, owned above the filter popover.
  // The popover's content is rebuilt whenever the column filter changes, so
  // state kept inside the DateFilterPanel is lost on toggle; keeping it here
  // makes the tree's expand/collapse survive checkbox changes.
  const [dateTreeExpanded, setDateTreeExpanded] = useState<
    Record<string, Set<string>>
  >({})

  const toggleDateTreeNode = useCallback(
    (columnId: string, nodeKey: string) => {
      setDateTreeExpanded((prev) => {
        const current = prev[columnId] ?? EMPTY_NODE_SET
        const next = new Set(current)
        if (next.has(nodeKey)) next.delete(nodeKey)
        else next.add(nodeKey)
        return { ...prev, [columnId]: next }
      })
    },
    [],
  )

  const showColumnFilters = useMemo(
    () =>
      includeColumnFilters &&
      table.getVisibleLeafColumns().some((c) => c.getCanFilter()),
    [includeColumnFilters, table],
  )

  const showFloatingFilters = showColumnFilters && includeFloatingFilters

  /**
   * Wraps a trigger element in the multi-condition {@link FilterPopup}
   * popover. `trigger` defaults to the filter-icon button (used in the leaf
   * header row and at the right edge of a floating-filter cell); callers can
   * pass their own trigger.
   */
  const renderFilterPopover = (
    column: Column<T, unknown>,
    trigger?: ReactNode,
  ) => {
    const meta = column.columnDef.meta
    const filterType = resolveColumnFilterType(column)
    const filterValue = column.getFilterValue() as
      | ColumnFilterModel
      | undefined
    const isFiltered = filterValue !== undefined
    // Text columns can opt into a combined text + set panel.
    const combined = filterType === 'text' && meta?.filterEnableSet === true
    // Date columns get the Excel-style panel (date tree + relative +
    // conditions).
    const isDate = filterType === 'date'

    return (
      <Popover
        trigger="click"
        placement="bottomRight"
        open={openFilterColumnId === column.id}
        onOpenChange={(open) => setOpenFilterColumnId(open ? column.id : null)}
        getPopupContainer={() => document.body}
        // See renderSetFilterPopover: the panels focus on mount, so the popup
        // must not stay alive between opens.
        destroyOnHidden
        content={
          // Stop clicks inside the popup from bubbling to the <th> sort
          // handler (React events propagate through the portal to the logical
          // parent).
          <div onClick={(e) => e.stopPropagation()}>
            {isDate ? (
              <DateFilterPanel
                dayKeys={getDayKeys(column)}
                value={filterValue}
                maxConditions={meta?.maxFilterConditions}
                onChange={(next) => column.setFilterValue(next)}
                expandedNodes={dateTreeExpanded[column.id] ?? EMPTY_NODE_SET}
                onToggleNode={(key) => toggleDateTreeNode(column.id, key)}
              />
            ) : combined ? (
              <CombinedFilterPanel
                allValues={getSetValues(column)}
                labels={meta?.filterOptions}
                value={filterValue}
                maxConditions={meta?.maxFilterConditions}
                onChange={(next) => column.setFilterValue(next)}
                onCommit={() => setOpenFilterColumnId(null)}
              />
            ) : (
              <FilterPopup
                filterType={filterType}
                value={filterValue}
                maxConditions={meta?.maxFilterConditions}
                onChange={(next) => column.setFilterValue(next)}
              />
            )}
          </div>
        }
      >
        {trigger ?? renderFilterTrigger(isFiltered, floatingCellClasses)}
      </Popover>
    )
  }

  /**
   * A set column's floating cell: the WHOLE cell triggers the
   * {@link SetFilterPanel} popover (search + Select All + checkboxes), with
   * the current selection summarised inside it.
   */
  const renderSetFilterPopover = (column: Column<T, unknown>) => {
    const meta = column.columnDef.meta
    const filterValue = column.getFilterValue() as
      | ColumnFilterModel
      | undefined
    const allValues = getSetValues(column)

    return (
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={openFilterColumnId === column.id}
        onOpenChange={(open) => setOpenFilterColumnId(open ? column.id : null)}
        getPopupContainer={() => document.body}
        // Remount the panel per open: it focuses its search box on mount, and
        // a kept-alive popup would only ever focus the first time.
        destroyOnHidden
        content={
          <div onClick={(e) => e.stopPropagation()}>
            <SetFilterPanel
              allValues={allValues}
              labels={meta?.filterOptions}
              value={filterValue}
              onChange={(next) => column.setFilterValue(next)}
              onCommit={() => setOpenFilterColumnId(null)}
            />
          </div>
        }
      >
        {renderSetFilterCell(column, allValues, floatingCellClasses)}
      </Popover>
    )
  }

  // TanStack returns one header group per depth; the LAST is always the leaf
  // columns, so any rows above it render as colspan bands. The band count
  // drives the sticky-offset CSS var (bands / leaf header / filter row stack).
  const headerGroups = table.getHeaderGroups()
  const leafHeaderGroup = headerGroups[headerGroups.length - 1]
  const groupHeaderRows = headerGroups.slice(0, -1)

  const headerTable = (
    <table
      className={styles.tableElement}
      style={
        {
          '--data-grid-group-header-rows': groupHeaderRows.length,
        } as React.CSSProperties
      }
    >
      {colGroup}
      <thead>
        {/* Grouped-header band rows — plain colspan cells, no
            sort/filter/resize; placeholders render empty. */}
        {groupHeaderRows.map((headerGroup, bandIndex) => (
          <tr key={headerGroup.id} data-role="header-band">
            {headerGroup.headers.map((header) => {
              // TanStack splits a band spanning pinned + unpinned leaves
              // into one cell per pin section; a pinned section's cell
              // sticks at its leaves' offset.
              const bandPinned = getPinnedBandOffsets(header)
              return (
                <th
                  key={header.id}
                  colSpan={header.colSpan}
                  // Placeholders (ungrouped columns passing through the band
                  // level) are empty — hide them from assistive tech so
                  // screen readers don't announce blank column headers.
                  aria-hidden={header.isPlaceholder || undefined}
                  className={`${styles.th} ${styles.groupTh}${
                    bandPinned
                      ? ` ${pinnedCellClassNames(bandPinned, headerPinnedClasses)}`
                      : ''
                  }`}
                  style={{
                    top: `calc(${bandIndex} * var(--data-grid-header-row-height))`,
                    ...pinnedCellStyle(bandPinned),
                  }}
                >
                  <GridHeaderContent header={header} />
                </th>
              )
            })}
            {/* Filler band cell — carries the band across the empty width. */}
            <th
              aria-hidden="true"
              className={`${styles.th} ${styles.groupTh} ${styles.fillerTh}`}
              style={{
                top: `calc(${bandIndex} * var(--data-grid-header-row-height))`,
              }}
            />
          </tr>
        ))}

        {/* Leaf header row */}
        <tr key={leafHeaderGroup.id}>
          {leafHeaderGroup.headers.map((header) => {
            // When floating filters are shown, the popup trigger lives
            // in the floating row instead of the header.
            const showHeaderFilterIcon =
              showColumnFilters &&
              !showFloatingFilters &&
              !header.isPlaceholder &&
              header.column.getCanFilter()
            const pinned = getPinnedOffsets(header.column)
            const reorderable =
              columnReorderEnabled &&
              !header.isPlaceholder &&
              header.column.columnDef.meta?.enableReordering !== false

            return (
              <SortableHeaderCell
                key={header.id}
                reorderable={reorderable}
                header={header}
                resizeGuard={resizeGuard}
                classes={headerCellClasses}
                filterSlot={
                  showHeaderFilterIcon
                    ? renderFilterPopover(header.column)
                    : undefined
                }
                menuSlot={
                  // Control columns (drag grip, actions) opt out of reordering
                  // and have nothing the menu can act on — its button would
                  // also crowd the narrow header.
                  !header.isPlaceholder &&
                  header.column.columnDef.meta?.enableReordering !== false
                    ? renderColumnMenu(header)
                    : undefined
                }
                thClassName={
                  pinned
                    ? pinnedCellClassNames(pinned, headerPinnedClasses)
                    : undefined
                }
                thStyle={pinnedCellStyle(pinned)}
              />
            )
          })}
          {/* Filler header cell — carries the header band across the
              empty width. */}
          <th aria-hidden="true" className={`${styles.th} ${styles.fillerTh}`} />
        </tr>

        {/* Floating filter row — single-condition editor per column,
            reflecting conditions[0] of the same descriptor. */}
        {showFloatingFilters && (
          <tr
            key={`${leafHeaderGroup.id}-floating`}
            data-role="floating-filters"
          >
            {leafHeaderGroup.headers.map((header) => {
              const column = header.column
              const pinned = getPinnedOffsets(column)
              const filterThClassName = `${styles.filterTh}${
                pinned
                  ? ` ${pinnedCellClassNames(pinned, filterPinnedClasses)}`
                  : ''
              }`
              const filterThStyle = pinnedCellStyle(pinned)
              if (header.isPlaceholder || !column.getCanFilter()) {
                return (
                  <th
                    key={`${header.id}-floating`}
                    className={filterThClassName}
                    style={filterThStyle}
                  />
                )
              }

              const colFilterType = resolveColumnFilterType(column)

              return (
                <th
                  key={`${header.id}-floating`}
                  className={filterThClassName}
                  style={filterThStyle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {colFilterType === 'set'
                    ? renderSetFilterPopover(column)
                    : renderFloatingFilterCell({
                        column,
                        filterType: colFilterType,
                        classes: floatingCellClasses,
                        placeholder: column.columnDef.meta?.filterPlaceholder,
                        triggerSlot: renderFilterPopover(column),
                      })}
                </th>
              )
            })}
            {/* Filler cell carries the filter-row band to the edge. */}
            <th
              aria-hidden="true"
              className={`${styles.filterTh} ${styles.fillerTh}`}
            />
          </tr>
        )}
      </thead>
    </table>
  )

  // The column-reorder DnD context is header-scoped and separate from the
  // grid's row context, so column drags and row drags never share sensors or
  // collision detection.
  const headerTableContent = columnReorderEnabled ? (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={onColumnDragEnd}
    >
      <SortableContext
        items={columnSortableIds}
        strategy={horizontalListSortingStrategy}
      >
        {headerTable}
      </SortableContext>
    </DndContext>
  ) : (
    headerTable
  )

  return (
    <div className={styles.headerArea}>
      <div className={styles.headerViewport} ref={headerViewportRef}>
        {headerTableContent}
      </div>
      {/* Spacer above the body's vertical scrollbar — same header band
          styling, sized from the live scrollbar measurement. */}
      <div
        className={styles.headerScrollbarSpacer}
        style={{ width: scrollbarWidth }}
        aria-hidden="true"
      />
    </div>
  )
}
