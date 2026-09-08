// virtual-geometry.ts — the spacer heights for the row virtualizer's
// unrendered rows above and below the mounted window.
//
// Only the visible window of rows (plus overscan) is mounted; the rows above
// and below it are represented by two spacer <tr>s rather than being
// rendered, so the table's scrollable content height matches what the
// virtualizer reports.

export interface VirtualSpacerInput {
  /** Offset of the first rendered row. */
  firstRowStart: number
  /** End of the last rendered row. */
  lastRowEnd: number
  /** Total content size the virtualizer reports. */
  totalSize: number
  /** False when no rows are rendered (empty grid). */
  hasRows: boolean
}

/**
 * Heights for the spacer rows that stand in for unrendered rows above and
 * below the window.
 */
export function virtualSpacers(input: VirtualSpacerInput): {
  top: number
  bottom: number
} {
  if (!input.hasRows) return { top: 0, bottom: 0 }
  return {
    top: input.firstRowStart,
    bottom: input.totalSize - input.lastRowEnd,
  }
}
