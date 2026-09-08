'use client'

import {
  forwardRef,
  type Ref,
  type ReactElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RowData } from '@tanstack/react-table'
import {
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import type { Header, Row, Table } from './core'
import {
  ColumnChooserModal,
  ColumnMenuTrigger,
  GridFooterRow,
  GridToolbar,
  computeAutosizeWidth,
  dataGridColumnFilter,
  exportGridToCsv,
  getColumnChooserOptions,
  hasVisibleFooter,
  measureColumnContent,
  sortEmptyLast,
  useGridColumnStatePersistence,
  useGridDndSensors,
  useGridState,
  useGridTable,
  type GridFooterRowClasses,
  type PinnedCellClasses,
} from './core'
import { getOrderedVisibleLeafColumns } from './core/column-order'
import { resolveNumericColumnIds, useGridColumns } from './core/use-grid-columns'
import { useColumnReorder } from './core/use-column-reorder'
import DataGridBody, { ROW_HEIGHT_ESTIMATE } from './DataGridBody'
import DataGridHeader from './DataGridHeader'
import { useRemainingHeight } from '../../hooks/useRemainingHeight'
import { useMessage } from '../../contexts/MessageContext'
import styles from './DataGrid.module.css'
import type { DataGridHandle, DataGridProps, GridColumnContext } from './types'

/** Stable fallback for undefined data, so the table's data identity doesn't
 *  churn while a loading grid re-renders. */
const EMPTY_DATA: never[] = []

/** Column-header row height, for sizing a `variant="simple"` grid to its rows. */
const SIMPLE_HEADER_HEIGHT = 39

// Pinned footer cell needs no separate opaque-background override — see the
// stylesheet comment on .tdFooter/.tdFooterPinned.
const footerPinnedClasses: PinnedCellClasses = {
  pinned: styles.tdFooterPinned,
  pinnedLeftEdge: styles.pinnedLeftEdge,
  pinnedRightEdge: styles.pinnedRightEdge,
}

const footerRowClasses: GridFooterRowClasses = {
  td: `${styles.td} ${styles.tdFooter}`,
  tdNumeric: styles.tdNumeric,
  pinned: footerPinnedClasses,
}

function DataGridInner<T extends RowData>(
  props: DataGridProps<T>,
  ref: Ref<DataGridHandle<T>>,
) {
  const {
    data: dataProp,
    columns: columnsProp,
    isLoading = false,
    onRefresh,
    leftSlot,
    helpContent,
    actionsSlot,
    rightSlot,
    emptyMessage = 'No records found',
    csvFileName,
    includeIdColumn = true,
    height,
    initialSorting,
    variant = 'advanced',
    includeGlobalSearch = variant === 'advanced',
    includeExportButton = variant === 'advanced',
    includeColumnFilters = variant === 'advanced',
    includeFloatingFilters = variant === 'advanced',
    getRowId,
    persistStateKey,
    onDisplayedRowsChange,
    onRowActivate,
    activatedRowId,
    getRowActivateLabel,
    onRowReorder,
  } = props

  // Undefined data (a query still loading) renders as an empty grid — the
  // TanStack row model throws on undefined.
  const data = dataProp ?? (EMPTY_DATA as T[])

  const messageApi = useMessage()

  // ─── Auto-height ─────────────────────────────────────────
  const [gridContainerRef, autoHeight] = useRemainingHeight()
  // A simple grid sits inside a section, so it fits its rows rather than
  // filling the remaining viewport — otherwise a four-row table runs to the
  // bottom of the page with empty space under it.
  const isSimple = variant === 'simple'

  // ─── Split header/body/footer viewports ──────────────────
  // The header (and, when present, the footer) lives in its own clipped
  // viewport outside the scrolling body, so the vertical scrollbar spans only
  // the rows (ag-grid style). The body's horizontal scroll is mirrored into
  // both, and a spacer as wide as the body's vertical scrollbar keeps every
  // viewport's columns aligned.
  const headerViewportRef = useRef<HTMLDivElement>(null)
  const bodyViewportRef = useRef<HTMLDivElement>(null)
  const footerViewportRef = useRef<HTMLDivElement>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerViewportRef.current) {
      headerViewportRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
    if (footerViewportRef.current) {
      footerViewportRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  useLayoutEffect(() => {
    // Measure the body scroller's vertical scrollbar width so the header
    // spacer keeps header/body columns aligned.
    const el = bodyViewportRef.current
    if (!el) return
    // offsetWidth - clientWidth = the vertical scrollbar's width (0 for
    // overlay scrollbars or when rows don't overflow). The ResizeObserver
    // re-measures when the scrollbar appears/disappears — that changes the
    // element's content box.
    const measure = () => setScrollbarWidth(el.offsetWidth - el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ─── State ───────────────────────────────────────────────
  const gridState = useGridState({ initialSorting })
  useGridColumnStatePersistence(gridState, persistStateKey)
  const {
    searchValue,
    onSearchChange,
    onClearFilters,
    hasActiveFilters,
    setColumnSizing,
    userColumnVisibility,
    setUserColumnVisibility,
    columnOrder,
    setColumnOrder,
    setColumnPinning,
    resetColumnState,
  } = gridState
  // One open column menu at a time, owned here (the same anchor-stability
  // pattern the header's filter popovers use — a controlled dropdown must keep
  // its trigger DOM).
  const [openMenuColumnId, setOpenMenuColumnId] = useState<string | null>(null)
  // Choose Columns modal — one per grid, opened from any column's menu.
  const [isColumnChooserOpen, setIsColumnChooserOpen] = useState(false)
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // ─── Column context ──────────────────────────────────────
  // Row drag-and-drop is on exactly when the consumer supplied onRowReorder,
  // and dragging is live only while the displayed order IS the data order:
  // useGridState's hasActiveFilters covers the global search, every column
  // filter, AND active sorting, so a drag can never reorder against an order
  // the user cannot see.
  const dndEnabled = !!onRowReorder
  const isDragEnabled = dndEnabled && !isLoading && !hasActiveFilters

  const columnContext: GridColumnContext = useMemo(
    () => ({ isDragEnabled }),
    [isDragEnabled],
  )

  // ─── Resolved columns ───────────────────────────────────
  const {
    resolvedColumns,
    columnVisibility,
    effectiveColumnOrder,
    columnReorderEnabled,
  } = useGridColumns({
    columns: columnsProp,
    columnContext,
    data,
    includeIdColumn,
    userColumnVisibility,
    columnOrder,
  })

  // ─── Row-reorder DnD ─────────────────────────────────────
  const sensors = useGridDndSensors()

  /** Stable sortable id for a row: getRowId → row.original.id → row.id. */
  const flatRowId = useCallback(
    (row: Row<T>): string => {
      if (getRowId) return getRowId(row.original)
      const id = (row.original as { id?: string | number }).id
      return id != null ? String(id) : row.id
    },
    [getRowId],
  )

  // The live table, so the drop handler can read the CURRENT displayed rows
  // without depending on `table`: useTable returns a new object on every
  // render, so that dependency would rebuild the handler every render.
  const tableRef = useRef<Table<T> | null>(null)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggedNodeId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setDraggedNodeId(null)

      if (!over || !onRowReorder || active.id === over.id) return

      const displayed = (tableRef.current?.getRowModel().rows ?? []) as Row<T>[]
      const fromIndex = displayed.findIndex((r) => flatRowId(r) === active.id)
      const toIndex = displayed.findIndex((r) => flatRowId(r) === over.id)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

      // Fire-and-forget: reorder consumers own their error handling (they
      // revert by refetching).
      void onRowReorder({
        orderedData: arrayMove(
          displayed.map((r) => r.original),
          fromIndex,
          toIndex,
        ),
        activeId: String(active.id),
        fromIndex,
        toIndex,
      })
    },
    [flatRowId, onRowReorder],
  )

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setDraggedNodeId(null)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [])

  // ─── TanStack table ─────────────────────────────────────
  const table = useGridTable({
    data,
    columns: resolvedColumns,
    tableOptions: {
      defaultColumn: {
        filterFn: dataGridColumnFilter,
        sortFn: sortEmptyLast,
      },
      ...(getRowId ? { getRowId: (row: T) => getRowId(row) } : {}),
    },
    gridState,
    extraState: {
      columnVisibility,
      columnOrder: effectiveColumnOrder,
    },
  })

  tableRef.current = table

  useImperativeHandle(ref, () => ({
    table,
    getDisplayedRows: () =>
      table.getRowModel().rows.map((row: Row<T>) => row.original),
  }))

  const { moveColumn, handleColumnDragEnd } = useColumnReorder({
    table,
    effectiveColumnOrder,
    setColumnOrder,
    setColumnPinning,
  })

  const rows = table.getRowModel().rows

  // Displayed-rows callback. `rows` is NOT a reliable "the displayed set
  // changed" signal: TanStack rebuilds the row model (a new `rows` array)
  // whenever the table's options change identity, and that includes the
  // `columns` array — so a consumer who (reasonably) constructs its columns
  // inline gets a new `rows` identity, and thus a fresh call here, on every
  // render, even though the actual set of displayed rows is unchanged. If
  // that call drives a `setState`, the result is a render loop. The row
  // *objects* inside `rows` are still stable references to the underlying
  // data even when the array wrapping them is new, so comparing the previous
  // emission against the current one element-by-element (not just by array
  // identity) tells us whether anything actually changed, and lets the grid
  // guarantee this prop only fires when the displayed set genuinely does.
  const lastEmittedRef = useRef<Row<T>[] | null>(null)
  useEffect(() => {
    const last = lastEmittedRef.current
    const unchanged =
      last !== null &&
      last.length === rows.length &&
      last.every((row, index) => row === rows[index])
    if (unchanged) return
    lastEmittedRef.current = rows
    onDisplayedRowsChange?.(rows.map((row) => row.original))
  }, [rows, onDisplayedRowsChange])
  const displayedRowCount = rows.length
  const totalRowCount = data.length
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const numericColumnIds = resolveNumericColumnIds(table)

  // ─── Column menu (sort / pin / autosize / choose / reset) ──
  /**
   * Sizes columns to their rendered content (header label + the virtualized
   * window's cells — all the DOM that exists; ag-grid measured the same way).
   * Applies through columnSizing so the shared colgroup updates both tables.
   */
  const autosizeColumns = useCallback(
    (columnIds: string[]) => {
      const headerRoot = headerViewportRef.current
      const bodyRoot = bodyViewportRef.current
      if (!headerRoot || !bodyRoot) return
      const measured = measureColumnContent(headerRoot, bodyRoot, columnIds)
      setColumnSizing((prev) => {
        const next = { ...prev }
        for (const [id, m] of measured) {
          const columnDef = table.getColumn(id)?.columnDef
          next[id] = computeAutosizeWidth({
            maxCellContentWidth: m.maxCellContentWidth,
            headerContentWidth: m.headerContentWidth,
            minWidth: columnDef?.minSize,
            maxWidth: columnDef?.maxSize,
          })
        }
        return next
      })
    },
    [setColumnSizing, table],
  )

  const autosizeAllColumns = useCallback(() => {
    autosizeColumns(
      getOrderedVisibleLeafColumns(table)
        .filter((column) => column.getCanResize())
        .map((column) => column.id),
    )
  }, [autosizeColumns, table])

  const handleUserToggleColumn = useCallback(
    (columnId: string, visible: boolean) => {
      setUserColumnVisibility((prev) => ({ ...prev, [columnId]: visible }))
    },
    [setUserColumnVisibility],
  )

  // Computed once per grid render and shared by every header's menu trigger
  // (each trigger deriving it would rescan all leaf columns per column).
  const hasHidableColumns = getColumnChooserOptions(table).length > 0

  const renderColumnMenu = (header: Header<T, unknown>) => (
    <ColumnMenuTrigger
      header={header}
      table={table}
      open={openMenuColumnId === header.column.id}
      onOpenChange={(open) =>
        setOpenMenuColumnId(open ? header.column.id : null)
      }
      hasHidableColumns={hasHidableColumns}
      onOpenColumnChooser={() => setIsColumnChooserOpen(true)}
      onAutosizeColumn={(columnId) => autosizeColumns([columnId])}
      onAutosizeAllColumns={autosizeAllColumns}
      onResetColumns={resetColumnState}
    />
  )

  // ─── CSV export ──────────────────────────────────────────
  /**
   * Runs the export and reports only what actually happened.
   *
   * `exportGridToCsv` opens a native save dialog, so it is async and has three
   * outcomes, each needing its own handling:
   *  - it resolves `true` — the file was written;
   *  - it resolves `false` — the user cancelled the dialog, a normal outcome
   *    that must be reported as neither a success nor a failure;
   *  - it REJECTS — a real write failure (e.g. a permission error from
   *    `writeFile`). Neither `saveFile` nor `exportGridToCsv` catches that, so
   *    treating the boolean as the only outcome would leave an unhandled
   *    rejection.
   *
   * The in-flight flag guards re-entry: the toolbar button is disabled while
   * it is set, and this early return covers the gap before that render lands.
   */
  const handleExportCsv = useCallback(async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const saved = await exportGridToCsv(table, csvFileName ?? 'export')
      if (saved) messageApi.success('Exported to CSV')
    } catch (error) {
      console.error('CSV export failed:', error)
      messageApi.error('Could not save the export')
    } finally {
      setIsExporting(false)
    }
  }, [csvFileName, isExporting, messageApi, table])

  // ─── Render ──────────────────────────────────────────────
  // Visible leaf columns in RENDER order: left-pinned → center → right-pinned
  // (center honours columnOrder). getHeaderGroups() and row.getVisibleCells()
  // emit this order, but plain getVisibleLeafColumns() stays in def order —
  // the colgroup must follow the rendered order or the shared <col> widths
  // would apply to the wrong columns.
  const orderedVisibleLeafColumns = getOrderedVisibleLeafColumns(table)

  // Whether any visible leaf column declares a ColumnDef.footer — gates both
  // whether the footer's viewport mounts at all and (below) whether a
  // variant="simple" grid's fixed height leaves room for it.
  const showFooter = hasVisibleFooter(table)

  // Sized from `data` rather than the table's row model built above: filtering
  // is off for a simple grid, so no row is ever hidden and the two counts
  // agree. Computed here (rather than up with the other auto-height state) so
  // it can account for the footer row, which depends on `table`/`showFooter`.
  const simpleHeight =
    SIMPLE_HEADER_HEIGHT +
    (data?.length ?? 0) * ROW_HEIGHT_ESTIMATE +
    (showFooter ? ROW_HEIGHT_ESTIMATE + 1 : 0) +
    2
  const resolvedHeight = height ?? (isSimple ? simpleHeight : autoHeight)

  // Sortable ids for the header row's SortableContext, namespaced `col:` (the
  // same ids the header cells' useSortable use). In display order so dnd-kit's
  // index math lines up with what the user sees.
  const columnSortableIds = orderedVisibleLeafColumns.map(
    (column) => `col:${column.id}`,
  )

  // Rendered into BOTH tables (header + body) — with table-layout: fixed,
  // identical colgroups guarantee the two tables' columns align exactly.
  const colGroup = (
    <colgroup>
      {orderedVisibleLeafColumns.map((column) => (
        <col key={column.id} width={column.getSize()} />
      ))}
      {/* Filler column absorbs leftover width so the table fills the
          viewport (header band + borders edge-to-edge) without widening
          the real columns. */}
      <col className={styles.fillerCol} />
    </colgroup>
  )

  const tableContent = (
    <div className={styles.tableArea}>
      <DataGridHeader
        table={table}
        colGroup={colGroup}
        columnSortableIds={columnSortableIds}
        headerViewportRef={headerViewportRef}
        scrollbarWidth={scrollbarWidth}
        includeColumnFilters={includeColumnFilters}
        includeFloatingFilters={includeFloatingFilters}
        columnReorderEnabled={columnReorderEnabled}
        sensors={sensors}
        onColumnDragEnd={handleColumnDragEnd}
        renderColumnMenu={renderColumnMenu}
      />
      <DataGridBody
        rows={rows}
        bodyViewportRef={bodyViewportRef}
        onBodyScroll={handleBodyScroll}
        colGroup={colGroup}
        isLoading={isLoading}
        emptyMessage={emptyMessage}
        visibleColumnCount={visibleColumnCount}
        numericColumnIds={numericColumnIds}
        flatDndEnabled={dndEnabled}
        isDragEnabled={isDragEnabled}
        draggedNodeId={draggedNodeId}
        flatRowId={flatRowId}
        onRowActivate={onRowActivate}
        activatedRowId={activatedRowId}
        getRowActivateLabel={getRowActivateLabel}
      />
      {showFooter && (
        <div className={styles.footerArea}>
          <div className={styles.footerViewport} ref={footerViewportRef}>
            <table className={styles.tableElement}>
              {colGroup}
              <GridFooterRow
                table={table}
                classes={footerRowClasses}
                numericColumnIds={numericColumnIds}
              />
            </table>
          </div>
          {/* Sits above the body's vertical scrollbar, same as the header's
              spacer, so footer and body columns stay aligned. */}
          <div
            className={styles.headerScrollbarSpacer}
            style={{ width: scrollbarWidth }}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={gridContainerRef}
      className={styles.grid}
      style={{ height: resolvedHeight }}
    >
      {/* A simple grid has a section heading above it already saying what it
          is, so a toolbar — including its row count — would repeat that and
          compete with the page's own chrome. */}
      {!isSimple && (
        <GridToolbar
          displayedRowCount={displayedRowCount}
          totalRowCount={totalRowCount}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onRefresh={onRefresh}
          onClearFilters={onClearFilters}
          hasActiveFilters={hasActiveFilters}
          onExportCsv={includeExportButton ? handleExportCsv : undefined}
          // The toolbar's isLoading gates the export button and nothing else,
          // so an in-flight export disables it the same way a loading grid
          // does — without which a second click before the save dialog
          // resolves would start a second concurrent write.
          isLoading={isLoading || isExporting}
          includeGlobalSearch={includeGlobalSearch}
          leftSlot={leftSlot}
          helpContent={helpContent}
          actionsSlot={actionsSlot}
          rightSlot={rightSlot}
        />
      )}

      {dndEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={rows.map((row) => flatRowId(row))}
            strategy={verticalListSortingStrategy}
          >
            {tableContent}
          </SortableContext>
        </DndContext>
      ) : (
        tableContent
      )}

      <ColumnChooserModal
        table={table}
        open={isColumnChooserOpen}
        onClose={() => setIsColumnChooserOpen(false)}
        onToggleColumn={handleUserToggleColumn}
        reorderEnabled={columnReorderEnabled}
        onReorderColumn={moveColumn}
      />
    </div>
  )
}

/**
 * The app's data grid, assembled from the shared grid core (toolbar, header
 * cells, row renderer, table/state hooks, descriptor filter engine, CSV
 * export). Flat rows only — this grid registers neither row expanding nor row
 * selection (see `core/grid-features.ts`), so there is no tree mode, no
 * selection column, and no inline editing.
 *
 * Rows are always virtualized (ag-grid style): only the visible window plus
 * overscan is mounted — see {@link DataGridBody}. Row-reorder drag-and-drop
 * turns on when `onRowReorder` is supplied.
 */
const DataGrid = forwardRef(DataGridInner) as <T extends RowData>(
  props: DataGridProps<T> & { ref?: Ref<DataGridHandle<T>> },
) => ReactElement | null

export default DataGrid
