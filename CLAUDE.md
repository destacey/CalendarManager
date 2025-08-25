# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Primary development workflow:**
- `npm start` - Start the full Electron application in development mode (runs Vite dev server + Electron)
- `npm run dev` - Start only the Vite development server (for frontend-only testing)
- `npm run build` - Build the application for production
- `npm run electron` - Run Electron with already built files

**Testing:**
- `npm test` - Run tests in watch mode with Vitest
- `npm run test:run` - Run tests once and exit
- `npm run test:ui` - Run tests with Vitest UI for visual test management

**Build artifacts:**
- `dist/` - Vite build output (React frontend)
- `dist-electron/` - Electron build output

## Architecture Overview

### Electron + React Hybrid Architecture
This is a desktop Electron application with a React 19 frontend. The architecture follows a secure IPC pattern:

**Main Process (`electron/main.js`):**
- Database operations via better-sqlite3 (`calendar.db`)
- Configuration storage via electron-store 
- Window management and security (CSP headers)
- IPC handlers for all frontend operations

**Renderer Process (`src/`):**
- React 19 application with Ant Design UI
- No direct Node.js access (context isolation enabled)
- All backend operations via `window.electronAPI` IPC bridge

**Preload Script (`electron/preload.js`):**
- Secure context bridge between main and renderer
- Exposes typed `electronAPI` interface to frontend

### Application State Flow
The app follows a 4-stage state machine in `App.tsx`:
1. **loading** - Initial app startup
2. **setup** - Microsoft Graph app registration configuration
3. **login** - MSAL authentication flow  
4. **dashboard** - Main application interface

### Data Layer Architecture

**Local Storage:**
- SQLite database (`calendar.db`) with Graph-compatible schema
- `events` table: calendar events with Microsoft Graph sync metadata
- `categories` table: event categorization with color coding
- electron-store: application configuration (app registration, sync settings, timezone)

**Microsoft Graph Integration:**
- MSAL authentication (`@azure/msal-browser`) with proper scopes
- Microsoft Graph client (`@microsoft/microsoft-graph-client`) for calendar API
- Delta sync support for incremental updates
- Date-range sync with configurable windows

**Service Pattern:**
- `authService`: MSAL authentication and Graph client management
- `calendarService`: Sync operations, event processing, progress tracking
- `storageService`: Configuration persistence with Electron/localStorage fallback

### Calendar Sync Architecture

**Sync Types:**
- **Date Range Sync** (primary): Syncs events within configured date window
- **Delta Sync** (legacy): Incremental sync using Graph delta tokens

**Sync Process Flow:**
1. Authentication check via `authService`
2. Date range calculation from user timezone
3. Graph API paginated fetching (`/me/calendar/calendarView`)
4. Local database upsert via IPC (`syncGraphEvents`)
5. Cleanup of deleted events within sync window
6. Progress callbacks and completion reporting

**Key Sync Features:**
- Abort-able operations with `AbortController`
- Progress tracking with callbacks
- Offline detection and graceful degradation
- Multi-day event spanning with rendering metadata

### UI Component Architecture

**Layout Pattern:**
- `App.tsx`: State machine orchestrator
- `TitleBar`: Custom window controls with responsive navigation
- `SideNavigation`: Collapsible sidebar with responsive behavior
- `CalendarViewer`: Main calendar interface with month/week views

**Calendar Components:**
- `WeekView`: Advanced week view with time slots and event overlap handling
- `EventModal`: Event details and editing interface
- `SyncModal`/`SyncProgress`: Real-time sync progress and controls

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
The application uses **Vitest** with React Testing Library for component and utility testing:

- **Test Configuration**: `vitest.config.ts` - Configured for jsdom environment with React support
- **Test Setup**: `src/test/setup.ts` - Global test setup with mocks for Electron API and dayjs plugins
- **Test Utilities**: `src/test/utils.tsx` - Custom render function with providers and mock data
- **Test Coverage**: Run `npm run test:run` to generate coverage reports

### Testing Patterns
- **Component Tests**: Test user-visible behavior, not implementation details
- **Mock Electron API**: All `window.electronAPI` calls are mocked in test environment
- **Provider Wrapping**: Use custom `render()` from test utils to wrap components with necessary providers
- **Mock Data**: Use provided mock objects for consistent test data

### Test File Organization
- Place component tests next to components: `ComponentName.test.tsx`
- Place utility tests next to utilities: `utilityName.test.ts`
- Use descriptive test names and group related tests with `describe()` blocks

## Important Development Patterns

### IPC Communication
All database and system operations must go through the `electronAPI` bridge. Never attempt direct Node.js operations in renderer code.

```typescript
// Correct: Use electronAPI
const events = await window.electronAPI.getEvents()

// Incorrect: Direct Node.js access (will fail)
const fs = require('fs') // Not available in renderer
```

### Event Date Handling
The application uses dayjs with timezone plugins for all date operations. Events store ISO strings but display in user's configured timezone.

```typescript
// Always consider user timezone for display
const userTimezone = await storageService.getTimezone()
const localTime = dayjs.utc(event.start_date).tz(userTimezone)
```

### Sync Progress Management
Calendar sync operations support progress callbacks and are abortable. Always handle sync state properly in UI components.

```typescript
// Proper sync with progress tracking
calendarService.addSyncCallbacks(
  (progress) => setProgress(progress),
  (result) => handleSyncComplete(result)
)
```

### Configuration Storage
Use `storageService` methods which handle both Electron and development environments automatically.

```typescript
// Handles Electron store or localStorage fallback
await storageService.setAppRegistrationId(clientId)
```

### Security Considerations
- Content Security Policy configured for Microsoft Graph domains
- Context isolation enabled with secure preload script
- No inline scripts or unsafe-eval in production
- Sensitive data (access tokens) handled only in main process

## Microsoft Graph Integration

**Required Scopes:**
- `User.Read` - Basic user profile
- `Calendars.Read` - Read calendar events  
- `Calendars.ReadWrite` - Full calendar access

**API Endpoints Used:**
- `/me/calendar/calendarView` - Date-range event fetching
- `/me/calendar/events/delta` - Delta sync (legacy)

**Event Data Mapping:**
Graph events are transformed to local schema in `calendarService.transformGraphEventToLocal()`. Key mappings include categories as comma-separated strings and JSON serialization of complex objects.