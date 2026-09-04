# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Foreign keys are enforced.** `libsqlite3-sys`'s bundled build compiles with `SQLITE_DEFAULT_FOREIGN_KEYS=1`; the previous `better-sqlite3` backend left them off. This already changed behaviour once: deleting an in-use event type used to silently orphan its events, and now instead reassigns them to the default type and removes rules that targeted it, in one transaction (`db::event_types::delete_event_type`, surfaced to the frontend as `DeleteEventTypeOutcome`). Creating or updating a rule with a `target_type_id` that doesn't exist now fails with a real `FOREIGN KEY constraint failed` error, which `src/api/rules.ts` translates into a readable message rather than letting it reach the user.
- `events` table: calendar events with Microsoft Graph sync metadata
- `categories` table: event categorization with color coding

**Microsoft Graph Integration:**
- All Graph calls happen in Rust (`reqwest`), never from the renderer — there is no CSP or CORS concern for talking to Graph because the webview never does it directly
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

### Theme and Styling

**Theme System:**
- `ThemeContext`: Light/dark mode with localStorage persistence
- Ant Design theme algorithm integration
- CSS custom properties for consistent theming
- Responsive breakpoints with `Grid.useBreakpoint()`

## Testing Framework

### Test Setup
The application uses **Vitest** with React Testing Library for component and utility testing, plus a separate **Cargo** test suite for the Rust backend:

- **Test Configuration**: `vitest.config.ts` - Configured for jsdom environment with React support
- **Test Setup**: `src/test/setup.ts` - Global test setup with mocks for `ResizeObserver`, dayjs plugins, and jsdom quirks
- **Test Utilities**: `src/test/utils.tsx` - Custom render function with providers and mock data
- **Test Coverage**: Run `npm run test:run` to generate coverage reports
- **Rust tests**: Run `cd src-tauri && cargo test`; these are unit tests co-located with the modules they cover (rule evaluation, the Graph transform, the migration runner against both a fresh database and a legacy-shaped one, DPAPI round-trips, etc.)

**The drive-letter trap:** running `npm run test:run` from a lowercase drive letter (`d:\Dev\CalendarManager`) makes Vitest collect zero tests — every file reports "No test suite found in file", and the suite looks completely broken. The identical command from `D:\Dev\CalendarManager` passes all 389. This has cost real diagnosis time twice; always confirm `pwd` prints an uppercase drive letter before trusting a failing (or suspiciously empty) frontend test run.

### Testing Patterns
- **Component Tests**: Test user-visible behavior, not implementation details
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
