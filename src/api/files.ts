import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'

/**
 * Saving a file through a native dialog. WebView2 will not honour a Blob
 * `<a download>` inside a Tauri window, so the browser idiom the Electron
 * build relied on silently does nothing here — the file has to be written
 * by the backend to a path the user picked.
 */

/** Returns false when the user cancelled the dialog. */
export async function saveFile(
  defaultName: string,
  bytes: Uint8Array,
  filterName: string,
  extensions: string[]
): Promise<boolean> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions }]
  })

  if (!path) return false

  await writeFile(path, bytes)
  return true
}
