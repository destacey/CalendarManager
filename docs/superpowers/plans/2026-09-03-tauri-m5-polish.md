# Tauri Migration M5: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one feature the migration silently broke, replace the last pathological data operation, and make the repository's own documentation describe the app that now exists.

**Architecture:** Three independent tasks. The Excel export moves from a browser Blob download to a native Save-As via Tauri's dialog and fs plugins — required, because WebView2 will not honour `<a download>` inside a Tauri window. "Clear all data" becomes one transactional command instead of 8,924 IPC round-trips. Then `CLAUDE.md` and `README.md` get rewritten from Electron to Tauri.

**Tech Stack:** `tauri-plugin-dialog`, `tauri-plugin-fs`, Rust, React 19.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`. This plan implements the **polish** milestone (M5). Read its "Follow-ups raised during M1 review" section, which assigns several items here.
- **Branch:** `feat/tauri-migration`. Do not merge to `main`.
- Rust command names `snake_case`; `src/api/` exposes camelCase. Domain **field** names stay `snake_case`.
- Every command that does I/O is `async fn`; database work goes through `Db::call`.
- **Do not touch** `src-tauri/src/graph/` or `src-tauri/src/auth/`. Both are reviewed, and the sync engine has just been verified against a live account.

### The trap that will waste your time

**Vitest collects zero tests from a lowercase drive letter.** From `d:\Dev\CalendarManager` every file reports "No test suite found in file" and the suite looks completely broken. Always `cd /d/Dev/CalendarManager` and confirm `pwd` prints `D:/Dev/CalendarManager`.

### Baseline entering this milestone

213 Rust tests, 386 frontend tests, 32 commands, `tsc` at 79 errors. Dependencies are already clean — Electron, MSAL, `better-sqlite3`, `electron-store` and `@microsoft/microsoft-graph-client` are all gone, and `window.electronAPI` no longer exists anywhere.

### Already resolved — do not spend work on these

Two items recorded as follow-ups turn out not to need fixing:

- **The `is_default` invariant hole is unreachable from the UI.** `EventTypesSettings.tsx`'s modal registers only `name`, `color` and `is_billable` as `Form.Item`s; `is_default` is display-only, and a default is set exclusively through `set_default_event_type`, which clears the others in one transaction. There is no path by which `create_event_type`/`update_event_type` receive `is_default: true` from this app.
- **The timezone carry-over concern was moot.** The legacy Electron value was `null`, so there was never a configured timezone to lose.

---

## File Structure

**Created:** `src-tauri/src/commands/export.rs` (or extend `commands/db.rs` — see Task 2), `src/api/files.ts`

**Modified:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/db/events.rs`, `src-tauri/capabilities/default.json`, `src/components/calendar/EventTable.tsx`, `src/components/DataManagement.tsx`, `src/api/events.ts`, `CLAUDE.md`, `README.md`, `.gitignore`

---

### Task 1: Excel export via a native Save-As

**This is the one feature the migration silently broke.** `EventTable.tsx:247-258` generates the workbook, wraps it in a `Blob`, creates an object URL, and clicks a synthetic `<a download>`. That is a browser idiom: **WebView2 will not honour it inside a Tauri window**, so the button currently does nothing visible. Nobody has noticed because nobody has clicked it since M1.

`exceljs` stays — it is pure JavaScript and generates the buffer fine. Only delivery changes.

**Files:**
- Create: `src/api/files.ts`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src/components/calendar/EventTable.tsx`
- Test: `src/components/calendar/EventTable.test.tsx`

**Interfaces produced:**
- `src/api/files.ts`: `saveFile(defaultName: string, bytes: Uint8Array, filterName: string, extensions: string[]): Promise<boolean>` — opens a Save-As dialog, writes the bytes, and returns `false` if the user cancelled.

- [ ] **Step 1: Add the plugins**

In `src-tauri/Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

Register both in `src-tauri/src/lib.rs`'s builder, beside the existing `tauri_plugin_store` and `tauri_plugin_opener` registrations. **Preserve everything already in that builder**, including the `setup` hook and all 32 commands.

In `src-tauri/capabilities/default.json`, add `"dialog:allow-save"` and `"fs:allow-write-file"`. Do not remove or reorder existing permissions.

**On `fs` scope:** `tauri-plugin-fs` is scoped by default and will refuse a path outside its allowlist. The path here comes from the user's own Save-As dialog, which is exactly what `fs:allow-write-file` combined with the dialog plugin's returned path is designed for — the dialog grants access to the chosen file. If a write is nonetheless refused at runtime, **report it rather than widening the scope to `$HOME/**` or similar**; a broad filesystem grant would undo the capability model this migration adopted deliberately.

- [ ] **Step 2: Write the failing test**

`EventTable.test.tsx` already mocks `exceljs` (line 16). Add a mock for the new module and assert the export path calls it. Replace whatever currently asserts on the Blob/anchor mechanism:

```typescript
vi.mock('../../api/files', () => ({
  saveFile: vi.fn(() => Promise.resolve(true)),
}))
```

Then tests asserting: clicking Export calls `saveFile` with a filename matching `/^Calendar Export \d{4}-\d{2}-\d{2} \d{4}\.xlsx$/`, an `xlsx` extension filter, and a non-empty byte array; that a cancelled dialog (`saveFile` resolving `false`) shows no success message and does not throw; and that a rejected `saveFile` surfaces an error message rather than failing silently.

- [ ] **Step 3: Run to verify failure**

```bash
cd /d/Dev/CalendarManager && pwd && npx vitest run src/components/calendar/EventTable.test.tsx
```

Expected: FAIL — `Cannot find module '../../api/files'`.

- [ ] **Step 4: Create the wrapper**

Create `src/api/files.ts`, following the shape of `src/api/config.ts`:

```typescript
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
    filters: [{ name: filterName, extensions }],
  })

  if (!path) return false

  await writeFile(path, bytes)
  return true
}
```

Install the JS sides: `npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-fs`.

- [ ] **Step 5: Rewire the export**

In `EventTable.tsx`, replace the Blob-and-anchor block (currently around `:247-258`) with:

```typescript
    const buffer = await workbook.xlsx.writeBuffer()
    const saved = await saveFile(
      fileName,
      new Uint8Array(buffer as ArrayBuffer),
      'Excel Workbook',
      ['xlsx']
    )

    if (saved) {
      messageApi.success(`Exported ${exportData.length} events`)
    }
```

Keep the existing filename generation and the surrounding try/catch, and make sure the catch surfaces a message — a failed export must not be silent, which is the failure mode this task exists to fix. Read the component to match its existing message API and error handling rather than assuming.

- [ ] **Step 6: Run to verify pass, then the full suite**

```bash
cd /d/Dev/CalendarManager && pwd && npx vitest run src/components/calendar/EventTable.test.tsx && npm run test:run
```

- [ ] **Step 7: Verify the Rust side compiles**

```bash
cd /d/Dev/CalendarManager/src-tauri && cargo check
```

- [ ] **Step 8: Commit**

Write your own message. Lead with the fact that the button was silently doing nothing, and why: a Blob download is a browser idiom WebView2 does not honour in a Tauri window.

---

> **The same deviation as the last two plans, stated again for a fresh reader.**
> Task 1 gives literal code. Task 2 specifies its tests as enumerated cases
> naming input and expected outcome; Task 3 is documentation and has none. If an
> enumerated case is ambiguous when you reach it, stop and ask rather than guess.

### Task 2: One transactional "clear all data"

`DataManagement.tsx:62-69` loops over every event and awaits `deleteEvent(event.id)` individually. Against the user's real database that is **8,924 IPC round-trips, each its own transaction and fsync**. It is slow enough to look hung, and it is **not atomic** — a failure partway leaves a half-emptied database with no way to tell how far it got.

**Files:**
- Modify: `src-tauri/src/db/events.rs`, `src-tauri/src/commands/db.rs`, `src-tauri/src/lib.rs`, `src/api/events.ts`, `src/components/DataManagement.tsx`
- Test: inline in `db/events.rs`, and `src/components/DataManagement.test.tsx` if one exists

**Interfaces produced:**
- `pub fn delete_all_events(conn: &Connection) -> DbResult<u32>` — returns the number of rows deleted.
- Command `delete_all_events` (taking the count to 33), and `deleteAllEvents()` in `src/api/events.ts`.

- [ ] **Step 1: Write the failing tests** in `db/events.rs`: deleting all events from a populated table returns the row count and leaves the table empty; it returns 0 on an already-empty table; **it leaves `event_types`, `event_type_rules` and `categories` untouched** — that last one is the guard that matters, because the user's 3 types and 2 rules are the data Graph cannot recreate, and a careless `DELETE` cascade or a wrong table name would take them out. Note foreign keys are enforced in this build, so deleting events while types reference them must still work (the reference points the other way — `events.type_id` → `event_types.id` — so this is safe, but assert it).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — a single `DELETE FROM events`, returning `changes()`. No transaction wrapper is needed for one statement, but say so in a comment so nobody adds one thinking it was forgotten.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Wire the command** and register it. Confirm 33.
- [ ] **Step 6: Rewire `DataManagement.tsx`** to call `deleteAllEvents()` once, using its returned count for the confirmation message. Keep the existing `setSyncMetadata` reset that follows it, and keep the confirmation modal. If `getEvents` was only being fetched to drive the loop, stop fetching it.
- [ ] **Step 7: Verify.** `cargo test`, then `npm run test:run` from the uppercase path.
- [ ] **Step 8: Commit** with your own message. Lead with the atomicity, not the speed: 8,924 separate transactions could leave the database half-emptied.

---

### Task 3: Make the documentation describe the app that exists

`CLAUDE.md` and `README.md` both still document the Electron architecture. Each currently carries a staleness banner added during M1, which was the right stopgap — this task removes the need for it.

This matters more than ordinary doc hygiene: `CLAUDE.md` is the file agents read as the authority on how this codebase works, and it currently tells them to add `window.electronAPI` call sites, complete with an example labelled **"Correct"**. It has been actively misdirecting for four milestones.

**Files:** Modify `CLAUDE.md`, `README.md`, `.gitignore`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Rewrite `CLAUDE.md`.** Remove the staleness banner. Update, at minimum:
  - **Development commands** — `npm start` is `tauri dev`; `npm run build` builds only the frontend; `npm run build:app` builds the desktop app; `npm run electron` no longer exists.
  - **Architecture** — replace the Electron main/renderer/preload description with the Tauri one: a Rust backend in `src-tauri/src/` (`auth/`, `db/`, `graph/`, `commands/`), a React frontend, and typed wrappers in `src/api/` over `invoke`. `electron/` is gone.
  - **The IPC section** — currently says "All database and system operations must go through the `electronAPI` bridge" with a `window.electronAPI.getEvents()` example marked "Correct". Replace with `src/api/` usage. **This is the single most important edit in the task.**
  - **Data layer** — `rusqlite` with a versioned migration runner on `PRAGMA user_version`, the database in `app_data_dir()`, `tauri-plugin-store` for config. Note that foreign keys are **enforced** here where `better-sqlite3` left them off.
  - **Auth** — the loopback PKCE flow through the system browser, tokens held only in Rust, the refresh token in a DPAPI-encrypted file. Note that `msal-browser` cannot work under Tauri's origin, so nobody reintroduces it.
  - **Sync** — the Rust streaming pipeline, the `sync-status`/`sync-complete` event contract, and that the delta path was deliberately removed.
  - **Storage/config** — drop the localStorage-fallback paragraph; that path no longer exists.
  - **Testing** — the `window.electronAPI` mock is gone; tests mock `src/api/` modules. **Add the drive-letter trap** — it has cost real diagnosis time twice.
  - Keep the file's existing structure and tone. Do not turn it into a changelog; it documents the current state.

- [ ] **Step 2: Rewrite `README.md`.** Remove its banner. It is the outward-facing description, so keep it shorter than `CLAUDE.md`: what the app does, the prerequisites (Node, Rust toolchain, WebView2), how to run and build it, the Entra app-registration setup a new user needs (Mobile and desktop applications platform, redirect URI `http://localhost`, **Allow public client flows enabled**), and where the data lives. Remove every reference to `electron/main.js` and the dead scripts.

- [ ] **Step 3: Clean `.gitignore`.** Remove `dist-electron/` and the `# Electron` block. Keep `src-tauri/target/` and `src-tauri/gen/`.

- [ ] **Step 4: Tidy the capability allowlist.** Remove `core:window:allow-is-maximized` — it is already granted by `core:default` via `core:window:default`.

  **Do not remove `opener:allow-open-url`.** An M1 review argued it is dead because the Rust-side `app.opener().open_url()` bypasses the scope check, and that is probably right — but it is the permission the login flow appears to depend on, login has been verified working with it present, and JSON cannot carry a comment explaining a subtlety. Instead, extend the file's `description` field to record that the entry may be redundant and why nobody should "fix" it by adding a URL scope wildcard.

- [ ] **Step 5: Verify.** `npm run test:run` from the uppercase path (docs changes should not affect it), and `cd src-tauri && cargo check`.

- [ ] **Step 6: Commit** with your own message. Worth conveying: `CLAUDE.md` had been telling agents to write `window.electronAPI` call sites for four milestones.

---

## Definition of Done

- [ ] `cd src-tauri && cargo test` — all green; report the total.
- [ ] `npm run test:run` from an uppercase drive letter — green.
- [ ] 33 commands registered.
- [ ] `grep -rniE "electron" CLAUDE.md README.md .gitignore` returns nothing but historical context, if anything.
- [ ] `grep -rn "createObjectURL\|link.download" src/` returns nothing.
- [ ] `npx tsc --noEmit 2>&1 | grep -c "error TS"` reported; the 79 baseline should not grow.

**Manual gate — only the user can run this:**

1. Calendar → Export. **A native Save-As dialog opens**, and the saved `.xlsx` opens in Excel with the right rows. This button has silently done nothing since M1.
2. Cancel the Save-As dialog: no error, no success message, nothing written.
3. Data Management → **note the event count**, then Clear All Data. It completes quickly and the count goes to zero.
4. **Settings → Event Types still lists your 3 types, and Event Type Rules still lists your 2 rules.** Clearing events must not touch them — this is the check that matters.
5. Sync again to repopulate, and confirm the count returns to roughly what it was.

Step 4 is the important one. Step 3 was previously 8,924 separate transactions and could leave the database half-emptied.

## Follow-ups deliberately left open

Recorded so they are not rediscovered:

- `get_events_in_range` compares ISO date strings lexicographically — ported deliberately so a behaviour change could not be mistaken for a Tauri regression.
- The `organizer` JSON key-shape divergence when a nested Graph field is absent (Rust emits `""`, the original dropped the key).
- `type_manually_set = 0` hardcoded in the upsert's SQL text rather than bound.
- The CSP is defined in two files that must be edited in pairs, with nothing linking them.
- `std::sync::Mutex` poisoning is terminal for the session.
- `useCalendarViewEvents` has no callers.
- The drag region is narrower than it looks — only the titlebar's exposed gaps and the title text.

## Next

M6 (installer, signing keypair, GitHub Actions, updater UI) gets its own plan.
