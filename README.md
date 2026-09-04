# Calendar Manager

A Windows desktop calendar application built with Tauri v2, React, and TypeScript, syncing with Microsoft Graph for calendar data.

## Features

- 🎨 **Modern UI**: Interface built with Ant Design components
- ⚡ **Fast Development**: Powered by Vite for hot reloading
- 🔒 **Secure**: OAuth tokens and database access live only in a Rust backend, never in the webview
- 📅 **Calendar View**: Interactive calendar with month/week views and event details
- 🗄️ **SQLite Database**: Local data storage with a Microsoft Graph compatible schema
- 🔄 **Calendar Sync**: Date-range sync against Microsoft Graph, with live progress
- 🚀 **Tauri**: Small, native desktop shell — no bundled Chromium

## Tech Stack

- **Frontend**: React 19 + TypeScript + Ant Design
- **Desktop shell**: Tauri v2 (Rust)
- **Build Tool**: Vite
- **Database**: SQLite (`rusqlite`, bundled)
- **Auth**: Loopback OAuth PKCE flow through the system browser

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20.19+ or v22.12+, per Vite 7's requirement)
- [Rust toolchain](https://www.rust-lang.org/tools/install) (stable; via `rustup`)
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) — included with modern Windows, but Tauri needs it present to render the app

### Microsoft Entra app registration

You need your own Entra app registration to sign in:

1. In the Entra admin center, register an application (or use an existing one).
2. Under **Authentication → Platform configurations**, add a **Mobile and desktop applications** platform with redirect URI exactly `http://localhost` — no port, no trailing slash, no path. Entra treats loopback redirects as port-agnostic, so this one entry covers whatever ephemeral port the app binds at login.
3. Under **Authentication → Advanced settings**, set **Allow public client flows** to **Yes**. This is the single most likely thing to miss — without it, sign-in fails with `AADSTS7000218`.
4. Under **API permissions**, grant the delegated scopes `User.Read`, `Calendars.Read`, and `Calendars.ReadWrite`.
5. Copy the **Application (client) ID** — you'll enter it into the app's setup screen on first launch.

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

3. Start the app in development mode:
```bash
npm start
```

This runs the Vite dev server and launches the Tauri window against it.

## Scripts

- `npm start` - Start the app in development mode (`tauri dev`)
- `npm run dev` - Start the Vite dev server only (frontend-only, no Tauri window)
- `npm run build` - Build the React frontend only
- `npm run build:app` - Build the full desktop application, including the installer (`tauri build`)
- `npm run test:run` - Run the frontend test suite once

## Project Structure

```
CalendarManager/
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── auth/       # Loopback PKCE login, token refresh, DPAPI-encrypted storage
│   │   ├── db/         # SQLite schema, migrations, queries
│   │   ├── graph/      # Microsoft Graph sync pipeline
│   │   ├── commands/   # Tauri command (IPC) handlers
│   │   └── lib.rs
│   └── tauri.conf.json
├── src/                # React application source
│   ├── api/            # Typed wrappers over Tauri's invoke()
│   ├── components/     # React components
│   ├── types/          # TypeScript type definitions
│   ├── hooks/          # Custom React hooks
│   ├── App.tsx         # Main App component
│   └── main.tsx        # React entry point
├── public/             # Static assets
└── dist/               # Build output (ignored by git)
```

## Data and Configuration

- The SQLite database (`calendar.db`) and the configuration store (`config.json`) live in `%APPDATA%/com.triowfs.calendarmanager/`, not in the repository.
- The refresh token is stored separately in that same directory, DPAPI-encrypted and bound to the current Windows user account — it is never written in plain text and never leaves the machine.

## Security Features

- Content Security Policy (CSP) restricting script, style and connection sources
- No Node.js access from the frontend; all backend operations go through typed Tauri commands
- Sign-in happens in the system browser, not an embedded webview, so the app never sees your Microsoft credentials
- Access and refresh tokens are handled only in the Rust backend

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- UI components from [Ant Design](https://ant.design/)
- Development powered by [Vite](https://vitejs.dev/)
