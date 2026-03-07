import { useState, useEffect, useCallback, RefObject } from 'react'

const ZOOM_LEVELS = [60, 80, 96, 120, 150, 180, 240]
const DEFAULT_ZOOM_INDEX = 3 // 120px
const STORAGE_KEY = 'calendar-zoom-level'

export const useZoom = (scrollContainerRef: RefObject<HTMLDivElement | null>) => {
  const [zoomIndex, setZoomIndex] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) {
        const idx = parseInt(saved, 10)
        if (idx >= 0 && idx < ZOOM_LEVELS.length) return idx
      }
    } catch {}
    return DEFAULT_ZOOM_INDEX
  })

  const hourHeight = ZOOM_LEVELS[zoomIndex]

  // Persist zoom level
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(zoomIndex))
    } catch {}
  }, [zoomIndex])

  const zoomIn = useCallback(() => {
    setZoomIndex(prev => Math.min(prev + 1, ZOOM_LEVELS.length - 1))
  }, [])

  const zoomOut = useCallback(() => {
    setZoomIndex(prev => Math.max(prev - 1, 0))
  }, [])

  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1
  const canZoomOut = zoomIndex > 0

  // Ctrl+scroll handler
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()

      // Capture scroll position ratio before zoom
      const scrollTop = container.scrollTop
      const oldHeight = container.scrollHeight - container.clientHeight

      if (e.deltaY < 0) {
        setZoomIndex(prev => Math.min(prev + 1, ZOOM_LEVELS.length - 1))
      } else {
        setZoomIndex(prev => Math.max(prev - 1, 0))
      }

      // Restore proportional scroll position after zoom on next frame
      requestAnimationFrame(() => {
        const newHeight = container.scrollHeight - container.clientHeight
        if (oldHeight > 0 && newHeight > 0) {
          container.scrollTop = (scrollTop / oldHeight) * newHeight
        }
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [scrollContainerRef])

  return { hourHeight, zoomIn, zoomOut, canZoomIn, canZoomOut }
}
