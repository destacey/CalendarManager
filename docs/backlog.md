# Backlog

Deferred work from the Electron → Tauri migration, recorded so none of it has
to be rediscovered. Each item says what it is, why it was deferred, and what
picking it up involves.

Design decisions live in
[`docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`](superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md).

---

## 1. Distribution: installer, signing keypair, and auto-updater

**Status:** deferred — this is the whole M6 milestone.
**Blocked on:** a decision about who generates and holds the update signing key.

Everything else in the migration is done. The app builds and runs, but there is
no installer and no way to ship an update.

### What is already in place

- `src-tauri/tauri.conf.json` targets `nsis` and reads its version from
  `package.json` (currently `1.0.0`), so there is one version number to bump.
- The bundle identifier `com.triowfs.calendarmanager` is set and **permanent** —
  `app_data_dir()` derives from it, and the database migration keys off that
  path. Changing it makes the app start against an empty database.
- The repository is public, so a static update manifest on GitHub Releases needs
  no tokens or extra infrastructure.

### What is left to do

1. **Generate the update signing keypair.** `npx tauri signer generate -w <path
   outside the repo>`. The public half goes in `tauri.conf.json` under
   `plugins.updater.pubkey`; the private half and its password go into GitHub
   Actions secrets as `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

   **This key is unrecoverable. Lose it and existing installs can never update
   again — there is no reset.** Store it in a password manager before deleting
   the local file.

2. **Add `tauri-plugin-updater`** (Rust and JS), register it in
   `src-tauri/src/lib.rs`'s builder, and add `updater:default` to
   `src-tauri/capabilities/default.json`.

3. **Configure the endpoint** in `tauri.conf.json`:

   ```
   https://github.com/destacey/CalendarManager/releases/latest/download/latest.json
   ```

4. **Add a GitHub Actions release workflow** using `tauri-apps/tauri-action`,
   triggered on a version tag. It builds, signs, uploads the installer, and
   generates `latest.json` as a release asset. There is currently no `.github/`
   directory at all.

5. **Add the in-app update UI** — a section in `Settings` showing the current
   version (`getVersion()` from `@tauri-apps/api/app`), a manual check, and on
   finding an update, the release notes with an Install & Restart button driven
   by the plugin's `check()` → `downloadAndInstall()`. Plus a silent check on
   startup surfacing a non-blocking notice.

6. **Use the WebView2 download bootstrapper** in the NSIS config so a clean
   Windows 10 machine provisions the runtime itself rather than failing.

### Two things that are *not* the same thing

- **Tauri's updater signature** (minisign) is **required** for the updater and
  free. That is the key above.
- **Authenticode code signing** needs a paid certificate and is **not** required.
  Without it, first-time installers show a SmartScreen warning; auto-update
  still works. Deliberately out of scope.

---

## 2. Test debt: `EventTable.test.tsx` mocks the component it tests

**Severity:** the tests give confidence they have not earned.

`src/components/calendar/EventTable.test.tsx:88` calls
`vi.mock('./EventTable', ...)`, replacing the component under test with a
hand-written stub `<div>`. Its roughly 24 pre-existing tests therefore assert on
that stub, not on `EventTable`. This predates the migration.

The three Excel-export tests added in M5 deliberately work around it, using
`vi.importActual` to load the real component and capture the export function via
`onExportReady` — so they do exercise real behaviour. The rest do not.

Picking this up means rewriting those 24 tests against the real component.

---

## 3. Calendar performance: what's left after the post-sync freeze fix

A large sync used to leave the window unresponsive for ~30 seconds. Measured in
the running app, the cause was the event table: `pagination={false}` put every
matching row in the DOM, and committing that tree blocked the main thread for
**3459ms at a time, repeatedly**. Virtualising it (plus a numeric `scroll.y`,
which antd requires or it silently renders every row anyway) took the worst
block to **61ms**. Dropping 8.2MB of never-read `description` from the bulk
reads cut the payload from ~9MB to 3.21MB and the load from 1271ms to 191ms.

Two residuals were left deliberately:

- **`eventsByDate` build: 360-490ms** for 3,686 events. The cost is
  `dayjs.utc().tz()` per event — benchmarked at **14× the non-timezone path**,
  because dayjs's tz plugin constructs a fresh `Intl.DateTimeFormat` on every
  call. Creating one formatter and reusing it should cut this by close to an
  order of magnitude. **Not done because `src/hooks/useCalendarEvents.ts` has
  no tests at all**, and that loop decides which events land on which day — a
  timezone regression there would silently misplace events, which is far worse
  than 400ms. Write tests for the date grouping first, then optimise.

- **`tableEvents` recomputes several times per load, ~85ms each.** It repeats
  the same timezone conversions the map builder already did, so the formatter
  fix above would shrink these too. The churn itself is amplified by
  `App.tsx`'s `<CalendarView key={eventsRefreshKey} />`: using `key` to force a
  refresh **destroys and rebuilds the whole calendar subtree** rather than
  reloading data, which is visible in React's `commitDeletionEffectsOnFiber`
  frames. Replacing that with a data reload is the cheaper fix.

Also worth knowing: `App.tsx` switches screens with `display: none`, so
`CalendarView` is always mounted. Its sync-complete listener fires while the
user is on Settings — which is why the original freeze began before they had
even opened the calendar.

## 4. `get_events_in_range` compares ISO date strings lexicographically

`src-tauri/src/db/events.rs`. Ported faithfully from `electron/main.js:272` **on
purpose**, so that a behaviour change could not be mistaken for a Tauri
regression during the migration. It is fragile if Microsoft Graph ever returns
mixed offset formats.

The comparison was hand-verified as correct in the safe direction (it
under-selects rather than over-selects) for the formats currently stored, and
M4 added a test using the real runtime formats. Fixing it properly means
normalising stored dates, which is a data migration.

---

## 5. Smaller recorded follow-ups

Each was reviewed, judged non-blocking, and left deliberately.

- **`organizer` JSON key shape.** When a nested Graph field like
  `organizer.emailAddress.name` is absent, the original JavaScript dropped the
  key entirely (`JSON.stringify` omits `undefined`); the Rust port emits `""` and
  always includes both keys. `EventModal` treats them alike, and Graph always
  sends both in practice.
- **`type_manually_set = 0` is hardcoded** in the sync upsert's SQL text rather
  than bound as a parameter (`src-tauri/src/db/sync.rs`). A fixed constant, so no
  injection risk, but inconsistent with the file's bind-everything discipline.
- **The CSP is defined in two files that must be edited in pairs**, with nothing
  enforcing it: `src-tauri/tauri.conf.json` (injected as a header in the built
  app) and `index.html` (the only one that applies under `tauri dev`, since Vite
  serves that page and Tauri cannot add headers to it).
- **`std::sync::Mutex` poisoning is terminal.** One panic inside any database
  closure makes every later `Db::call` return `Unavailable` for the rest of the
  session. Nothing currently reachable can panic there.
- **`useCalendarViewEvents` has no callers.** Only `useCalendarEvents` is used,
  from `CalendarView.tsx`. Either wire it up or delete it.
- **The titlebar's draggable area is narrower than it looks.** A bare
  `data-tauri-drag-region` applies only to the element carrying it, so only the
  outer container's exposed gaps and the title text drag. Switching to `"deep"`
  would require excluding the sync-progress click target, whose `onClick` the
  drag handler would otherwise swallow.
- **`opener:allow-open-url` may be redundant** in
  `src-tauri/capabilities/default.json`. The Rust-side `app.opener().open_url()`
  bypasses the scope check, so the webview permission is probably unnecessary —
  but login is verified working with it present, so it was left alone. **Do not
  "fix" it by adding a URL-scope wildcard**; that would be strictly worse than
  leaving a redundant entry.
- **`DataManagement`'s event count** still fetches every event just to count
  them. A `count_events` command would be cheaper than pulling 8,924 rows.

---

## 6. Environment traps worth knowing

Not bugs, but each cost real diagnosis time.

- **Vitest collects zero tests from a lowercase drive letter.** Run
  `npm run test:run` from `d:\Dev\CalendarManager` and every file reports "No
  test suite found in file" — the suite looks completely broken. The identical
  command from `D:\Dev\CalendarManager` passes all 389. Check `pwd` first.
- **`npx tsc --noEmit` has never been clean** in this repository. It sits at 79
  errors, almost all pre-existing and unrelated to the migration. Judge changes
  by whether that number grows, never by whether it reaches zero.
- **Foreign keys are enforced in the Rust build** (`libsqlite3-sys` compiles
  SQLite with `-DSQLITE_DEFAULT_FOREIGN_KEYS=1`) where `better-sqlite3` left them
  off. This already changed one behaviour: deleting an in-use event type now
  reassigns its events to the default type rather than silently orphaning them.

## Test environment: what jsdom cannot check

The DataGrid work (2026-09-07) ran into a hard ceiling repeatedly: jsdom has
no layout engine, so a whole class of this app's behaviour is untestable in
the current suite. Each of these needed a workaround or a deferral:

- **dnd-kit cannot be driven at all.** Collision detection needs real element
  geometry and jsdom reports everything zero-sized. Row reorder and the Map
  Events drag have no end-to-end test; both are tested via their callbacks.
- **`getComputedStyle` is stubbed** in `src/test/setup.ts`, so `toHaveStyle`
  passes or fails for the wrong reason and theming is effectively untested.
- **Virtualization needs a faked viewport.** `@tanstack/react-virtual` sizes
  its window from `offsetHeight`, which jsdom reports as 0, and the
  virtualizer then returns an empty range — so the grid renders zero rows
  until a test stubs `offsetHeight` on `[data-grid-body-viewport]`.
- **Column autosize measures text**, which jsdom cannot do; its tests stub
  `getBoundingClientRect` to `textContent.length * 10`.
- **Scroll performance is unmeasurable.** EventTable's virtualization exists
  to fix a 1-3.5s main-thread block on a real 504-row month; nothing in the
  suite can detect a regression there.

### Two tiers worth adding, in order

1. **Vitest Browser Mode** (`@vitest/browser` + a Playwright provider; Vitest
   5 already supports it, neither package installed). Runs tests in real
   Chromium, which fixes every row above except the last. The grid is the
   best argument for it in this codebase. Note several stubs in
   `src/test/setup.ts` exist *because* of jsdom and would become unnecessary
   or actively misleading in a real browser, so this is a per-file opt-in,
   not a wholesale environment swap.
2. **`tauri-driver` + WebdriverIO** against the built app, for what neither
   jsdom nor a browser can reach: the WebView2 + Rust IPC path. The CSV
   export's native save dialog is the concrete case — `src/api/files.ts`
   exists because WebView2 silently ignores a Blob `<a download>`, and no
   browser test can prove the replacement actually writes a file.

Deliberately not done during the grid port: swapping the test environment
under a 1200-test suite mid-migration would have destabilised the thing being
used to prove the migration safe.

## `EventTable.test.tsx` mostly tests a fake table

Found during the DataGrid migration (2026-09-07), pre-existing and deliberately
left alone — fixing it means rewriting a large test file, which was out of
scope for a migration branch.

The file carries a module-level `vi.mock('./EventTable')`. Most of its older
cases therefore assert against a **hand-written fake table with its own eight
columns**, not the real component — they would pass if `EventTable` were
gutted. The eleven cases the migration added render the real component and are
the honest ones.

Compounding it, the file keeps `vi.mock('dayjs')` (whose `toDate()` returns a
constant and `diff()` always returns 60) because its filename and billable
assertions depend on that. The deviation is justified, but the consequence is
that **no test exercises the real Start/End chronological sort or the date-cell
formatting** — on the most date-heavy table in the app.

Worth doing as its own piece of work: drop the self-mock, let the real
component render (it now needs only an `offsetHeight` stub on
`[data-grid-body-viewport]` and the custom `render` from `src/test/utils`), and
split out the few cases that genuinely need a frozen clock so the rest can use
real dates.
