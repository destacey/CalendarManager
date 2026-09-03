# Calendar Manager

> ## ⚠️ Migration in progress: Electron → Tauri
>
> This project is migrating from Electron to Tauri v2. **The Electron
> architecture described below is stale** and is rewritten in milestone M5.
>
> - **Design spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`
> - **Backend:** Rust, in `src-tauri/`. `electron/` is deleted.
> - **Frontend → backend calls:** typed wrappers in `src/api/`, over Tauri
>   `invoke()`. **Do not add `window.electronAPI` call sites** — the remaining
>   ones are legacy and are being removed milestone by milestone.
> - **Config:** `tauri-plugin-store` via Rust commands. No `electron-store`,
>   no localStorage fallback.
> - **Run the app:** `npm start` (`tauri dev`). `npm run build` builds only the
>   frontend; `npm run build:app` builds the desktop app.
> - **Known incomplete:** the database layer (M2), authentication (M3), and
>   Graph sync (M4) still reference the deleted Electron bridge and throw at
>   runtime. This is expected.
>
> **The bundle identifier `com.triowfs.calendarmanager` in
> `src-tauri/tauri.conf.json` is permanent.** `app_data_dir()` derives from it
> and M2's database migration keys off that path. Changing it makes the app
> start against an empty database at a new location.

A modern Electron-based calendar application built with React, TypeScript, and Ant Design, designed to integrate with Microsoft Graph API for calendar synchronization.

## Features

- 🎨 **Modern UI**: Beautiful interface built with Ant Design components
- ⚡ **Fast Development**: Powered by Vite for lightning-fast hot reloading
- 🔒 **Secure**: Proper Content Security Policy and Electron security best practices
- 📅 **Calendar View**: Interactive calendar with event display and details
- 🗄️ **SQLite Database**: Local data storage with Microsoft Graph compatible schema
- 🔄 **React 19**: Latest React with TypeScript support
- 🚀 **Electron**: Cross-platform desktop application

## Tech Stack

- **Frontend**: React 19 + TypeScript + Ant Design
- **Desktop**: Electron
- **Build Tool**: Vite
- **Database**: SQLite (better-sqlite3)
- **Styling**: Ant Design + CSS

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd CalendarManager
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

## Scripts

- `npm start` - Start the Electron application in development mode
- `npm run dev` - Start Vite development server only
- `npm run build` - Build the application for production
- `npm run preview` - Preview the production build
- `npm run electron` - Run Electron with built files

## Project Structure

```
CalendarManager/
├── electron/           # Electron main process files
│   ├── main.js        # Main Electron process
│   └── preload.js     # Preload script for secure IPC
├── src/               # React application source
│   ├── components/    # React components
│   ├── types/         # TypeScript type definitions
│   ├── hooks/         # Custom React hooks
│   ├── App.tsx        # Main App component
│   └── main.tsx       # React entry point
├── public/            # Static assets
└── dist/              # Build output (ignored by git)
```

## Database Schema

The application uses SQLite with a schema designed for Microsoft Graph calendar integration:

- **events**: Calendar events with Graph-compatible fields
- **categories**: Event categories with color coding

## Security Features

- Content Security Policy (CSP) headers
- Context isolation enabled
- Node integration disabled
- Secure IPC communication via preload scripts

## Future Features

- [ ] Microsoft Graph API integration
- [ ] OAuth authentication
- [ ] Real-time calendar synchronization
- [ ] Event creation and editing
- [ ] Multiple calendar support
- [ ] Offline capability

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Acknowledgments

- Built with [Electron](https://electronjs.org/)
- UI components from [Ant Design](https://ant.design/)
- Development powered by [Vite](https://vitejs.dev/)