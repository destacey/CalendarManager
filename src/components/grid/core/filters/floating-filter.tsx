'use client'

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { DatePicker, InputNumber, Input } from 'antd'
import { FilterFilled, FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { RowData } from '@tanstack/react-table'

import type { Column } from '../index'
import { caseInsensitiveCompare } from '../grid-sorting'
import styles from './floating-filter.module.css'
import { canFloatingEditDate, describeDateFilter } from './filter-summary'
import { toDayKey } from './filter-engine'
import {
  createEmptyFilterModel,
  defaultOperatorFor,
  operatorNeedsValue,
  SET_FILTER_BLANK,
  SET_FILTER_BLANK_LABEL,
  type ColumnFilterModel,
  type ConditionModel,
  type DateCondition,
  type DateTimeCondition,
  type FilterType,
  type NumberCondition,
  type TextCondition,
} from './filter-model'

const TEXT_DEBOUNCE_MS = 250

export interface FloatingFilterProps {
  /** Condition-based filter type (set columns use SetFilterPanel, not this). */
  filterType: Exclude<FilterType, 'set'>
  /** Current descriptor for the column, or undefined when unfiltered. */
  value: ColumnFilterModel | undefined
  onChange: (next: ColumnFilterModel | undefined) => void
  placeholder?: string
}

/**
 * Compact single-condition filter shown inline under a column header — the
 * counterpart to AG Grid's floating filter, for text/number/date columns. It
 * reads and writes the *first* condition of the column's {@link ColumnFilterModel}
 * descriptor, so it and the full {@link FilterPopup} are two UIs over one model:
 * editing here updates `conditions[0]` while preserving its operator and any
 * further conditions the popup added. (Set columns use {@link SetFilterPanel}.)
 */
const FloatingFilter = ({
  filterType,
  value,
  onChange,
  placeholder,
}: FloatingFilterProps) => {
  return (
    <ConditionFloatingFilter
      filterType={filterType}
      value={value as ConditionModel | undefined}
      onChange={onChange}
      placeholder={placeholder}
    />
  )
}

interface ConditionFloatingFilterProps {
  filterType: ConditionModel['type']
  value: ConditionModel | undefined
  onChange: (next: ColumnFilterModel | undefined) => void
  placeholder?: string
}

/**
 * Writes the first condition of a condition-based descriptor. The operator is
 * taken from the existing descriptor when present, otherwise the type default,
 * so the floating input never clobbers an operator chosen in the popup.
 */
const ConditionFloatingFilter = ({
  filterType,
  value,
  onChange,
  placeholder,
}: ConditionFloatingFilterProps) => {
  // Guard: only a matching condition descriptor has `conditions`. Anything else
  // (e.g. a `set` descriptor on a combined column) is treated as unfiltered here.
  const conditionValue = value?.type === filterType ? value : undefined
  const first = conditionValue?.conditions[0]
  const op = first?.op ?? defaultOperatorFor(filterType)

  /**
   * Emit a new descriptor with `conditions[0]` patched. Passing an empty
   * primary value clears the whole descriptor (unless a valueless operator like
   * blank/notBlank is active, or the popup added extra conditions).
   */
  const emitPrimary = (primary: string | number | null) => {
    const cleared =
      primary === null || primary === '' || primary === undefined
    const extraConditions = conditionValue
      ? conditionValue.conditions.length > 1
      : false
    const valueless = !operatorNeedsValue(op)

    if (cleared && !valueless && !extraConditions) {
      onChange(undefined)
      return
    }

    const base = (conditionValue ??
      createEmptyFilterModel(filterType)) as ConditionModel
    const nextConditions = [...base.conditions]
    nextConditions[0] = { ...nextConditions[0], op, value: primary } as
      | TextCondition
      | NumberCondition
      | DateCondition
      | DateTimeCondition
    onChange({ ...base, conditions: nextConditions } as ColumnFilterModel)
  }

  if (filterType === 'text') {
    return (
      <DebouncedTextInput
        value={(first as TextCondition | undefined)?.value ?? ''}
        placeholder={placeholder}
        onCommit={(v) => emitPrimary(v)}
      />
    )
  }

  if (filterType === 'number') {
    const current = (first as NumberCondition | undefined)?.value ?? null
    return (
      <InputNumber
        size="small"
        className={styles.control}
        placeholder={placeholder}
        value={current}
        onChange={(v) => emitPrimary(v ?? null)}
      />
    )
  }

  // date / dateTime
  const showTime = filterType === 'dateTime'
  const current = (first as DateCondition | DateTimeCondition | undefined)?.value
  const toIso = (d: dayjs.Dayjs | null) =>
    d ? (showTime ? d.toISOString() : d.format('YYYY-MM-DD')) : null

  return (
    <DatePicker
      size="small"
      showTime={showTime}
      className={styles.control}
      placeholder={placeholder}
      value={current ? dayjs(current) : null}
      onChange={(d) => emitPrimary(toIso(d))}
    />
  )
}

interface DebouncedTextInputProps {
  /**
   * External committed value. Also used as the remount key, so a change that
   * did NOT originate from this input's own typing (Clear, a popup edit) resets
   * the field. The input is otherwise uncontrolled — the DOM owns keystrokes.
   */
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}

/**
 * Debounced text input for the floating filter.
 *
 * The input is *uncontrolled* (`defaultValue`, not `value`): the DOM owns the
 * text so every keystroke lands regardless of re-renders, and the debounced
 * descriptor echo can't clobber characters mid-typing — the bug a controlled
 * value caused. External resets (Clear / popup edits) are applied by remounting
 * via `key={value}`, which reseeds `defaultValue`. A ref tracks what we last
 * committed so an external change can be distinguished from our own echo.
 */
const DebouncedTextInput = ({
  value,
  placeholder,
  onCommit,
}: DebouncedTextInputProps) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the value this input itself last committed. When `value` matches it,
  // the incoming prop is our own debounced echo → don't remount (keeps focus &
  // in-flight keystrokes). When it differs, the change came from elsewhere
  // (Clear / popup edit) → remount to reseed defaultValue.
  const [lastCommitted, setLastCommitted] = useState(value)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const commit = (next: string) => {
    setLastCommitted(next)
    onCommit(next)
  }

  const handleChange = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => commit(next), TEXT_DEBOUNCE_MS)
  }

  const remountKey = value === lastCommitted ? 'typing' : value

  return (
    <Input
      key={remountKey}
      size="small"
      allowClear
      className={styles.control}
      placeholder={placeholder}
      defaultValue={value}
      onBlur={(e) => {
        // Flush any pending debounce so a quick type-then-blur isn't lost.
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
          commit(e.target.value)
        }
      }}
      onChange={(e) => handleChange(e.target.value)}
    />
  )
}

export default FloatingFilter

// ─── Floating-filter row cells ───────────────────────────────────────────────
// The cell *contents* of the grid's floating-filter row. The grid owns the
// `<th>`s (keys, pinning) and the filter popovers' open state; these builders
// own what goes inside a cell, so the set/date summary chips and the inline
// editor cannot drift apart in structure.
//
// They are plain element builders rather than components on purpose: the set
// cell is handed straight to an antd `Popover` as its trigger, and antd clones
// the trigger to inject its own `onClick`/ref. A component would have to
// forward those itself; a plain `<div>` element receives them directly.

/** CSS-module classes the grid supplies for a floating-filter cell. */
export interface FloatingFilterCellClasses {
  /** The cell's flex row: editor or summary chip on the left, filter trigger
   *  on the right. */
  cell: string
  /** Read-only summary chip (a set selection, or a date filter the inline
   *  editor cannot faithfully represent). */
  summary: string
  /** The filter-icon trigger. */
  trigger: string
  /** Added to the trigger when the column is filtered. */
  triggerActive: string
}

const triggerClassName = (
  isFiltered: boolean,
  classes: FloatingFilterCellClasses,
): string =>
  `${classes.trigger}${isFiltered ? ` ${classes.triggerActive}` : ''}`

const filterIcon = (isFiltered: boolean): ReactElement =>
  isFiltered ? <FilterFilled /> : <FilterOutlined />

/**
 * All known set values for a column: prefer declared options (stable
 * order/labels), else the distinct values present in the data (faceted).
 * For a multi-value column (`meta.multiValueSplit`), each faceted value is a
 * joined string that's split into its individual tokens first, so the list
 * shows tokens rather than whole combinations. When the data contains blank
 * cells (null/undefined/''), a "(Blanks)" sentinel entry is appended so
 * blanks can be filtered like any value.
 */
export const getSetValues = <T extends RowData,>(
  column: Column<T, unknown>,
): string[] => {
  const meta = column.columnDef.meta
  const facetedKeys = Array.from(column.getFacetedUniqueValues().keys())
  const split = meta?.multiValueSplit
  const hasBlanks = facetedKeys.some(
    (v) =>
      v == null || v === '' || (split ? split(String(v)).length === 0 : false),
  )
  const optionValues = meta?.filterOptions?.map((o) => o.value)
  const nonBlank = facetedKeys.filter((v): v is string => v != null && v !== '')
  const distinct = split
    ? Array.from(new Set(nonBlank.flatMap((v) => split(String(v)))))
    : nonBlank.map(String)
  const values = optionValues ?? distinct.sort(caseInsensitiveCompare)
  return hasBlanks ? [...values, SET_FILTER_BLANK] : values
}

/**
 * Distinct `YYYY-MM-DD` day keys present in a date column, for the date tree.
 * Each faceted value is normalized to its day (dropping time-of-day and raw
 * shape differences) and de-duplicated.
 */
export const getDayKeys = <T extends RowData,>(
  column: Column<T, unknown>,
): string[] => {
  const keys = new Set<string>()
  for (const v of column.getFacetedUniqueValues().keys()) {
    const key = toDayKey(v)
    if (key) keys.add(key)
  }
  return Array.from(keys).sort()
}

/**
 * The set filter's compact summary text: blank when nothing is filtered or
 * everything is selected, the single selection's label when one value is
 * chosen (resolving `meta.filterOptions` labels and the "(Blanks)" sentinel),
 * otherwise a count.
 */
const setFilterSummary = <T extends RowData,>(
  column: Column<T, unknown>,
  allValues: string[],
): string => {
  const meta = column.columnDef.meta
  const filterValue = column.getFilterValue() as ColumnFilterModel | undefined
  const selected =
    filterValue?.type === 'set' ? filterValue.values : allValues

  if (filterValue === undefined || selected.length === allValues.length) {
    return ''
  }
  if (selected.length !== 1) return `${selected.length} selected`
  if (selected[0] === SET_FILTER_BLANK) return SET_FILTER_BLANK_LABEL
  return (
    meta?.filterOptions?.find((o) => o.value === selected[0])?.label ??
    selected[0]
  )
}

/**
 * The filter-icon element the grid wraps in its filter popover, for the leaf
 * header row and the right edge of a floating-filter cell. Clicks and
 * pointer-downs stop propagating: the `<th>` is both a sort target and a
 * column-reorder drag handle, so neither must fire from the icon.
 */
export const renderFilterTrigger = (
  isFiltered: boolean,
  classes: FloatingFilterCellClasses,
): ReactElement => (
  <span
    role="button"
    aria-label={isFiltered ? 'Edit column filter (active)' : 'Filter column'}
    className={triggerClassName(isFiltered, classes)}
    onClick={(e) => e.stopPropagation()}
    onPointerDown={(e) => e.stopPropagation()}
  >
    {filterIcon(isFiltered)}
  </span>
)

/**
 * A set column's floating cell: the selection summary plus a filter icon. The
 * WHOLE cell is the popover trigger (the grid wraps this element in the
 * popover that hosts the set panel), so the icon here carries no handlers of
 * its own.
 */
export const renderSetFilterCell = <T extends RowData,>(
  column: Column<T, unknown>,
  allValues: string[],
  classes: FloatingFilterCellClasses,
): ReactElement => {
  const isFiltered = column.getFilterValue() !== undefined
  return (
    <div
      role="button"
      aria-label={isFiltered ? 'Filter column (active)' : 'Filter column'}
      className={classes.cell}
    >
      <span className={classes.summary}>
        {setFilterSummary(column, allValues)}
      </span>
      <span className={triggerClassName(isFiltered, classes)}>
        {filterIcon(isFiltered)}
      </span>
    </div>
  )
}

export interface FloatingFilterCellOptions<T extends RowData> {
  column: Column<T, unknown>
  /** The column's resolved filter type (set columns use
   *  {@link renderSetFilterCell} instead). */
  filterType: Exclude<FilterType, 'set'>
  classes: FloatingFilterCellClasses
  placeholder?: string
  /** The grid's filter-popover trigger, always the cell's right-hand child. */
  triggerSlot: ReactNode
}

/**
 * A condition column's floating cell.
 *
 * The floating `DatePicker` can faithfully edit only a simple equals; any
 * richer date filter shows a read-only summary chip instead. The cell
 * structure stays identical in both states — left child input ⇄ chip, right
 * child ALWAYS the same popover trigger — so the open popover's anchor is
 * never replaced (antd reads a replaced anchor as a click-outside, which made
 * the popover flicker shut the moment the filter activated).
 */
export const renderFloatingFilterCell = <T extends RowData,>({
  column,
  filterType,
  classes,
  placeholder,
  triggerSlot,
}: FloatingFilterCellOptions<T>): ReactElement => {
  const filterValue = column.getFilterValue() as ColumnFilterModel | undefined
  const showDateSummary =
    filterType === 'date' && !canFloatingEditDate(filterValue)

  return (
    <div className={classes.cell}>
      {showDateSummary ? (
        <span
          className={classes.summary}
          title={describeDateFilter(filterValue)}
        >
          {describeDateFilter(filterValue)}
        </span>
      ) : (
        <FloatingFilter
          filterType={filterType}
          // Only reflect a matching condition descriptor. On a combined
          // column, a `set` descriptor leaves the floating input empty (AG
          // Grid behavior).
          value={filterValue?.type === filterType ? filterValue : undefined}
          placeholder={placeholder}
          onChange={(next) => column.setFilterValue(next)}
        />
      )}
      {triggerSlot}
    </div>
  )
}
