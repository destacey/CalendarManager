import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRefreshOnShow } from './useRefreshOnShow'

describe('useRefreshOnShow', () => {
  let onRefresh: Mock<() => void>

  beforeEach(() => {
    onRefresh = vi.fn(() => {})
  })

  it('does nothing while the screen is hidden', () => {
    renderHook(() => useRefreshOnShow(false, true, onRefresh))

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does nothing when shown with nothing changed', () => {
    renderHook(() => useRefreshOnShow(true, false, onRefresh))

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('refreshes when shown after something changed', () => {
    renderHook(() => useRefreshOnShow(true, true, onRefresh))

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  /* The point of the whole thing: work done while hidden is picked up on the
     way back, not while nobody is looking. */
  it('waits until the screen becomes visible', () => {
    const { rerender } = renderHook(
      ({ active }) => useRefreshOnShow(active, true, onRefresh),
      { initialProps: { active: false } }
    )
    expect(onRefresh).not.toHaveBeenCalled()

    rerender({ active: true })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  /* Re-rendering for unrelated reasons must not reload the screen again. */
  it('does not refresh again on an unrelated re-render', () => {
    const { rerender } = renderHook(() => useRefreshOnShow(true, true, onRefresh))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    rerender()
    rerender()

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  /* Clearing the flag is what stops the loop; once cleared and set again, a
     later change still refreshes. */
  it('refreshes again after the flag is cleared and set once more', () => {
    const { rerender } = renderHook(
      ({ dirty }) => useRefreshOnShow(true, dirty, onRefresh),
      { initialProps: { dirty: true } }
    )
    expect(onRefresh).toHaveBeenCalledTimes(1)

    rerender({ dirty: false })
    rerender({ dirty: true })

    expect(onRefresh).toHaveBeenCalledTimes(2)
  })
})
