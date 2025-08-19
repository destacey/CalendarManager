import { useState, useEffect, useCallback } from 'react'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

export interface CalendarState {
  viewMode: 'month' | 'week'
  calendarType: 'month' | 'year'  
  currentWeek: Dayjs
  currentDate: Dayjs
}

const STORAGE_KEY = 'calendar-view-state'

const defaultState: CalendarState = {
  viewMode: 'month',
  calendarType: 'month',
  currentWeek: dayjs(),
  currentDate: dayjs()
}

export const useCalendarState = () => {
  const [state, setState] = useState<CalendarState>(defaultState)

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setState({
          viewMode: parsed.viewMode || defaultState.viewMode,
          calendarType: parsed.calendarType || defaultState.calendarType,
          currentWeek: parsed.currentWeek ? dayjs(parsed.currentWeek) : defaultState.currentWeek,
          currentDate: parsed.currentDate ? dayjs(parsed.currentDate) : defaultState.currentDate
        })
      }
    } catch (error) {
      console.warn('Failed to load calendar state from localStorage:', error)
    }
  }, [])

  // Save state to localStorage whenever it changes
  const saveState = useCallback((newState: CalendarState) => {
    try {
      const serializable = {
        viewMode: newState.viewMode,
        calendarType: newState.calendarType,
        currentWeek: newState.currentWeek.toISOString(),
        currentDate: newState.currentDate.toISOString()
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
    } catch (error) {
      console.warn('Failed to save calendar state to localStorage:', error)
    }
  }, [])

  const updateState = useCallback((updates: Partial<CalendarState>) => {
    setState(prevState => {
      const newState = { ...prevState, ...updates }
      saveState(newState)
      return newState
    })
  }, [saveState])

  const setViewMode = useCallback((viewMode: 'month' | 'week') => {
    updateState({ viewMode })
  }, [updateState])

  const setCalendarType = useCallback((calendarType: 'month' | 'year') => {
    updateState({ calendarType })
  }, [updateState])

  const setCurrentWeek = useCallback((currentWeek: Dayjs) => {
    updateState({ currentWeek })
  }, [updateState])

  const setCurrentDate = useCallback((currentDate: Dayjs) => {
    updateState({ currentDate })
  }, [updateState])

  return {
    ...state,
    setViewMode,
    setCalendarType,
    setCurrentWeek,
    setCurrentDate,
    updateState
  }
}