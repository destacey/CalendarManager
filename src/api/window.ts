import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Window controls for the custom titlebar. Tauri exposes these directly on
 * the window object, so unlike the database these need no Rust commands.
 */

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize()
}

/** Tauri provides the toggle; Electron needed an isMaximized/restore branch. */
export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize()
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close()
}

export function isWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized()
}

/**
 * Reports the maximized state whenever the window is resized, replacing
 * Electron's separate maximize/unmaximize push channel.
 * Returns an unlisten function — call it on unmount.
 */
export async function onWindowResized(
  callback: (maximized: boolean) => void
): Promise<() => void> {
  const appWindow = getCurrentWindow()
  return appWindow.onResized(async () => {
    try {
      callback(await appWindow.isMaximized())
    } catch (error) {
      console.warn('Could not read window state:', error)
    }
  })
}
