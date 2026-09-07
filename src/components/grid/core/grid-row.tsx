'use client'

import type { Cell, Row } from './index'
import { flexRender } from '@tanstack/react-table'
import { GridSortableRow } from './dnd/grid-dnd'
import {
  getPinnedOffsets,
  pinnedCellClassNames,
  pinnedCellStyle,
  type PinnedCellClasses,
} from './column-pinning'
import type { RowData } from '@tanstack/react-table'

/**
 * CSS-module class names the owning grid supplies for body rows, so the shared
 * markup picks up the grid's own zebra/cell styling. The pinned set is
 * optional — a grid without column pinning just omits it.
 */
export interface GridRowClasses {
  tr: string
  trAlt: string
  td: string
  /** Applied to `td`s of numeric columns (right-aligned cells; headers are
   *  unaffected — alignment is a body-cell concern only). */
  tdNumeric?: string
  /** Sticky/edge classes for pinned columns' `td`s. */
  pinned?: PinnedCellClasses
  /** Applied to a row that can be activated (pointer affordance). */
  trActivatable?: string
  /**
   * Applied to the currently activated row. Distinct from `trSelected`, which
   * marks the row being inline-edited and deliberately reads as *unstyled* —
   * this one is a highlight.
   */
  trActivated?: string
}

/** The pinned class suffix (starting with a space) + inline style for a body
 *  cell, or empties when the column is unpinned / pinning classes not given. */
const pinnedTdProps = <T extends RowData,>(
  cell: Cell<T, unknown>,
  classes: GridRowClasses,
): { className: string; style?: React.CSSProperties } => {
  if (!classes.pinned) return { className: '' }
  const offsets = getPinnedOffsets(cell.column)
  if (!offsets) return { className: '' }
  return {
    className: ` ${pinnedCellClassNames(offsets, classes.pinned)}`,
    style: pinnedCellStyle(offsets),
  }
}

/** The numeric-alignment class suffix (starting with a space) for a body
 *  cell, or '' when the column isn't numeric / no class was supplied. */
const numericTdClass = <T extends RowData,>(
  cell: Cell<T, unknown>,
  classes: GridRowClasses,
  numericColumnIds: ReadonlySet<string> | undefined,
): string =>
  classes.tdNumeric && numericColumnIds?.has(cell.column.id)
    ? ` ${classes.tdNumeric}`
    : ''

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, [role="button"], [data-row-activate="ignore"]'

/**
 * True when the event landed on something inside the row that handles its own
 * activation — a link, a button, an input, or anything that opted out with
 * `data-row-activate="ignore"`.
 *
 * Without this a row-activating grid steals every click from the cells inside
 * it: the actions dropdown would open the panel behind itself, and a link cell
 * would both navigate and activate.
 *
 * The search is bounded by `currentTarget` — the row itself carries
 * `role="button"`, so an unbounded `closest` would match the row for every
 * click inside it and nothing would ever activate.
 */
const isInteractiveTarget = (
  target: EventTarget | null,
  row: EventTarget & Element,
): boolean => {
  if (!(target instanceof Element)) return false
  const hit = target.closest(INTERACTIVE_SELECTOR)
  return !!hit && hit !== row && row.contains(hit)
}

/**
 * The zebra + activation class string for a flat body row. Shared by both flat
 * forms so the plain and sortable rows never drift apart.
 */
const flatRowClassName = (
  classes: GridRowClasses,
  index: number,
  { onActivate, isActivated }: RowActivationProps,
): string =>
  `${classes.tr}` +
  `${index % 2 === 1 ? ` ${classes.trAlt}` : ''}` +
  `${onActivate && classes.trActivatable ? ` ${classes.trActivatable}` : ''}` +
  `${isActivated && classes.trActivated ? ` ${classes.trActivated}` : ''}`

/** Row props shared by every activatable row form. */
export interface RowActivationProps {
  /**
   * Called when the row is activated — clicked, or Enter/Space with the row
   * focused. Supplying it makes the row a focusable `role="button"`.
   */
  onActivate?: () => void
  /** Whether this row is the activated one (drives the highlight). */
  isActivated?: boolean
  /** Accessible name for the row's button role, e.g. the record's name. */
  activateLabel?: string
}

/**
 * The DOM props that turn a `<tr>` into an activatable, keyboard-reachable
 * button — or nothing at all when the grid has no `onRowActivate`. A row that
 * cannot be activated must not announce itself as a button or take tab focus.
 */
const activationProps = ({
  onActivate,
  activateLabel,
}: RowActivationProps): React.HTMLAttributes<HTMLTableRowElement> => {
  if (!onActivate) return {}
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': activateLabel,
    onClick: (e) => {
      if (isInteractiveTarget(e.target, e.currentTarget)) return
      onActivate()
    },
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (isInteractiveTarget(e.target, e.currentTarget)) return
      // Space scrolls the page and Enter can submit a surrounding form.
      e.preventDefault()
      onActivate()
    },
  }
}

export interface FlatGridRowProps<T extends RowData> extends RowActivationProps {
  row: Row<T>
  /** Display index within the rendered row list (drives zebra striping). */
  index: number
  classes: GridRowClasses
  /** Column ids whose cells right-align (numeric columns); resolved once at
   *  the grid level — see the grid's numericColumnIds. */
  numericColumnIds?: ReadonlySet<string>
}

/**
 * The row-renderer: a plain `<tr>` of the row's visible cells plus the
 * trailing filler cell that keeps the zebra/hover band edge-to-edge.
 *
 * This grid has no row-selection or tree/expand feature registered
 * (`rowSelectionFeature`/`rowExpandingFeature` are deliberately absent from
 * `grid-features.ts`), so there is no selection checkbox to render and no
 * indentation/expander branch — a single flat form covers every row.
 *
 * Safe to memoize: v9 hands back a new `table` reference on every state
 * change (and new row objects for rows that actually changed), so compiler
 * memoization invalidates correctly.
 */
export function FlatGridRow<T extends RowData>({
  row,
  index,
  classes,
  numericColumnIds,
  onActivate,
  isActivated,
  activateLabel,
}: FlatGridRowProps<T>) {
  return (
    <tr
      className={flatRowClassName(classes, index, {
        onActivate,
        isActivated,
      })}
      {...activationProps({ onActivate, activateLabel })}
    >
      {row.getVisibleCells().map((cell) => {
        const pinned = pinnedTdProps(cell, classes)
        return (
          <td
            key={cell.id}
            data-column-id={cell.column.id}
            className={`${classes.td}${numericTdClass(cell, classes, numericColumnIds)}${pinned.className}`}
            style={pinned.style}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        )
      })}
      {/* Filler data cell keeps the zebra/hover band edge-to-edge. */}
      <td aria-hidden="true" className={classes.td} />
    </tr>
  )
}

export interface SortableFlatGridRowProps<T extends RowData>
  extends FlatGridRowProps<T> {
  /** The row's data id (not TanStack's row.id) — the dnd-kit sortable id. */
  nodeId: string
  /** Whether this row is currently being dragged. */
  isDragging: boolean
  /** Whether DnD is enabled for this row. */
  isDragEnabled: boolean
}

/**
 * The flat form wrapped in the dnd-kit sortable row ({@link GridSortableRow})
 * for row-reorder DnD. Rendered (with dragging possibly disabled) for every
 * row whenever the grid has `onRowReorder`, so drag-handle cells can always
 * reach the `useGridDragHandle` context.
 */
export function SortableFlatGridRow<T extends RowData>({
  row,
  index,
  classes,
  numericColumnIds,
  nodeId,
  isDragging,
  isDragEnabled,
  onActivate,
  isActivated,
  activateLabel,
}: SortableFlatGridRowProps<T>) {
  return (
    <GridSortableRow
      nodeId={nodeId}
      isDragEnabled={isDragEnabled}
      isDragging={isDragging}
      className={flatRowClassName(classes, index, {
        onActivate,
        isActivated,
      })}
      {...activationProps({ onActivate, activateLabel })}
    >
      {row.getVisibleCells().map((cell) => {
        const pinned = pinnedTdProps(cell, classes)
        return (
          <td
            key={cell.id}
            data-column-id={cell.column.id}
            className={`${classes.td}${numericTdClass(cell, classes, numericColumnIds)}${pinned.className}`}
            style={pinned.style}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        )
      })}
      {/* Filler data cell keeps the zebra/hover band edge-to-edge. */}
      <td aria-hidden="true" className={classes.td} />
    </GridSortableRow>
  )
}
