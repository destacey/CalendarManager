import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRemainingHeight } from './useRemainingHeight'

describe('useRemainingHeight', () => {
  beforeEach(() => {
    window.innerHeight = 900
  })

  it('starts at a usable default before any element is attached', () => {
    const { result } = renderHook(() => useRemainingHeight())
    expect(result.current[1]).toBeGreaterThan(0)
  })

  it('measures the space below the attached element', () => {
    const node = document.createElement('div')
    node.getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    document.body.appendChild(node)

    const { result } = renderHook(() => useRemainingHeight(50))
    act(() => {
      result.current[0](node)
    })

    // 900 viewport - 200 from the top - 50 bottom offset
    expect(result.current[1]).toBe(650)
  })

  it('never returns less than the 300px floor', () => {
    const node = document.createElement('div')
    node.getBoundingClientRect = () => ({ top: 880 }) as DOMRect
    document.body.appendChild(node)

    const { result } = renderHook(() => useRemainingHeight(50))
    act(() => {
      result.current[0](node)
    })

    expect(result.current[1]).toBe(300)
  })

  it('tolerates being detached', () => {
    const { result } = renderHook(() => useRemainingHeight())
    expect(() => act(() => result.current[0](null))).not.toThrow()
  })
})
