import { useState, useEffect, useCallback } from 'react'

export const useCurrentTime = (updateIntervalMs = 60000) => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), updateIntervalMs)
    return () => clearInterval(interval)
  }, [updateIntervalMs])

  const getTimePosition = useCallback((hourHeight: number) => {
    return (now.getHours() + now.getMinutes() / 60) * hourHeight
  }, [now])

  return { now, getTimePosition }
}
