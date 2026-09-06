import React, { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Whether the screen a component belongs to is the one on show.
 *
 * Every screen in this app stays mounted behind `display: none`, so a
 * component's mount effect runs once — at the screen's first visit — and never
 * again. Anything it loaded is then frozen: create a mapping rule on Map
 * Events, open Settings, and the rules list still shows what it read the first
 * time. Remounting on show is the wrong fix (it destroys and rebuilds the
 * subtree, recorded in `docs/backlog.md`), so this reloads data instead.
 *
 * A context rather than a prop because the components that load are often deep
 * — a settings tab inside a tab list inside the screen — and threading
 * `isActive` down to each of them would be noise at every level.
 */
const ScreenVisibilityContext = createContext<boolean>(true)

export const ScreenVisibilityProvider: React.FC<{
  active: boolean
  children: React.ReactNode
}> = ({ active, children }) => (
  <ScreenVisibilityContext.Provider value={active}>{children}</ScreenVisibilityContext.Provider>
)

export function useScreenIsActive(): boolean {
  return useContext(ScreenVisibilityContext)
}

/**
 * Runs `reload` each time this component's screen becomes visible.
 *
 * Not on first mount: the component's own load effect has just run, and firing
 * again would double every screen's first visit. Only the hidden → shown
 * transition counts.
 */
export function useReloadOnShow(reload: () => void): void {
  const active = useScreenIsActive()
  const wasActive = useRef(active)

  useEffect(() => {
    const becameVisible = active && !wasActive.current
    wasActive.current = active
    if (becameVisible) reload()
    // `reload` is deliberately not a dependency: callers pass an inline arrow
    // or an unmemoised function, so including it would re-fire on every
    // render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
