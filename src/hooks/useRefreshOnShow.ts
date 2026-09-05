import { useEffect } from 'react'

/**
 * Reloads a screen the next time it is actually shown, if something changed
 * while it was hidden.
 *
 * Every screen in this app stays mounted behind `display: none`, so a screen
 * never notices work done elsewhere — edit a mapping on Map Events and the
 * calendar keeps showing the old one. The obvious fix is to remount with a
 * changing `key`, which is what `App.tsx` used to do; that destroys and
 * rebuilds the whole subtree and is recorded in `docs/backlog.md` as the wrong
 * mechanism. This reloads data instead, and only when the screen is on show,
 * so nothing is paid for a screen nobody is looking at.
 *
 * `onRefresh` is expected to clear the flag that triggered it, or this fires
 * again on the next render.
 */
export function useRefreshOnShow(
  isActive: boolean,
  needsRefresh: boolean,
  onRefresh: () => void
): void {
  useEffect(() => {
    if (!isActive || !needsRefresh) return
    onRefresh()
    // `onRefresh` is deliberately not a dependency: callers pass an inline
    // arrow, so including it would re-fire on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, needsRefresh])
}
