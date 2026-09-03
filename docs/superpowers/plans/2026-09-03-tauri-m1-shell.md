# Tauri Migration M1: Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron shell with a running Tauri v2 window that renders the existing React app, owns application config in Rust, and drives the custom titlebar through Tauri's window API.

**Architecture:** A new `src-tauri/` Rust crate becomes the app host. Vite loses its Electron plugins and serves the same React frontend to a frameless Tauri window. Config moves from `electron-store` to `tauri-plugin-store` behind three Rust commands, and window controls move from IPC handlers to Tauri's window API. A new `src/api/` directory holds typed wrappers so React never touches `invoke` or the window API directly.

**Tech Stack:** Tauri v2 (Rust), `tauri-plugin-store`, `@tauri-apps/api` v2, Vite 7, React 19, Vitest 4.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`. This plan implements milestone **M1** only.
- **Branch:** `feat/tauri-migration`. Do not merge to `main`.
- **Bundle identifier:** `com.triowfs.calendarmanager` — permanent. `app_data_dir()` derives from it and M2's database migration keys off that path. Never change it.
- **Vite dev port:** 3000, matching the existing `vite.config.js`. `devUrl` must agree or the window loads blank.
- **`zoomHotkeysEnabled: false`** is required in the window config, or WebView2's native Ctrl+scroll zoom fights `src/hooks/useZoom.ts`.
- **`style-src 'unsafe-inline'`** must stay in the CSP. Ant Design injects inline styles at runtime.
- **Rust dependency versions:** use major-version ranges (`"2"`), not pinned patches. Cargo resolves the latest compatible release.
- **Command naming:** Rust commands are `snake_case`; the `src/api/` wrappers expose `camelCase` to React. The boundary is `src/api/`, nowhere else.
- **Do not touch** anything under `src/components/calendar/`, `src/utils/`, `src/hooks/`, or `src/contexts/`. They are platform-agnostic and out of scope for M1.

**One deliberate deviation from the spec:** the spec assigns the three config
commands to M2 alongside the database. This plan pulls them into M1 (Task 2)
because without them the setup screen can render but not *save*, leaving M1
with no verifiable end-to-end path and no way to confirm the app-data directory
that M2's database migration depends on. M2's scope shrinks to the 20 database
commands accordingly.

### Expected intermediate state (important)

M1 deliberately leaves the app **partially broken at runtime**, and that is correct:

- `electron/main.js` and `electron/preload.js` are deleted in Task 1, so `window.electronAPI` no longer exists at runtime.
- The **database** methods on `window.electronAPI` are not ported until M2. Any screen that reads events, event types, or rules will throw at runtime after Task 1. That is expected. M1's deliverable is: the window opens, the titlebar works, and the setup screen renders and saves a client ID.
- To keep TypeScript compiling, the `ElectronAPI` interface in `src/types/index.ts` **stays** in M1, minus the members these tasks replace. M2 deletes what remains.
- The `window.electronAPI` mock in `src/test/setup.ts` **stays** for the same reason. Existing DB-dependent component tests keep passing because they mock it. M2 removes it.

Do not "fix" the broken DB screens in M1. Do not port DB commands early.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src-tauri/Cargo.toml` | Rust crate manifest and dependencies |
| `src-tauri/build.rs` | `tauri-build` invocation |
| `src-tauri/tauri.conf.json` | Window, CSP, bundle, and dev-server config |
| `src-tauri/capabilities/default.json` | Explicit permission allowlist |
| `src-tauri/src/main.rs` | Binary entry point; delegates to the lib |
| `src-tauri/src/lib.rs` | Builder setup, plugin registration, command registry |
| `src-tauri/src/commands/mod.rs` | Command module tree |
| `src-tauri/src/commands/config.rs` | `get_config` / `set_config` / `clear_config` |
| `src/api/config.ts` | Typed wrapper over the three config commands |
| `src/api/window.ts` | Typed wrapper over Tauri's window API |

**Modified:**

| Path | Change |
| --- | --- |
| `vite.config.js` | Remove both Electron plugins; add Tauri dev-server settings |
| `package.json` | Remove Electron deps and scripts; add Tauri deps and scripts |
| `index.html` | Replace the Entra-era CSP meta tag |
| `.gitignore` | Ignore `src-tauri/target/` and `src-tauri/gen/` |
| `src/main.tsx` | Show the window once React has mounted |
| `src/services/storage.ts` | Call `src/api/config`; drop the Electron/localStorage dual path |
| `src/components/TitleBar.tsx` | Tauri window API + `data-tauri-drag-region` |
| `src/components/TitleBar.test.tsx` | Mock `../api/window` instead of `window.electronAPI` |
| `src/types/index.ts` | Remove config + window members and the `WebkitAppRegion` declaration |

**Deleted:** `electron/main.js`, `electron/preload.js`, and the `electron/` directory.

---

### Task 1: Tauri shell — window opens with the React app

Scaffolding has no meaningful unit test, so this task's verification cycle is *build and launch*, not red-green-refactor. Tasks 2 and 3 are properly test-driven.

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Modify: `vite.config.js`, `package.json`, `index.html`, `.gitignore`, `src/main.tsx`
- Delete: `electron/main.js`, `electron/preload.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable Tauri app. `src-tauri/src/lib.rs` exposes `pub fn run()`. Task 2 registers commands inside its `invoke_handler`. The crate's lib name is `calendar_manager_lib`.

- [ ] **Step 1: Back up the database before anything else**

This is risk #1 in the spec. Do it now, not later.

```bash
cp calendar.db ~/calendar.db.backup-pre-tauri
ls -la ~/calendar.db.backup-pre-tauri
```

Expected: a ~30MB file listed. Do not proceed without it.

- [ ] **Step 2: Install the Tauri CLI and API packages**

```bash
npm install --save-dev @tauri-apps/cli@^2
npm install @tauri-apps/api@^2 @tauri-apps/plugin-store@^2
```

Expected: all three added, no peer-dependency errors.

- [ ] **Step 3: Create the Rust crate manifest**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "calendar-manager"
version = "0.0.0"
description = "Calendar Manager"
edition = "2021"
rust-version = "1.77"

[lib]
name = "calendar_manager_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
codegen-units = 1
lto = true
strip = true
```

`version` is `0.0.0` because `tauri.conf.json` reads the real version from `package.json`; this field is unused.

- [ ] **Step 4: Create the build script**

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 5: Create the Tauri config**

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Calendar Manager",
  "version": "../package.json",
  "identifier": "com.triowfs.calendarmanager",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Calendar Manager",
        "width": 1200,
        "height": 800,
        "decorations": false,
        "visible": false,
        "zoomHotkeysEnabled": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Four things here are deliberate and must not be simplified away:

- `"version": "../package.json"` — one version number, per the spec. M6's updater compares this field.
- `"visible": false` — replaces Electron's `ready-to-show` pattern. Step 11 shows the window from React.
- `ipc:` and `http://ipc.localhost` in `connect-src` — Tauri v2's IPC transport on Windows. Omit them and every `invoke` call fails silently.
- No Entra or Graph domains. Auth moves to the system browser in M3, so the webview never loads them.

- [ ] **Step 6: Create the capability allowlist**

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability set for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "core:window:allow-show",
    "core:window:allow-start-dragging",
    "store:default"
  ]
}
```

`core:window:allow-start-dragging` is what makes `data-tauri-drag-region` work in Task 3. Without it the window is unmovable.

- [ ] **Step 7: Create the Rust entry points**

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    calendar_manager_lib::run()
}
```

Create `src-tauri/src/lib.rs`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: Generate the default icon set**

```bash
npx tauri icon
```

Expected: `src-tauri/icons/` populated with the Tauri placeholder icons, matching the paths listed in Step 5. Replacing them with a real Calendar Manager icon is an M6 concern — do not block on artwork.

- [ ] **Step 9: Strip Electron from the Vite config**

Replace the entire contents of `vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Tauri shows its own build output; don't let Vite wipe it
  clearScreen: false,
  server: {
    port: 3000,
    // Tauri needs a known port — fail loudly rather than silently moving to 3001
    strictPort: true,
    open: false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
})
```

`strictPort` matters: if Vite falls back to another port, `devUrl` points at nothing and the window loads blank with no useful error.

- [ ] **Step 10: Replace the CSP meta tag in `index.html`**

Replace the `<meta http-equiv="Content-Security-Policy" ...>` line with:

```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost" />
```

Leave every other line of `index.html` untouched.

- [ ] **Step 11: Show the window once React has mounted**

In `src/main.tsx`, add the import and the show call after the render. Append at the end of the file:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window'

// Electron used the 'ready-to-show' event; Tauri's window starts hidden
// (visible: false in tauri.conf.json) and we reveal it once React has painted.
getCurrentWindow().show().catch((error) => {
  console.warn('Could not show window:', error)
})
```

The `.catch` keeps `npm run dev` in a plain browser from throwing, which is useful when debugging pure-UI work.

- [ ] **Step 12: Update `package.json` scripts and dependencies**

Remove these `devDependencies`: `electron`, `@electron/rebuild`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `concurrently`, `cross-env`, `wait-on`.

Remove these `dependencies`: `better-sqlite3`, `electron-store`. Also remove `@types/better-sqlite3` from `devDependencies`.

Do **not** yet remove `@azure/msal-browser`, `@azure/msal-node`, or `@microsoft/microsoft-graph-client` — they leave in M3/M5.

Remove the `main` field (`"main": "electron/main.js"`).

Replace the `scripts` block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "start": "tauri dev",
    "tauri": "tauri",
    "build:app": "tauri build",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run"
  },
```

Note what is gone: `electron`, and `postinstall` (`electron-rebuild`). Deleting that `postinstall` hook is the concrete form of "escape native-module pain" from the spec's drivers.

Then reinstall so the lockfile reflects reality:

```bash
npm install
```

- [ ] **Step 13: Delete the Electron backend**

```bash
git rm -r electron/
```

Expected: `electron/main.js` and `electron/preload.js` staged for deletion. From here the app has no Electron bridge at runtime — see "Expected intermediate state" above.

- [ ] **Step 14: Ignore Rust build artifacts**

Append to `.gitignore`:

```gitignore
# Tauri
src-tauri/target/
src-tauri/gen/
```

- [ ] **Step 15: Verify the Rust crate compiles**

```bash
npm run tauri -- build --debug --no-bundle
```

Expected: `cargo` downloads dependencies (slow on first run — several minutes is normal) and finishes with `Finished` and no errors. If the crate name or `calendar_manager_lib` reference is wrong, this is where it surfaces.

- [ ] **Step 16: Verify the window opens with the React app**

```bash
npm start
```

Expected, and check each one:
1. Vite starts on port 3000.
2. A **frameless** 1200x800 window appears (no OS titlebar — the custom one from `TitleBar.tsx` is at the top).
3. The app renders the **setup screen** asking for a Microsoft Graph app registration ID. It reaches this screen because `storageService.getAppRegistrationId()` fails (no `window.electronAPI`), and `App.tsx`'s catch block falls through to `setAppState('setup')`.
4. The window cannot be dragged yet, and the minimize/maximize/close buttons do nothing. Both are fixed in Task 3.

If the window is blank: check that Vite is on 3000 and `devUrl` agrees, then open devtools (right-click → Inspect) and look for CSP violations.

- [ ] **Step 17: Verify the frontend test suite still passes**

```bash
npm run test:run
```

Expected: the same pass/fail counts as before this task. The `window.electronAPI` mock in `src/test/setup.ts` is untouched, so DB-dependent component tests are unaffected.

- [ ] **Step 18: Commit**

```bash
git add src-tauri/ vite.config.js package.json package-lock.json index.html .gitignore src/main.tsx
git commit -m "feat(tauri): scaffold Tauri v2 shell and remove Electron host

Replaces electron/main.js and electron/preload.js with a src-tauri crate.
Vite drops both electron plugins; the window is frameless with
zoomHotkeysEnabled off and a CSP carrying no Entra or Graph domains,
since auth moves to the system browser in M3.

Database and window-control bridges are not ported yet, so screens
past setup throw at runtime until M2/M3. Intentional per the plan."
```

---

### Task 2: Config in Rust — the setup screen works end to end

**Files:**
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/config.rs`, `src/api/config.ts`
- Modify: `src-tauri/src/lib.rs`, `src/services/storage.ts:1-190` (full rewrite), `src/types/index.ts`
- Test: `src/services/storage.test.ts` (create)

**Interfaces:**
- Consumes: `pub fn run()` in `src-tauri/src/lib.rs` from Task 1.
- Produces:
  - Rust commands `get_config(key: String) -> Option<serde_json::Value>`, `set_config(key: String, value: serde_json::Value) -> ()`, `clear_config() -> ()`, all returning `Result<_, String>`.
  - `src/api/config.ts` exporting `getConfig<T>(key: string): Promise<T | null>`, `setConfig(key: string, value: unknown): Promise<void>`, `clearConfig(): Promise<void>`.
  - `storageService` keeps its existing public surface unchanged, so no caller outside this task needs editing: `getAppRegistrationId`, `setAppRegistrationId`, `getSyncConfig`, `setSyncConfig`, `getSyncMetadata`, `setSyncMetadata`, `getTimezone`, `setTimezone`, `clearConfig`.

**Why config is a Rust command rather than the store plugin's JS API:** M3's auth needs `appRegistrationId` to build the authorize URL, and M4's sync needs `syncConfig` and `timezone` — all inside Rust. If config lived only in the frontend, Rust would have to call back into the webview for its own configuration. Rust owns it.

- [ ] **Step 1: Write the failing test**

Create `src/services/storage.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as configApi from '../api/config'
import { storageService } from './storage'

vi.mock('../api/config', () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
}))

const mockGetConfig = vi.mocked(configApi.getConfig)
const mockSetConfig = vi.mocked(configApi.setConfig)
const mockClearConfig = vi.mocked(configApi.clearConfig)

describe('storageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('appRegistrationId', () => {
    it('reads the stored client id', async () => {
      mockGetConfig.mockResolvedValue('abc-123')

      const result = await storageService.getAppRegistrationId()

      expect(mockGetConfig).toHaveBeenCalledWith('appRegistrationId')
      expect(result).toBe('abc-123')
    })

    it('returns null when nothing is stored', async () => {
      mockGetConfig.mockResolvedValue(null)

      expect(await storageService.getAppRegistrationId()).toBeNull()
    })

    it('returns null when the backend throws', async () => {
      mockGetConfig.mockRejectedValue(new Error('store unavailable'))

      expect(await storageService.getAppRegistrationId()).toBeNull()
    })

    it('writes the client id', async () => {
      await storageService.setAppRegistrationId('xyz-789')

      expect(mockSetConfig).toHaveBeenCalledWith('appRegistrationId', 'xyz-789')
    })
  })

  describe('timezone', () => {
    it('falls back to the system timezone when unset', async () => {
      mockGetConfig.mockResolvedValue(null)
      const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone

      expect(await storageService.getTimezone()).toBe(systemZone)
    })

    it('prefers the stored timezone', async () => {
      mockGetConfig.mockResolvedValue('Europe/London')

      expect(await storageService.getTimezone()).toBe('Europe/London')
    })
  })

  describe('syncConfig', () => {
    it('returns a default range when unset', async () => {
      mockGetConfig.mockResolvedValue(null)

      const config = await storageService.getSyncConfig()

      expect(config.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(config.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('prefers the stored range', async () => {
      mockGetConfig.mockResolvedValue({ startDate: '2026-01-01', endDate: '2026-01-31' })

      const config = await storageService.getSyncConfig()

      expect(config).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' })
    })
  })

  describe('syncMetadata', () => {
    it('strips undefined values before writing', async () => {
      await storageService.setSyncMetadata({ deltaToken: 'token-1', lastEventModified: undefined })

      expect(mockSetConfig).toHaveBeenCalledWith('syncMetadata', { deltaToken: 'token-1' })
    })
  })

  describe('clearConfig', () => {
    it('delegates to the backend', async () => {
      await storageService.clearConfig()

      expect(mockClearConfig).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/services/storage.test.ts
```

Expected: FAIL — `Cannot find module '../api/config'`.

- [ ] **Step 3: Create the frontend config wrapper**

Create `src/api/config.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'

/**
 * Application configuration, owned by Rust via tauri-plugin-store.
 * Rust needs these values too (auth in M3, sync in M4), so the store is
 * read and written there rather than from the webview.
 */

export async function getConfig<T>(key: string): Promise<T | null> {
  const value = await invoke<T | null>('get_config', { key })
  return value ?? null
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  await invoke('set_config', { key, value })
}

export async function clearConfig(): Promise<void> {
  await invoke('clear_config')
}
```

- [ ] **Step 4: Rewrite the storage service**

Replace the entire contents of `src/services/storage.ts`:

```typescript
import type { SyncConfig, SyncMetadata } from './calendar'
import { getConfig, setConfig, clearConfig } from '../api/config'

/**
 * Configuration persistence. Backed by tauri-plugin-store through Rust
 * commands; every read applies its own default so a missing key is never
 * an error.
 */
class StorageService {
  private defaultSyncConfig(): SyncConfig {
    return {
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    }
  }

  async getAppRegistrationId(): Promise<string | null> {
    try {
      return await getConfig<string>('appRegistrationId')
    } catch (error) {
      console.error('Error getting app registration ID:', error)
      return null
    }
  }

  async setAppRegistrationId(appRegistrationId: string): Promise<void> {
    try {
      await setConfig('appRegistrationId', appRegistrationId)
    } catch (error) {
      console.error('Error setting app registration ID:', error)
    }
  }

  async getSyncConfig(): Promise<SyncConfig> {
    try {
      return (await getConfig<SyncConfig>('syncConfig')) ?? this.defaultSyncConfig()
    } catch (error) {
      console.error('Error getting sync config:', error)
      return this.defaultSyncConfig()
    }
  }

  async setSyncConfig(syncConfig: SyncConfig): Promise<void> {
    try {
      await setConfig('syncConfig', syncConfig)
    } catch (error) {
      console.error('Error setting sync config:', error)
    }
  }

  async getSyncMetadata(): Promise<SyncMetadata | null> {
    try {
      return await getConfig<SyncMetadata>('syncMetadata')
    } catch (error) {
      console.error('Error getting sync metadata:', error)
      return null
    }
  }

  async setSyncMetadata(syncMetadata: SyncMetadata): Promise<void> {
    try {
      // Drop undefined values so they don't serialize as JSON nulls
      const clean: SyncMetadata = {}
      if (syncMetadata.deltaToken !== undefined) {
        clean.deltaToken = syncMetadata.deltaToken
      }
      if (syncMetadata.lastEventModified !== undefined) {
        clean.lastEventModified = syncMetadata.lastEventModified
      }
      await setConfig('syncMetadata', clean)
    } catch (error) {
      console.error('Error setting sync metadata:', error)
    }
  }

  async getTimezone(): Promise<string> {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      return (await getConfig<string>('timezone')) ?? systemTimezone
    } catch (error) {
      console.error('Error getting timezone:', error)
      return systemTimezone
    }
  }

  async setTimezone(timezone: string): Promise<void> {
    try {
      await setConfig('timezone', timezone)
    } catch (error) {
      console.error('Error setting timezone:', error)
    }
  }

  async clearConfig(): Promise<void> {
    try {
      await clearConfig()
    } catch (error) {
      console.error('Error clearing config:', error)
    }
  }
}

export const storageService = new StorageService()
```

This drops the `isElectron` check and the whole `localStorage` fallback path — roughly 60 lines and every dual-path branch. Consequence to be aware of: `npm run dev` in a plain browser can no longer read or write config, because there is no `invoke`. Run the app with `npm start` (`tauri dev`).

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/services/storage.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Implement the Rust config commands**

Create `src-tauri/src/commands/mod.rs`:

```rust
pub mod config;
```

Create `src-tauri/src/commands/config.rs`:

```rust
use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Config lives in one JSON file in the app data dir, replacing electron-store.
const STORE_FILE: &str = "config.json";

#[tauri::command]
pub fn get_config<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<Value>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get(&key))
}

#[tauri::command]
pub fn set_config<R: Runtime>(app: AppHandle<R>, key: String, value: Value) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(&key, value);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_config<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.clear();
    store.save().map_err(|e| e.to_string())
}
```

Defaults are applied by `storage.ts` on every read (Step 4), so these commands intentionally return `None` for a missing key rather than duplicating default values in two places.

- [ ] **Step 7: Register the commands**

Replace the contents of `src-tauri/src/lib.rs`:

```rust
mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::set_config,
            commands::config::clear_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: Verify the Rust side compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: `Finished` with no errors.

- [ ] **Step 9: Remove the config members from the `ElectronAPI` type**

In `src/types/index.ts`, delete these three lines from the `ElectronAPI` interface:

```typescript
  getConfig: (key: string) => Promise<any>
  setConfig: (key: string, value: any) => Promise<void>
  clearConfig: () => Promise<void>
```

Leave the rest of the interface, the `declare global` block, and the `WebkitAppRegion` declaration alone — Task 3 and M2 handle those.

- [ ] **Step 10: Verify the setup flow end to end**

```bash
npm start
```

Expected:
1. The setup screen appears.
2. Enter any GUID-shaped string (e.g. `11111111-2222-3333-4444-555555555555`) and submit.
3. The app advances past setup — it will land on the login screen and MSAL will misbehave there, which is expected until M3.
4. Confirm the value persisted: close the app, run `npm start` again, and the setup screen should **not** reappear.
5. Confirm the file on disk:

```bash
cat "$APPDATA/com.triowfs.calendarmanager/config.json"
```

Expected: JSON containing `appRegistrationId` with the value you entered. This proves the identifier-derived app data path from the Global Constraints is what the store actually uses — which is exactly the path M2's database migration will target.

- [ ] **Step 11: Run the full frontend suite**

```bash
npm run test:run
```

Expected: all previously passing tests still pass, plus the 10 new `storage.test.ts` tests.

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/ src/api/config.ts src/services/storage.ts src/services/storage.test.ts src/types/index.ts
git commit -m "feat(tauri): move app config into Rust via tauri-plugin-store

Adds get_config/set_config/clear_config commands and a typed src/api/config
wrapper. storage.ts loses the isElectron branch and the localStorage
fallback, roughly 60 lines, and gains its first test coverage.

Config is Rust-owned rather than using the store plugin's JS API because
M3 auth and M4 sync both need these values inside Rust."
```

---

### Task 3: Window controls — the titlebar drives the Tauri window

**Files:**
- Create: `src/api/window.ts`
- Modify: `src/components/TitleBar.tsx:38-95` (effect and handlers), `src/components/TitleBar.tsx:130-215` (drag regions), `src/types/index.ts`
- Test: `src/components/TitleBar.test.tsx:45-66` (mock setup), `:233-304` (Window Controls), `:364-402` (Component Lifecycle), `:404-418` (Error Handling)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 beyond a running window.
- Produces: `src/api/window.ts` exporting `minimizeWindow(): Promise<void>`, `toggleMaximizeWindow(): Promise<void>`, `closeWindow(): Promise<void>`, `isWindowMaximized(): Promise<boolean>`, `onWindowResized(callback: (maximized: boolean) => void): Promise<() => void>`. The `onWindowResized` return value is an unlisten function — call it in effect cleanup.

**Two behavioural differences from Electron, both intentional:**

1. `toggleMaximizeWindow` replaces the manual `isMaximized() ? restore() : maximize()` branch that lived in `electron/main.js`. Tauri provides the toggle.
2. Electron's `WebkitAppRegion: 'drag'` is **inherited by child elements**, which is why the old titlebar had to mark every interactive child `'no-drag'`. Tauri's `data-tauri-drag-region` applies only to the element carrying the attribute, so all the `no-drag` styles are deleted rather than translated.

- [ ] **Step 1: Write the failing test**

In `src/components/TitleBar.test.tsx`, add this mock block immediately after the existing `vi.mock('./SyncModal', ...)` block (around line 43):

```typescript
vi.mock('../api/window', () => ({
  minimizeWindow: vi.fn(() => Promise.resolve()),
  toggleMaximizeWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  isWindowMaximized: vi.fn(() => Promise.resolve(false)),
  onWindowResized: vi.fn(() => Promise.resolve(vi.fn())),
}))
```

Add this import at the top of the file, after the existing imports:

```typescript
import * as windowApi from '../api/window'
```

In the top-level `describe('TitleBar', ...)`, replace the `beforeEach` body. The
existing line `mockElectronAPI.isWindowMaximized.mockResolvedValue(false)` must
go, and the window mocks need explicit defaults — `vi.clearAllMocks()` clears
recorded calls but **not** implementations, so a `mockResolvedValue` set inside
one test would otherwise leak into every test after it:

```typescript
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(false)
    vi.mocked(windowApi.onWindowResized).mockResolvedValue(vi.fn())
    vi.mocked(windowApi.minimizeWindow).mockResolvedValue(undefined)
    vi.mocked(windowApi.toggleMaximizeWindow).mockResolvedValue(undefined)
    vi.mocked(windowApi.closeWindow).mockResolvedValue(undefined)
  })
```

Now replace the whole `describe('Window Controls', ...)` block with:

```typescript
  describe('Window Controls', () => {
    it('minimizes the window when the minimize button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 3])

      expect(windowApi.minimizeWindow).toHaveBeenCalled()
    })

    it('toggles maximize when the maximize button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 2])

      expect(windowApi.toggleMaximizeWindow).toHaveBeenCalled()
    })

    it('closes the window when the close button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 1])

      expect(windowApi.closeWindow).toHaveBeenCalled()
    })

    it('reads the initial maximized state on mount', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(true)

      render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(windowApi.isWindowMaximized).toHaveBeenCalled())
    })

    it('subscribes to resize events and unsubscribes on unmount', async () => {
      const unlisten = vi.fn()
      vi.mocked(windowApi.onWindowResized).mockResolvedValue(unlisten)

      const { unmount } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(windowApi.onWindowResized).toHaveBeenCalled())

      unmount()

      await waitFor(() => expect(unlisten).toHaveBeenCalled())
    })

    it('survives a failing isWindowMaximized call', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockRejectedValue(new Error('no window'))

      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())
    })

    it('marks the titlebar as a drag region', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() =>
        expect(container.querySelector('[data-tauri-drag-region]')).toBeInTheDocument()
      )
    })
  })
```

Delete the now-obsolete `it('handles missing electronAPI gracefully', ...)` test from the old Window Controls block, the `it('cleans up listeners on unmount', ...)` and `it('handles missing removeAllListeners gracefully', ...)` tests from `describe('Component Lifecycle', ...)`, and the entire `describe('Error Handling', ...)` block — all four assert on `electronAPI` plumbing that no longer exists, and their intent is covered by the tests above.

Keep `it('sets up sync callbacks on mount', ...)` in Component Lifecycle. Sync is M4's problem, not M1's.

Finally, delete the `mockElectronAPI` object and the `Object.defineProperty(window, 'electronAPI', ...)` call from this file's setup (around lines 45-66) along with any `beforeEach` lines referencing it. The global mock in `src/test/setup.ts` stays, but this file no longer needs its own.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/TitleBar.test.tsx
```

Expected: FAIL — `Cannot find module '../api/window'`.

- [ ] **Step 3: Create the window API wrapper**

Create `src/api/window.ts`:

```typescript
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
```

- [ ] **Step 4: Rewire the TitleBar effect and handlers**

In `src/components/TitleBar.tsx`, add to the imports:

```typescript
import {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
} from '../api/window';
```

Replace the entire `useEffect` block (currently lines 38-74) with:

```typescript
  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    let cancelled = false;

    const setUpWindowState = async () => {
      try {
        const maximized = await isWindowMaximized();
        if (!cancelled) setIsMaximized(maximized);
      } catch (error) {
        console.warn('Could not get window state:', error);
      }

      try {
        const unlisten = await onWindowResized((maximized) => {
          if (!cancelled) setIsMaximized(maximized);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      } catch (error) {
        console.warn('Could not subscribe to window resize:', error);
      }
    };

    setUpWindowState();

    // Set up sync progress tracking
    calendarService.setSyncCallbacks(
      (progress) => setSyncProgress(progress),
      () => setSyncProgress(null)
    );

    return () => {
      cancelled = true;
      unlistenResize?.();
      // Clean up sync callbacks
      calendarService.setSyncCallbacks();
    };
  }, []);
```

The `cancelled` flag matters: `onResized` resolves asynchronously, so a component unmounted before it settles would otherwise leak a listener and call `setState` on a dead component.

Replace the three handlers (currently lines 76-95) with:

```typescript
  const handleMinimize = () => {
    minimizeWindow().catch((error) => console.warn('Minimize failed:', error));
  };

  const handleMaximize = () => {
    // Optimistic flip keeps the icon responsive; onWindowResized corrects it
    setIsMaximized((previous) => !previous);
    toggleMaximizeWindow().catch((error) => console.warn('Maximize failed:', error));
  };

  const handleClose = () => {
    closeWindow().catch((error) => console.warn('Close failed:', error));
  };
```

Leave `handleCancelSync`, `handleSyncButtonClick`, `handleProgressClick`, and the mobile menu code exactly as they are. Sync belongs to M4.

- [ ] **Step 5: Convert the drag regions**

In the outer `<Flex>`'s `style` object, delete the line `WebkitAppRegion: 'drag',` and add the attribute to the element itself:

```tsx
    <Flex
      data-tauri-drag-region
      justify="space-between"
      align="center"
      style={{
        height: '32px',
        background: token.colorBgContainer,
        padding: '0 12px',
        borderBottom: `1px solid ${token.colorBorder}`,
        userSelect: 'none',
      }}
    >
```

Then delete every remaining `WebkitAppRegion: 'no-drag'` line in this file — there are four: on the mobile menu `Button`, on the menu-toggle `Button`, on the middle sync `Flex`, and on the window-controls `Flex`. Where removing the property leaves an empty `style={{ }}`, remove the `style` prop entirely.

Finally, make the app title itself draggable by adding the attribute to the `Text`:

```tsx
        <Text data-tauri-drag-region style={{ fontSize: '14px', fontWeight: 500 }}>
          {isMobile ? 'CM' : 'Calendar Manager'}
        </Text>
```

- [ ] **Step 6: Remove the Electron window and CSS declarations from the types**

In `src/types/index.ts`, delete these five lines from the `ElectronAPI` interface:

```typescript
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowStateChange: (callback: (event: any, maximized: boolean) => void) => void
```

Also delete the trailing module augmentation, which exists only for Electron:

```typescript
// Extend CSSProperties to include Webkit properties for Electron
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
```

If TypeScript now reports an unused `WebkitAppRegion` anywhere, that is a `no-drag` line Step 5 missed — remove it.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx vitest run src/components/TitleBar.test.tsx
```

Expected: PASS. If a window-control test clicks the wrong button, check the index arithmetic — the last three `.ant-btn` elements are minimize, maximize, close in that order.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. Errors mentioning `WebkitAppRegion` mean a leftover `no-drag`; errors mentioning `electronAPI` members other than the database ones mean something was removed too eagerly.

- [ ] **Step 9: Run the full frontend suite**

```bash
npm run test:run
```

Expected: everything green.

- [ ] **Step 10: Verify the window manually — this is M1's acceptance test**

```bash
npm start
```

Check every one of these:
1. **Drag** the titlebar background — the window moves.
2. **Drag** the "Calendar Manager" text — the window moves.
3. **Minimize** — the window minimizes.
4. **Maximize** — the window maximizes and the button icon changes to the restore icon.
5. **Click it again** — the window restores and the icon changes back.
6. **Double-click** the titlebar background — the window toggles maximize (Tauri gives this for free with the drag region).
7. **Drag** while maximized — the window unmaximizes and follows the cursor.
8. **Close** — the window closes and the process exits.
9. **Resize** by dragging a window edge — this works despite `decorations: false`.
10. Click the sync button — the sync modal opens. It will error when it tries to reach the database; that is M2's work.

If dragging does nothing, `core:window:allow-start-dragging` is missing from `src-tauri/capabilities/default.json`.

- [ ] **Step 11: Commit**

```bash
git add src/api/window.ts src/components/TitleBar.tsx src/components/TitleBar.test.tsx src/types/index.ts
git commit -m "feat(tauri): drive the custom titlebar from Tauri's window API

Window controls move to src/api/window.ts. toggleMaximize replaces the
manual isMaximized/restore branch, and onResized replaces Electron's
window-state-change push channel with an unlisten-based subscription.

data-tauri-drag-region replaces WebkitAppRegion. Tauri's attribute is not
inherited by children, so all four no-drag overrides are deleted rather
than translated, along with the Electron-only CSSProperties augmentation.

TitleBar tests now mock ../api/window; four tests asserting on electronAPI
listener plumbing are removed as their intent is covered by new tests."
```

---

## M1 Definition of Done

- [ ] `npm start` opens a frameless window rendering the React app.
- [ ] Titlebar drag, minimize, maximize/restore, double-click-to-maximize, and close all work.
- [ ] The setup screen accepts a client ID, persists it to `%APPDATA%/com.triowfs.calendarmanager/config.json`, and does not reappear on restart.
- [ ] `npm run test:run` is green, including the new `storage.test.ts`.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `cd src-tauri && cargo check` is clean.
- [ ] `electron/` is gone; `electron`, `better-sqlite3`, and `electron-store` are out of `package.json`.
- [ ] `calendar.db` is backed up outside the repo.

**Known-broken and expected:** every screen that reads the database, and the login screen. M2 and M3 respectively.

## Next

M2 (Rust data layer) gets its own plan, written once M1 lands so its tasks can reference the actual Rust module structure and command signatures rather than guessing at them.
