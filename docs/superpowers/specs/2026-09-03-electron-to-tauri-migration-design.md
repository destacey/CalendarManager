# Electron → Tauri Migration Design

**Date:** 2026-09-03
**Status:** Approved
**Branch:** `feat/tauri-migration`

## Goal

Replace CalendarManager's Electron shell with Tauri v2, moving all privileged
state — SQLite, config, OAuth tokens, and Microsoft Graph syncing — into a real
Rust backend. Ship the result as a signed, self-updating Windows installer.

## Drivers

1. Smaller, faster distributable (~5MB installer vs ~150MB).
2. Escape native-module pain (`better-sqlite3` + `electron-rebuild`).
3. Real packaging and auto-update, which the project has never had.
4. Smaller attack surface: tokens and DB access behind explicit Rust commands.
5. Learning Rust. This rules out the shortcut path (`tauri-plugin-sql` with all
   logic in TypeScript) and argues for a substantial Rust backend.

## Current state

- **Frontend:** React 19 + Ant Design 6, Vite 7, ~40 source files. Platform-agnostic
  apart from the IPC calls.
- **Backend:** `electron/main.js`, 819 lines — `better-sqlite3`, `electron-store`,
  window controls, and event-type rule evaluation in one file.
- **Bridge:** `electron/preload.js` exposes 33 methods on `window.electronAPI`,
  consumed at ~73 call sites across 8 files.
- **Auth:** `@azure/msal-browser` using `loginRedirect` with
  `redirectUri: window.location.origin`.
- **Sync:** `src/services/calendar.ts`, 715 lines, fetches Graph events in the
  renderer and hands the full array to `main.js` for upsert.
- **Data:** a local, gitignored `calendar.db` (~30MB) at the repo root.
- **Packaging:** none. No `electron-builder`, no CI.

### Dead code identified

Removed rather than ported:

- `@azure/msal-node` — a dependency with zero imports.
- `openFile`, `saveFile`, `onMenuAction` — declared in `preload.js` and
  `types/index.ts`, with no `main.js` handler and no call site.
- The delta-sync path — `performFullSync`, `fetchDeltaEvents`,
  `fetchAllEventsWithDeltaToken`, `extractDeltaToken`, and the `forceFullSync`
  parameter. `syncEvents()` only ever calls `performDateRangeSync`, making
  roughly 150 lines unreachable. CLAUDE.md already describes delta sync as legacy.
- `SyncProgress.tsx` (191 lines), including its unused `compact` variant.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Rust depth | Substantial Rust backend | Learning Rust is a stated driver |
| Auth flow | Rust loopback + PKCE, system browser | Only approach Entra supports for a non-SPA origin |
| Graph sync | Moves into Rust | Tokens never reach the renderer; streams pages instead of one huge IPC payload |
| Repo strategy | Clean break on a branch | No throwaway dual-target shim |
| Data migration | Copy legacy DB on first run | Preserves event types, rules, and manual overrides, which Graph cannot recreate |
| Packaging | Installer **and** auto-updater | Both in scope |
| Sync progress | Live count, no percentage | The old contract was structurally incapable of working |

## Architecture

Rust owns all privileged state. The frontend becomes a pure view layer talking
to Rust through `invoke()` commands and Tauri events.

```text
src-tauri/
  Cargo.toml
  tauri.conf.json              # decorations false, CSP, bundler, updater
  capabilities/default.json    # explicit allowlist: store, dialog, fs, opener, updater
  src/
    main.rs                    # thin: state setup + command registration
    lib.rs
    db/
      mod.rs                   # Mutex<Connection> in Tauri state
      schema.rs                # versioned migrations
      events.rs                # event CRUD + range queries
      event_types.rs           # types, rules, priorities
      rules.rs                 # pure rule evaluation (unit-tested)
      migrate.rs               # legacy calendar.db copy
    auth/
      mod.rs                   # loopback PKCE flow
      tokens.rs                # keyring refresh token, in-memory access token
    graph/
      mod.rs                   # reqwest client
      sync.rs                  # paginated fetch → transform → upsert
    commands/                  # #[tauri::command] fns — the IPC surface
    window.rs
src/
  api/                         # NEW: typed wrappers over invoke() + window API
  ... rest of React unchanged
```

A module tree rather than a port of `main.js`: the existing file mixes schema,
queries, rule logic, window control, and config. Splitting along those seams
costs nothing now, makes each piece independently testable, and small focused
files are far easier to reason about while learning Rust.

**Key crates:** `rusqlite` (feature `bundled`), `reqwest`, `tokio`,
`tokio-util` (`CancellationToken`), `serde`, `keyring`, `thiserror`.

**Plugins:** `tauri-plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-fs`,
`tauri-plugin-opener`, `tauri-plugin-updater`.

## Data layer

### Connection management

A single `rusqlite::Connection` behind a `Mutex` in Tauri's managed state. The
app is single-window and single-user; a pool would add a dependency and lifetime
complexity for no measurable gain. WAL mode stays enabled.

### Database location and legacy copy

The DB moves from the repo root to `app_data_dir()`. On startup, `migrate.rs`:

1. Checks for a DB at the new app-data path.
2. If absent, looks for a legacy `calendar.db` at the old repo-root path and
   beside the executable.
3. If found, copies it plus any `-wal` / `-shm` sidecars before opening.
4. Logs the outcome. Runs at most once.

This also fixes the packaging bug where the DB lived next to the source.

### Migrations

Ten `try { ALTER TABLE } catch {}` blocks are replaced by a versioned runner
keyed on SQLite's built-in `PRAGMA user_version`:

- **v1** — the complete current schema: `CREATE TABLE IF NOT EXISTS` for
  `events`, `categories`, `event_types`, `event_type_rules`; all existing
  indexes; column additions guarded by an actual `pragma_table_info` check
  rather than a swallowed exception.
- v1 is idempotent, so a copied legacy DB (which already has every column)
  passes through untouched and is stamped as v1.
- Later changes append v2, v3, … and errors propagate instead of vanishing.

Seeding the default "Work" event type is unchanged: insert only when
`event_types` is empty.

### Rule evaluation

`evaluateRule` / `evaluateEventTypeSync` become pure `rules.rs` functions:

```rust
fn evaluate(rules: &[Rule], fields: &EventFields, default: Option<i64>) -> Option<i64>
```

No database access — the caller pre-fetches rules and the default type, as the
sync path already does. Semantics port exactly:

- Fields: `title`, `is_all_day` (as `"true"`/`"false"`), `show_as`, `categories`.
- Operators: `equals` (exact), `contains` (case-insensitive), `is_empty` (trim-based).
- Unknown field or operator returns `false`.
- First match by ascending priority wins; otherwise the default type.

### Booleans

The `Boolean(event.is_all_day)` coercion repeated across handlers becomes `bool`
fields on `#[derive(Serialize)]` structs. rusqlite reads SQLite integers into
`bool` directly.

### Config store

`tauri-plugin-store` replaces `electron-store`, mapping 1:1 onto the existing
`getConfig` / `setConfig` / `clearConfig` surface. `electron-store`'s JSON schema
defaults (`syncConfig`, `timezone`) become `serde` defaults in Rust.
`storage.ts` already applies its own defaults on every read.

## Authentication

### Entra app registration changes (manual, prerequisite)

1. Add a **Mobile and desktop applications** platform with redirect URI
   `http://localhost` — no port, no trailing slash, no path. Entra treats
   loopback redirects as port-agnostic, so one entry covers any ephemeral port.
2. **Authentication → Advanced settings → Allow public client flows → Yes.**
   Without this the token endpoint rejects the PKCE exchange with
   `AADSTS7000218`.
3. Remove the existing Single-page application platform entry — but only after
   the Tauri flow works.

API permissions are unchanged: `User.Read`, `Calendars.Read`,
`Calendars.ReadWrite` delegated. Rust additionally requests `offline_access`, a
standard OIDC scope needing no registration, to obtain a refresh token.

### Flow

1. Frontend calls `invoke('login')`. Rust generates a PKCE verifier, an S256
   challenge, and a random `state`.
2. Bind a loopback listener on `127.0.0.1:0` — the OS assigns a free port, so
   nothing is hardcoded and nothing collides.
3. Build the `/organizations/oauth2/v2.0/authorize` URL with
   `redirect_uri=http://localhost:{port}`, scopes
   `offline_access User.Read Calendars.Read Calendars.ReadWrite`, and
   `prompt=select_account`.
4. Open it in the **system browser** via `tauri-plugin-opener`, giving the user
   their existing Entra session, password manager, MFA, and Windows Hello.
5. The listener catches the redirect, verifies `state`, serves a short
   "you can close this tab" page, and shuts down. A 5-minute timeout and a
   cancellable `invoke('cancel_login')` cover abandoned logins.
6. Rust POSTs to `/oauth2/v2.0/token` with the code and verifier. No CORS
   constraint applies here — this is the reason auth moves to Rust.
7. Refresh token → Windows Credential Manager via `keyring`. Access token and
   expiry stay in memory in Tauri state, never serialized to disk, never sent to
   the frontend.
8. Rust calls Graph `/me` for display name and email. Using `/me` rather than
   decoding the `id_token` avoids a JWT crate for two fields.

### Silent refresh

An internal `ensure_access_token()` that every Graph request calls first: if the
cached token expires within 5 minutes, run the refresh-token grant and update
state. Replaces MSAL's `acquireTokenSilent`. The frontend has no token
lifecycle to manage.

### Session restore

On startup, if a refresh token exists in Credential Manager, attempt a refresh;
success goes straight to `dashboard`. Replaces MSAL's `localStorage` cache.

**One-time cost:** the existing MSAL cache is abandoned, so the user signs in
once more after migration. Calendar data is unaffected.

### Fallback

If Credential Manager access proves unreliable under some profile
configurations, fall back to an encrypted file in the app data dir. Validate at
M3, not M6.

### Frontend impact

`services/auth.ts` drops from 138 lines to a ~30-line wrapper over `login`,
`logout`, `get_account`, `has_session`. `getAccessToken`, `getGraphClient`, and
`handleRedirectPromise` are deleted. In `App.tsx`, the
`initialize` → `handleRedirectPromise` → `isLoggedIn` sequence collapses to a
single `has_session` check; the page-reload-mid-auth concern disappears because
auth no longer navigates the app window.

`@azure/msal-browser` and `@azure/msal-node` are removed from `package.json`.

### CSP reduction

Today's policy whitelists `login.microsoftonline.com`, `login.live.com`, and
both `aadcdn` domains because the login UI renders inside the app window. With
auth in the system browser and Graph calls in Rust, the webview needs none of
them, and `connect-src` no longer needs `graph.microsoft.com` either. Antd
injects inline styles at runtime, so `style-src 'unsafe-inline'` must stay.

## Sync engine

### Command surface

`start_sync()` returns immediately after spawning a Tokio task.
`cancel_sync()` flips a cancellation flag. Progress flows back as events:

```rust
app.emit("sync-status", SyncStatus { fetched: u32, phase: Phase })?;  // one per page
app.emit("sync-complete", SyncResult { .. })?;                        // once
```

`fetched` only ever increases. `phase` is a plain enum
(`Fetching` / `Saving` / `Cleaning`) rendered as text — no percentage, no
per-stage colour palette.

### Why the old contract was dropped

`completed` only ever jumped 0 → total in a single step, so the progress bar
showed 0% then 100%. `stats.created` / `updated` stayed at zero until the sync
had already finished. All four stage icons resolved to the same spinner.

`SyncProgress.tsx` is deleted. It is replaced by ~30 lines inside `SyncModal`:
spinner, `"{n} events fetched…"`, and a Cancel button. The final
created/updated/deleted `Statistic` row survives, moving to the completion
state where the numbers are real.

`addSyncCallbacks` / `removeSyncCallbacks` / `setSyncCallbacks` and the
`Set<Callback>` bookkeeping are removed. Tauri's `listen()` returns an unlisten
function, so a component subscribes and unsubscribes in one `useEffect`.

### Pipeline

Today: fetch every page into a JS array, serialize the whole array across IPC,
then upsert. In Rust, each 500-event page is transformed and upserted as it
arrives, inside a transaction, with one status event per page.

Unchanged from the current implementation: the `/me/calendar/calendarView`
endpoint, the `$select` field list
(`id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime`),
`$top=500`, and `startDateTime` / `endDateTime` range parameters.
`@odata.nextLink` is followed as-is rather than picked apart with `new URL()`.

### Upsert semantics

Ported exactly, including the critical subtlety: an existing event whose
`type_manually_set` is true keeps its type, and only non-type columns are
updated. Rules and the default type are pre-fetched once before the loop. New
events get `type_manually_set = 0`.

Retained: date-range sync as the only path, and `cleanupEventsInDateRange`
(deleting local events inside the sync window that Graph no longer returns).

The `syncMetadata` key (`deltaToken`, `lastEventModified`) stays in the config
store schema so no config migration is needed and a future delta sync has
somewhere to put its state — but the date-range path neither reads nor writes
it. Note this is already true today: `setSyncMetadata` is called only from
`performFullSync`, which is unreachable.

### Cancellation

A `tokio_util::sync::CancellationToken` in Tauri state, checked between pages
and passed to `reqwest` so an in-flight request aborts too. Strictly better than
the current `AbortController`, which can only abort the HTTP request — the DB
write, once started, runs to completion. Cancel emits the same
`'Sync was cancelled'` result the UI already handles.

### Offline detection

Moves server-side. `navigator.onLine` only reports whether the adapter has a
link; Rust returns a real connection error from `reqwest`, mapped to the same
`'Unable to sync while offline...'` message.

Net effect: `calendar.ts` goes from 715 lines to roughly 40 — `startSync`,
`cancelSync`, and a typed `listen` helper. Date-range calculation and timezone
logic move to Rust alongside the fetch.

## Frontend changes

### `src/api/`

The only new frontend abstraction. One file per domain — `events.ts`,
`eventTypes.ts`, `rules.ts`, `config.ts`, `auth.ts`, `sync.ts`, `window.ts` —
each exporting typed functions over `invoke`. The `ElectronAPI` interface in
`types/index.ts` and the `window.electronAPI` global declaration are deleted;
call sites import functions instead of reaching for a global TypeScript can only
partially describe.

Rust commands use `snake_case` (`get_events_in_range`); the `src/api/` wrappers
expose `camelCase` to React. The convention boundary is explicit in one place
rather than smeared across 73 call sites.

### Where the 33 bridge methods go

| Group | Count | Destination |
| --- | --- | --- |
| Events (`getEvents`, `getEventsInRange`, `createEvent`, `updateEvent`, `deleteEvent`) | 5 | Rust commands (M2) |
| Categories (`getCategories`, `createCategory`) | 2 | Rust commands (M2) |
| Event types (`get`/`create`/`update`/`delete`/`setDefault`) | 5 | Rust commands (M2) |
| Rules (`get`/`create`/`update`/`delete`/`updatePriorities`) | 5 | Rust commands (M2) |
| Type assignment (`evaluateEventType`, `setEventTypeManually`, `reprocessEventTypes`) | 3 | Rust commands (M2) |
| Config (`getConfig`, `setConfig`, `clearConfig`) | 3 | Rust commands (M2) |
| Window (`minimize`, `maximize`, `close`, `isMaximized`, `onWindowStateChange`) | 5 | Tauri window API, no custom commands (M1) |
| `syncGraphEvents` | 1 | Internal to the Rust sync pipeline, not exposed (M4) |
| `openFile`, `saveFile`, `onMenuAction`, `removeAllListeners` | 4 | Deleted — no handler, no call site |

That is 23 custom Rust commands, plus `login` / `logout` / `get_account` /
`has_session` from M3 and `start_sync` / `cancel_sync` from M4.

## Dependency and script cleanup (M5)

**Removed from `package.json`:** `electron`, `@electron/rebuild`,
`vite-plugin-electron`, `vite-plugin-electron-renderer`, `better-sqlite3`,
`@types/better-sqlite3`, `electron-store`, `@azure/msal-browser`,
`@azure/msal-node`, `@microsoft/microsoft-graph-client`, `concurrently`,
`cross-env`, `wait-on`.

`@microsoft/microsoft-graph-client` is only imported by `services/auth.ts` for
`getGraphClient`, which is deleted in M3, so it leaves with MSAL.

**Kept:** `exceljs` (still generates the workbook in the frontend), `dayjs`,
`antd`, `@dnd-kit/*`, React, and the whole Vitest toolchain.

**Scripts:** `start` and `electron` are replaced by `tauri dev` / `tauri build`
wrappers; `postinstall` (`electron-rebuild`) is deleted outright — removing it
is the concrete form of "escape native-module pain". `dev`, `build`, `test`,
`test:ui`, and `test:run` are unchanged.

### Window controls

`TitleBar.tsx` is the most Electron-coupled component.

- `minimizeWindow` / `maximizeWindow` / `closeWindow` →
  `getCurrentWindow().minimize()` / `.toggleMaximize()` / `.close()`.
  `toggleMaximize` replaces the manual `isMaximized() ? restore() : maximize()`
  branch.
- The `window-state-change` push channel and its `removeAllListeners` cleanup
  become `onResized` plus an `isMaximized()` read. `setupWindowStateEvents` in
  Rust is unnecessary — Tauri provides this.
- Dragging requires `data-tauri-drag-region` on the titlebar's background
  element, with interactive children excluded. Easy to miss; the symptom is an
  unmovable window.

### Excel export

`EventTable.tsx` keeps `exceljs` — it is pure JS and generates the buffer fine.
Only delivery changes: the Blob + `<a download>` becomes `tauri-plugin-dialog`'s
`save()` for a native Save-As, then `tauri-plugin-fs` `writeFile`. This is
required, not cosmetic: WebView2 will not honour a blob download inside a Tauri
window. The generated filename is unchanged.

### Untouched

All calendar rendering, `calendarLayout.ts`, `eventUtils.ts`, the hooks,
`ThemeContext`, `MessageContext`, Ant Design, and `useZoom`'s `localStorage`
usage. One config addition: `zoomHotkeysEnabled: false` in `tauri.conf.json`, or
WebView2's native Ctrl+scroll zoom fights the handler in `useZoom.ts`.

## Testing

The existing Vitest setup stays; the mock target changes. `test/setup.ts`
currently fakes a 33-method `window.electronAPI`; tests instead
`vi.mock('../api/events')` and friends. Mocking our own module beats Tauri's
`mockIPC` here — tests assert on the calls a component makes, not on serialized
IPC payloads.

- **Rewrite:** `TitleBar.test.tsx` — its assertions target `electronAPI`
  listener plumbing that no longer exists.
- **Swap mock target, keep assertions:** `EventTypeRulesSettings`,
  `EventTypesSettings`, `EventModal`, `Settings`.
- **No change expected:** `eventUtils`, `CalendarHeader`, `WeekView`,
  `MonthEventCell`, `CalendarNavigation`, `ViewModeToggle`, `EventTable`,
  `LoadingScreen`, `UserMenu`.

New `cargo test` coverage:

- Rule evaluation against a table of field/operator/value cases (pure, no DB).
- The Graph → local event transform.
- The `type_manually_set` upsert branch.
- The migration runner against both a fresh DB and a copy of a legacy-shaped
  one. This is the highest-value test in the project — it is the one that can
  lose data.

## Packaging and updates

### Bundle

Windows targets `nsis` (primary, the updater's preferred installer type) and
optionally `msi`. The bundler uses the WebView2 download bootstrapper so a clean
Windows 10 machine self-provisions.

**The bundle identifier is effectively permanent.** `app_data_dir()` derives
from it, so changing it later means the app silently starts with an empty
database at a new path. The legacy-copy migration also keys off this path.
Chosen deliberately: `com.triowfs.calendarmanager`.

### Signing: two independent things

- **Tauri updater signature (minisign)** — required, free. `tauri signer
  generate` produces a keypair; the public key goes in `tauri.conf.json`, the
  private key and password into GitHub Actions secrets as
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  **Back this key up** — losing it means existing installs can never update
  again, with no recovery path.
- **Authenticode code signing** — needs a paid certificate, not required, out of
  scope. Without it, first-time installers show a SmartScreen warning.
  Auto-update itself works unsigned.

### Release pipeline

A GitHub Actions workflow using `tauri-apps/tauri-action`: on a version tag it
builds, signs, uploads the installer, and generates `latest.json` as a release
asset. The repository is public, so the static endpoint needs no tokens or extra
infrastructure:

```text
https://github.com/destacey/CalendarManager/releases/latest/download/latest.json
```

### In-app UI

A section in `Settings`: current version, manual "Check for updates", and on
finding one, release notes with an Install & Restart button, driven by the
plugin's `check()` → `downloadAndInstall()` with a progress callback. Plus a
silent check on startup surfacing a non-blocking notice.

### Version source of truth

`tauri.conf.json`'s `version` is what the updater compares. It reads from
`package.json` so there is one number to bump rather than two that can drift.

## Milestones

Ordering is constrained by the clean break: the app cannot run until config and
DB commands exist. These are sequenced to reach a runnable app quickly and keep
it runnable.

| # | Milestone | Done when |
| --- | --- | --- |
| **M1** | Shell — scaffold `src-tauri`, strip electron plugins from `vite.config.js`, `tauri.conf.json` (decorations off, CSP, `zoomHotkeysEnabled: false`), port TitleBar + drag region | Window opens, custom titlebar minimises/maximises/closes, React renders to the setup screen |
| **M2** | Data layer — migration runner, app-data DB path + legacy copy, all 23 DB/config commands, `tauri-plugin-store` | Full app works against the real 30MB DB; everything but auth and sync |
| **M3** | Auth — loopback PKCE, keyring, session restore, simplified `App.tsx` state machine, MSAL deleted | Sign in, restart, still signed in |
| **M4** | Sync — reqwest Graph pipeline, `sync-status` / `sync-complete`, cancellation, SyncModal rewrite | Sync works and is cancellable; ~675 lines leave `calendar.ts` |
| **M5** | Polish — Save-As for the Excel export, delete `electron/`, drop dead deps, retarget tests, update CLAUDE.md | `npm run test:run` and `cargo test` both green, no Electron references remain |
| **M6** | Distribution — bundle config, signing keypair, GitHub Actions + `tauri-action`, updater UI | A tagged release installs, then updates itself |

## Risks

Most dangerous first.

1. **The 30MB database.** Back up `calendar.db` outside the repo before M2 runs
   for the first time. The migration is idempotent and tested, but a manual
   backup covers the one failure mode with no undo.
2. **`AADSTS7000218` at M3** — the token endpoint rejecting PKCE because
   *Allow public client flows* was not enabled. Highest-probability blocker,
   trivial fix once recognised.
3. **`keyring` on Windows.** Credential Manager access is reliable, but the
   encrypted-file fallback must be validated at M3 rather than discovered at M6.
4. **WebView2 runtime** on machines lacking it. A non-issue on Windows 11;
   the download bootstrapper covers clean Windows 10.
5. **Dev-server port.** `tauri dev` defaults to 1420; Vite is on 3000. `devUrl`
   and `beforeDevCommand` must match `vite.config.js` or the window loads blank.
6. **CSP and Ant Design.** Antd injects inline styles at runtime, so
   `style-src 'unsafe-inline'` must stay even as the Entra domains are removed.

## Out of scope

Tracked as follow-ups, deliberately excluded:

- Authenticode code signing.
- macOS and Linux targets.
- Restoring delta sync — a clean feature against a working Rust sync if ever
  wanted, not baggage carried through the port.
- `getEventsInRange`'s lexicographic ISO-string date comparison, which is
  fragile if Graph returns mixed offset formats. Ported faithfully so that a
  behaviour change is not mistaken for a Tauri regression.

## Follow-ups raised during M1 review

Added after the whole-branch review of M1, with the milestone that owns each.

**M2 must handle:**

- **A corrupt `config.json` is silently swallowed, then destroyed.**
  `tauri-plugin-store`'s `build()` discards the deserialize error, so an
  unparseable file yields an empty store and every read falls through to its
  default — the user simply lands back on the setup screen. The first write
  then truncates the bad file, destroying it. `Store::reload()` *does*
  propagate the error, unlike `build()`: call it once in the `setup` hook and,
  on `Err`, rename the file to `config.json.corrupt` before continuing.
  Today's blast radius is a client ID, a date range and a timezone. It becomes
  serious the moment a "legacy DB already copied" marker lives in that
  store — a silent reset of that flag would re-run the legacy copy over a live
  database.
- **Nothing migrates the old `electron-store` config.** The old path was
  `%APPDATA%/<userData>/config.json`; the new one is
  `%APPDATA%/com.triowfs.calendarmanager/config.json`. The user re-enters the
  client ID, but `timezone` and `syncConfig` are lost silently — and a reset
  timezone means every event displays in the wrong zone until someone notices.
  Fold a config copy in alongside the legacy database copy, or record the loss
  as accepted.
- **Settle the Rust error type before it is stamped across 20 more commands.**
  M1's three config commands use `Result<_, String>` rather than the
  `thiserror` the architecture section names, so the frontend cannot
  distinguish "key absent" from "store unreadable" from "disk full". An
  `AppError` enum implementing `Serialize` is far cheaper to introduce now
  than to retrofit.
- **Use `#[tauri::command(async)]` for the database commands.** A non-`async`
  command body runs inline in the IPC handler, so a blocking SQLite query
  would freeze the window. M1's config commands set the precedent and should
  be switched too.
- **Document the argument-name convention.** Tauri auto-camelCases command
  *arguments*, not just names, so a Rust `start_date` parameter must be
  invoked as `startDate`. M1's single-word `key`/`value` arguments exercise
  neither rule, leaving it untested until M2's first multi-word argument.

**M5 must handle:**

- **`README.md`.** It sells the app as Electron-based and documents
  `electron/main.js` as the main process. M5 was scoped to CLAUDE.md only, so
  nothing owned the README; it is now explicitly M5's. Both files carry a
  staleness banner in the meantime.
- **The Electron leftovers in `.gitignore`** (`dist-electron/` and the
  `# Electron` block).
- **`core:window:allow-is-maximized`** in the capability allowlist, redundant
  with `core:window:default`.

**M6 must handle:**

- **`tauri.conf.json`'s `"version": "../package.json"` resolves relative to
  the process working directory, not to the config file.** Any tool parsing
  the config from the repo root fails with a misleading "must be a semver
  string". Worth knowing before `tauri-action` is wired up.

**Unowned, worth a look:**

- **The CSP lives in two files that must be edited in pairs** —
  `src-tauri/tauri.conf.json` (injected as a header in production) and
  `index.html` (the only one that applies under `tauri dev`, since the page
  comes from Vite and Tauri cannot add headers to it). Neither says so.
- **The draggable titlebar surface is narrower than it appears.** A bare
  `data-tauri-drag-region` is self-only, so only the outer flex container's
  own exposed gaps and the title text drag; the inner wrappers are dead
  zones. Switching to `"deep"` would require excluding the SyncProgress click
  wrapper, whose `onClick` the drag handler would otherwise kill.
