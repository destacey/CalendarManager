'use client'

import { useCallback } from 'react'
import type { DragEndEvent, Modifier } from '@dnd-kit/core'
import type { RowData } from '@tanstack/react-table'

import type { ColumnOrderState, ColumnPinningState, Table } from './index'
import { reorderIds } from './column-order'

/** Column-reorder drags move along the header row only — lock the y axis.
 *  (Inlined rather than pulling in @dnd-kit/modifiers for one function.) */
export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
})

export interface UseColumnReorderOptions<T extends RowData> {
  table: Table<T>
  /** The order currently fed to TanStack (the user's order reconciled against
   *  the live defs) — the seed for a first-ever center-section reorder. */
  effectiveColumnOrder: ColumnOrderState
  setColumnOrder: React.Dispatch<React.SetStateAction<ColumnOrderState>>
  setColumnPinning: React.Dispatch<React.SetStateAction<ColumnPinningState>>
}

export interface UseColumnReorderResult {
  /**
   * Moves `activeId` to `overId`'s position. Shared by the header-grip drag
   * and the Choose Columns list, so both obey the same section rules.
   */
  moveColumn: (activeId: string, overId: string) => void
  /** dnd-kit `onDragEnd` for the header's column-reorder context. */
  handleColumnDragEnd: (event: DragEndEvent) => void
}

/**
 * Header column-reorder drag-and-drop.
 *
 * Reorders WITHIN the active column's section only: the center section via
 * `columnOrder`, each pinned side via its `columnPinning` array (TanStack
 * orders pinned sections by the pin array, ignoring `columnOrder`). A
 * cross-section move, a no-op, or a move touching a non-reorderable column is
 * ignored — dragging never pins or unpins, which stays the column menu's job.
 */
export function useColumnReorder<T extends RowData>({
  table,
  effectiveColumnOrder,
  setColumnOrder,
  setColumnPinning,
}: UseColumnReorderOptions<T>): UseColumnReorderResult {
  const moveColumn = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return

      const activeColumn = table.getColumn(activeId)
      const overColumn = table.getColumn(overId)
      if (
        activeColumn?.columnDef.meta?.enableReordering === false ||
        overColumn?.columnDef.meta?.enableReordering === false
      ) {
        return
      }

      const activeSide = activeColumn?.getIsPinned() ?? false
      const overSide = overColumn?.getIsPinned() ?? false
      if (activeSide !== overSide) return

      if (activeSide === false) {
        // Center: reorder within the full columnOrder (pinned ids ride along
        // inertly). Seed from the reconciled order so a first-ever reorder
        // persists a complete, self-consistent order.
        setColumnOrder(reorderIds(effectiveColumnOrder, activeId, overId))
        return
      }

      // Pinned: reorder that side's pin array.
      setColumnPinning((prev) => {
        const side = prev[activeSide] ?? []
        const next = reorderIds(side, activeId, overId)
        if (next === side) return prev
        return { ...prev, [activeSide]: next }
      })
    },
    [table, effectiveColumnOrder, setColumnOrder, setColumnPinning],
  )

  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      // Sortable ids are namespaced `col:<id>` so a shared context could tell
      // column drags from row drags; strip it back to the column id.
      moveColumn(
        String(active.id).replace(/^col:/, ''),
        String(over.id).replace(/^col:/, ''),
      )
    },
    [moveColumn],
  )

  return { moveColumn, handleColumnDragEnd }
}
