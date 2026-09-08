# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deferred work, recorded follow-ups, and environment traps are in
[`docs/backlog.md`](docs/backlog.md). Notably: there is **no installer or
auto-updater yet** — that work is blocked on generating an update signing key.

## Development Commands

**Primary development workflow:**
- `npm start` - Start the full Tauri application in development mode (runs the Vite dev server and launches the Tauri window)
- `npm run dev` - Start only the Vite development server (for frontend-only testing)
- `npm run build` - Build the React frontend only (`vite build`)
- `npm run build:app` - Build the full desktop application (`tauri build`): compiles the Rust backend and produces the installer
- `npm run tauri` - Run the Tauri CLI directly (e.g. `npm run tauri -- icon` )

**Testing:**
- `npm test` - Run frontend tests in watch mode with Vitest
- `npm run test:run` - Run frontend tests once and exit
- `npm run test:ui` - Run frontend tests with Vitest UI for visual test management
- `cd src-tauri && cargo test` - Run the Rust backend test suite

**Build artifacts:**
- `dist/` - Vite build output (React frontend)
- `src-tauri/target/` - Rust build output and the compiled installer (`npm run build:app`)

## Architecture Overview

### Tauri + React Hybrid Architecture
This is a desktop Tauri v2 application with a React 19 frontend and a Rust backend. All privileged state — SQLite, configuration, OAuth tokens, and Microsoft Graph syncing — lives in Rust; the frontend is a view layer that talks to it through `invoke()` commands and Tauri events.

**Backend (`src-tauri/src/`):**
- `lib.rs` - Builder setup: registers plugins, manages `AuthState`/`SyncState`, runs the `setup` hook (config-store corruption guard, legacy config carry-over, legacy database copy), and lists every `#[tauri::command]` in `invoke_handler`
- `auth/` - The loopback PKCE login flow (`flow.rs`, `pkce.rs`, `loopback.rs`), token exchange/refresh (`tokens.rs`), and DPAPI-encrypted refresh-token storage (`secret_store.rs`)
- `db/` - SQLite access: schema and migrations (`schema.rs`, `migrate.rs`), domain structs (`models.rs`), CRUD and queries (`events.rs`, `categories.rs`), event types and rules (`event_types.rs`, `rules.rs`), type assignment (`assignment.rs`), and the sync upsert/cleanup pipeline (`sync.rs`)
- `graph/` - Microsoft Graph integration: the sync date-range/timezone resolution (`date_range.rs`), the Graph → local event transform (`transform.rs`), and the paginated fetch loop (`sync.rs`)
- `commands/` - Thin `#[tauri::command]` wrappers that plumb arguments into the modules above; this is the entire IPC surface (33 commands)

**Frontend (`src/`):**
- React 19 application with Ant Design UI
- `@ant-design/icons` is a **direct** dependency, not a transitive one. Around
  ten files import it, and it had been resolving only through antd — which
  would have broken silently on any antd change that stopped re-exporting it
- No direct Node.js access; all backend operations go through `src/api/`, typed wrappers over Tauri's `invoke()`
- `electron/` no longer exists — it was deleted when the app was migrated from Electron to Tauri v2

### Application State Flow
The app follows a 4-stage state machine in `App.tsx`:
1. **loading** - Initial app startup
2. **setup** - Microsoft Graph app registration configuration
3. **login** - System-browser PKCE authentication flow
4. **dashboard** - Main application interface

### Data Layer Architecture

**Local Storage:**
- SQLite database (`calendar.db`) with Graph-compatible schema, opened via `rusqlite` (`bundled` feature — no system SQLite dependency)
- The database lives in `app_data_dir()` (`%APPDATA%/com.triowfs.calendarmanager/calendar.db`), not the repo root
- A versioned migration runner (`db/schema.rs`) keyed on SQLite's built-in `PRAGMA user_version` applies schema changes; migration 1 is idempotent so a copied legacy database (already fully evolved, `user_version` 0) passes through untouched and is simply stamped
- On first run, `db/migrate.rs` copies a legacy `calendar.db` (and any `-wal` sidecar) from the old repo-root location into `app_data_dir()` before the database is opened, preserving event types, rules and manual overrides that Microsoft Graph cannot recreate
- **Foreign keys are enforced.** `libsqlite3-sys`'s bundled build compiles with `SQLITE_DEFAULT_FOREIGN_KEYS=1`; the previous `better-sqlite3` backend left them off. This already changed behaviour once: deleting an in-use event type used to silently orphan its events, and now instead reassigns them to the default type and removes rules that targeted it, in one transaction (`db::event_types::delete_event_type`, surfaced to the frontend as `DeleteEventTypeOutcome`). Creating or updating a rule with a `target_type_id` that doesn't exist now fails with a real `FOREIGN KEY constraint failed` error, which `src/api/rules.ts` translates into a readable message rather than letting it reach the user. SQLite's own default is OFF and nothing here issues `PRAGMA foreign_keys = ON`, so this rests entirely on that build flag — `db::schema`'s `foreign_keys_are_enforced_by_default` test guards it, because a `rusqlite` bump that dropped the flag would silently stop enforcing rather than fail.
- `events` table: calendar events with Microsoft Graph sync metadata
- `categories` table: event categorization with color coding

**Microsoft Graph Integration:**
- All Graph calls happen in Rust (`reqwest`), never from the renderer — there is no CSP or CORS concern for talking to Graph because the webview never does it directly
- **TLS trust comes from the Windows certificate store.** `reqwest`'s `rustls` feature (0.13+) uses `rustls-platform-verifier`; `webpki-roots` is not in the dependency tree. This is why the app works behind a TLS-inspecting corporate proxy whose root CA is installed by Group Policy. Reverting to a bundled root store would break exactly those users, and no unit test would catch it — nothing in the suite makes a real HTTPS call
- Date-range sync only; the delta-sync path was deliberately not ported (it was ~150 lines of unreachable code even under Electron)
- Sync configuration (date range) drives `/me/calendar/calendarView`

**Config Storage:**
- `tauri-plugin-store` (a Rust-owned `config.json` in `app_data_dir()`) replaces `electron-store`. Reads and writes go through the `get_config`/`set_config`/`clear_config` commands (`src/api/config.ts`)

### Calendar Sync Architecture

**Sync Process Flow (Rust, `graph/sync.rs`):**
1. `start_sync` spawns a Tokio task and returns immediately; the sync itself streams progress back via events
2. Resolve the UTC fetch window from the configured date range and timezone
3. Page through `/me/calendar/calendarView` (`$top=500`), following `@odata.nextLink` as-is
4. Transform and upsert each page as it arrives — never accumulating the full result set in memory — inside a transaction, then emit `sync-status`
5. Clean up local events inside the sync window that Graph no longer returns (skipped entirely if the sync fetched nothing, so a failed or empty response can never wipe the window)
6. Emit `sync-complete` exactly once, however the attempt ended

**Event contract:**
- `sync-status` — one per page: `{ fetched: number, phase: 'fetching' | 'saving' | 'cleaning' }`. `fetched` only ever increases; there is deliberately no percentage.
- `sync-complete` — exactly once per attempt: `{ success, message, stats: { created, updated, deleted, total }, errors }`

**Key Sync Features:**
- Cancellation via `tokio_util::sync::CancellationToken`, checked between pages and raced against the in-flight `reqwest` call, so a cancel mid-request actually aborts the request rather than letting the database write run to completion
- The access token is refreshed via `ensure_access_token` once per page (not once at the start), so a long sync over a slow connection can't run past token expiry
- Offline detection happens in Rust (a real connection error from `reqwest`), not via `navigator.onLine`
- An event whose `type_manually_set` is true keeps its type across sync; only non-type columns are updated

### UI Component Architecture

**Layout Pattern:**
- `App.tsx`: State machine orchestrator
- `TitleBar`: Custom window controls with responsive navigation
- `SideNavigation`: Collapsible sidebar with responsive behavior
- `CalendarViewer`: Main calendar interface with month/week views

**Calendar Components:**
- `WeekView`: Advanced week view with time slots and event overlap handling
- `EventModal`: Event details and editing interface
- `SyncModal`: Real-time sync progress (spinner, live fetched count, cancel) and completion stats

**Settings Components:**
- `MicrosoftGraphSettings`: App registration and sync configuration
- `TimezoneSettings`: User timezone selection
- `DataManagement`: Database operations and data export

### Grids

`DataGrid` (`src/components/grid/`) is the only table implementation. There is
no antd `Table` left in `src/`, and adding one back would fork the behaviour
this replaced.

**Import from `src/components/grid` only** — never from `grid/core/` or
`grid/DataGrid` directly. The barrel is what keeps the internals free to move,
and it exports the column helpers too: `createActionsColumn`,
`createIdColumn`, `createCsvColumn`, `applyColumnType`, `DragHandleCell`, and
`confirmDelete`.

**Two variants.** `variant="advanced"` is the data-exploration surface —
toolbar, global search, per-column filters, floating filter row, CSV export,
column menu, and a body that fills the remaining viewport height.
`variant="simple"` is for a grid inside a record section or a modal, where the
heading above already says what it is: no toolbar, no filters, and a height
that fits its rows.

**Columns are TanStack v9 `ColumnDef`s.** `meta.columnType` presets
(`'yesNo' | 'dateOnly' | 'dateTime'`) supply display, sort *and* filter config
together. A preset does **not** force you to give up a custom cell:
`core/column-types.ts` applies its own `cell` only
`if (type.cell && col.cell === undefined)`, so an explicit `cell` wins while
the column still inherits the preset's accessor, sort and filter.

**Layout persists, sorting does not.** Column sizing, visibility, pinning and
order are saved to localStorage under `calendar-grid:{persistStateKey}:v2`.
Sorting, filters and global search are deliberately session-only — a user's
sort is not meant to outlive the window.

**`meta.unavailable` is a permission, not a preference.** Such a column is
hidden, absent from Choose Columns entirely, and overrides any saved user
choice. Contrast `meta.hiddenByDefault`, which only seeds an initial state the
user can override.

#### TanStack Table v9: features are opt-in

`core/grid-features.ts` declares the feature set via `tableFeatures()`. **An
option belonging to an unregistered feature silently does nothing** rather
than erroring, so adding a capability means registering its feature first.
`rowExpandingFeature` and `rowSelectionFeature` are deliberately *not*
registered — there is no tree mode and no selection column.

Two v9 behaviours that have already cost time:

- **`getCanSort()` requires `column.accessorFn`.** An `id`-only column with a
  custom `sortFn` is *silently unsortable*. Give any sortable column without
  an `accessorKey` an explicit `accessorFn`.
- **A numeric column's first sort click defaults to descending.** Set
  `sortDescFirst: false` where ascending-first is wanted.

#### Never derive a value from a row's render position

A column or handler that reads a row's index in the rendered array is correct
only while nothing reorders rows. `DataGrid` sorts, so such a value silently
points at the wrong record. This was a real bug in the mapping-rules table,
whose "#" column and order arrows read the antd `Table`'s row index and were
only correct because its search removed rows without reordering them. Read the
authoritative field (e.g. `priority`) instead.

#### CSV export goes through the backend

`exportGridToCsv` is **async** and writes via `saveFile` (`src/api/files.ts`),
which opens a native dialog. **WebView2 silently ignores a Blob plus a clicked
`<a download>`** — no file, no error. The contract: `false` means the user
cancelled and is not an error; a genuine write failure *rejects*, so a caller
must `try/catch`. This is the second independent place in the codebase to hit
that constraint.

#### Testing a grid

Two things are required or every row assertion fails:

- **Stub `offsetHeight` on `[data-grid-body-viewport]`.**
  `@tanstack/react-virtual` sizes its window from that element; jsdom always
  reports 0, and the virtualizer then returns an *empty* range rather than an
  overscan-sized one, so the grid renders a header and no rows. Worse, an
  "empty state" assertion passes for entirely the wrong reason.
- **Render with the custom `render` from `src/test/utils`**, not bare React
  Testing Library — `DataGrid` needs a `MessageProvider` for its export
  messages.

Also: a draggable header `<th>` carries `role="button"`, not `columnheader`,
so a sort-triggering click needs `fireEvent.click(getByText(...))`. And nine
grid modules import dayjs, so a test touching grid dates needs
`vi.unmock('dayjs')` — see the dayjs note above.

### Theme and Styling

**Theme System:**
- `ThemeContext`: Light/dark mode with localStorage persistence
- Ant Design theme algorithm integration
- CSS custom properties for consistent theming
- Responsive breakpoints with `Grid.useBreakpoint()`

## Testing Framework

### Test Setup
The application uses **Vitest** with React Testing Library for component and utility testing, plus a separate **Cargo** test suite for the Rust backend:

- **Test Configuration**: `vitest.config.mts` - Configured for jsdom environment with React support
- **Test Setup**: `src/test/setup.ts` - Global test setup with mocks for `ResizeObserver`, dayjs plugins, and jsdom quirks
- **Test Utilities**: `src/test/utils.tsx` - Custom render function with providers and mock data
- **Test Coverage**: Run `npm run test:run` to generate coverage reports
- **Rust tests**: Run `cd src-tauri && cargo test`; these are unit tests co-located with the modules they cover (rule evaluation, the Graph transform, the migration runner against both a fresh database and a legacy-shaped one, DPAPI round-trips, etc.)

**Both config files must keep their ESM extensions.** `package.json` declares
`"type": "commonjs"`, so a plain `vite.config.js` / `vitest.config.ts` is loaded
as CommonJS and Vite 8 warns that it contains ESM syntax — and will fail outright
once `configLoader: 'native'` becomes the default. They are therefore
`vite.config.mjs` and `vitest.config.mts`. Renaming either back, or adding a new
`.js`/`.ts` config beside them, reintroduces the problem. Flipping the package to
`"type": "module"` would also fix it, but changes module resolution for
everything else, which is why the extensions carry it instead.

**The drive-letter trap:** running `npm run test:run` from a lowercase drive letter (`d:\Dev\CalendarManager`) makes Vitest collect zero tests — every file reports "No test suite found in file", and the suite looks completely broken. The identical command from `D:\Dev\CalendarManager` passes the whole suite. This has cost real diagnosis time twice; always confirm `pwd` prints an uppercase drive letter before trusting a failing (or suspiciously empty) frontend test run.

### Testing Patterns
- **Component Tests**: Test user-visible behavior, not implementation details
- **Grid tests need two things or every row assertion fails** — an
  `offsetHeight` stub on `[data-grid-body-viewport]` and the custom `render`
  from `src/test/utils`. See the Grids section above.
- **Mock `src/api/` modules**: There is no `window.electronAPI` to fake any more — tests `vi.mock('../../api/events')` and friends, and assert on the calls a component makes rather than on serialized IPC payloads
- **Provider Wrapping**: Use custom `render()` from test utils to wrap components with necessary providers
- **Mock Data**: Use provided mock objects for consistent test data

### Test File Organization
- Place component tests next to components: `ComponentName.test.tsx`
- Place utility tests next to utilities: `utilityName.test.ts`
- Use descriptive test names and group related tests with `describe()` blocks

## Important Development Patterns

### IPC Communication
All database and system operations must go through the typed wrappers in `src/api/` (`events.ts`, `eventTypes.ts`, `rules.ts`, `config.ts`, `auth.ts`, `sync.ts`, `files.ts`, `window.ts`), which call Tauri's `invoke()` under the hood. Never call `invoke()` directly from a component, and never attempt direct Node.js operations in renderer code.

```typescript
// Correct: Use the src/api/ wrapper
import { getEvents } from '../api/events'
const events = await getEvents()

// Incorrect: Direct Node.js access (will fail — there is no Node in the renderer)
const fs = require('fs')
```

**The naming convention, and why it matters:**
- Rust command *names* are `snake_case` (`get_events_in_range`), and `src/api/` wrappers expose `camelCase` functions (`getEventsInRange`) to React. The boundary is explicit in one place (`src/api/`) rather than smeared across every call site.
- **Domain field names stay `snake_case` end to end** — `start_date`, `is_all_day`, `type_manually_set`, and so on. `src/types/index.ts` declares the `Event`/`EventType`/`EventTypeRule` interfaces with those exact field names, and the calendar components (`WeekView`, `EventModal`, ...) read them directly off the JSON Rust returns. The Rust structs in `db/models.rs` deliberately have **no** `#[serde(rename_all = "camelCase")]` — serde's default already serializes a Rust `snake_case` field as the same `snake_case` JSON key, which is what those interfaces expect. Only IPC payloads with their own dedicated types (e.g. `sync.rs`'s `SyncStatus`/`SyncResult`) use `#[serde(rename_all = "camelCase")]`, because nothing in `src/types/index.ts` constrains their shape.
- **Tauri auto-camelCases command *arguments***, not just command names — this is a silent failure mode. A Rust command parameter named `start_date` must be invoked as `invoke('get_events_in_range', { startDate, endDate })`, not `{ start_date, end_date }`. Passing the snake_case name doesn't error; the argument is just silently missing on the Rust side. `src/api/` wrappers already do this correctly (see `getEventsInRange`, `setEventTypeManually`, `updateRulePriorities`) — match their pattern for any new command rather than re-deriving it.

### Event Date Handling
The application uses dayjs with timezone plugins for all date operations. Events store ISO strings but display in user's configured timezone.

```typescript
// Always consider user timezone for display
const userTimezone = await storageService.getTimezone()
const localTime = dayjs.utc(event.start_date).tz(userTimezone)
```

### Sync Progress Management
Calendar sync runs entirely in Rust and reports progress via Tauri events (`sync-status`, `sync-complete`), consumed through `src/api/sync.ts`'s `onSyncStatus`/`onSyncComplete` (each returns an unlisten function — call it on unmount). `startSync()` returns as soon as the Rust task is spawned; it does not resolve when the sync finishes.

```typescript
// Proper sync with progress tracking
const unlistenStatus = await onSyncStatus((status) => setProgress(status))
const unlistenComplete = await onSyncComplete((result) => handleSyncComplete(result))
```

### Configuration Storage
Use `storageService` methods, which wrap `src/api/config.ts` and apply their own default on every read (e.g. falling back to the system timezone or a default date range when a key is absent).

```typescript
// Backed by tauri-plugin-store via Rust commands — no localStorage fallback exists
await storageService.setAppRegistrationId(clientId)
```

### Security Considerations
- Content Security Policy restricts `connect-src` to the app itself and Tauri's IPC origin — Graph calls happen in Rust, so the webview's CSP no longer needs `graph.microsoft.com` or any Microsoft login domain
- **The CSP is defined in two files that must be edited in pairs, with nothing enforcing this:** `src-tauri/tauri.conf.json` (injected as a header in the built app) and `index.html` (the only one that applies under `npm start`/`tauri dev`, since that page is served by Vite and Tauri cannot add headers to it)
- Context isolation is enabled by default in Tauri v2; the frontend has no Node.js access
- The capability allowlist (`src-tauri/capabilities/default.json`) is explicit: only the permissions the app actually uses are granted
- Access tokens and refresh tokens are handled only in Rust and never cross the IPC boundary; the refresh token is DPAPI-encrypted at rest

## Authentication

Authentication is a loopback PKCE flow through the **system browser**, entirely in Rust (`src-tauri/src/auth/`):

1. The frontend calls `invoke('login')` (via `src/api/auth.ts`'s `login()`).
2. Rust generates a PKCE verifier/challenge and a random `state`, binds an ephemeral loopback listener (`127.0.0.1:0`), and opens the authorize URL in the user's default browser via `tauri-plugin-opener` — giving them their existing Entra session, password manager, MFA and Windows Hello, rather than an embedded login form.
3. The loopback listener catches the redirect, verifies `state`, serves a short "you can close this tab" page, and shuts down. A 5-minute timeout and a cancellable `invoke('cancel_login')` cover abandoned logins.
4. Rust exchanges the code for tokens directly against Entra's token endpoint — no CORS constraint applies to a Rust HTTP client, which is the whole reason this flow lives in Rust rather than the webview.
5. The access token and its expiry live only in Rust's in-memory `AuthState` — never on disk, never sent to the frontend. The refresh token is DPAPI-encrypted (`CryptProtectData`/`CryptUnprotectData`, bound to the current Windows user) and written to `%APPDATA%/com.triowfs.calendarmanager/refresh-token.bin`.
6. `ensure_access_token` is the single entry point anything needing Graph calls: it returns the cached token if still fresh, or serializes concurrent callers behind a lock and performs one refresh-token-grant request otherwise.

**`msal-browser` cannot work here and must not be reintroduced.** It expects a real web origin for its redirect URI (`window.location.origin`); Tauri's webview does not have one that Entra's SPA platform will accept. The loopback-PKCE-through-the-system-browser flow above is the only approach Entra supports for this kind of app, which is why auth is Rust-owned rather than a frontend library.

## Microsoft Graph Integration

**Required Scopes:**
- `User.Read` - Basic user profile
- `Calendars.Read` - Read calendar events
- `Calendars.ReadWrite` - Full calendar access
- `offline_access` - Needed for the refresh token; standard OIDC scope, no app-registration change required

**API Endpoints Used:**
- `/me/calendar/calendarView` - Date-range event fetching (the only sync path — delta sync was deliberately removed, not ported)
- `/me` - Fetching the signed-in user's display name and email after login (avoids a JWT dependency to decode an `id_token`)

**Event Data Mapping:**
Graph events are transformed to local schema in `graph::transform::transform` (`src-tauri/src/graph/transform.rs`). Key mappings include categories as comma-separated strings and JSON serialization of complex objects (`organizer`, `attendees`).
