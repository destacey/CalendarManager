# Tauri Migration M2: Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@azure/msal-browser` with an OAuth 2.0 authorization-code + PKCE flow implemented in Rust, so the user signs in through their real system browser and access tokens never reach the webview.

**Architecture:** Rust generates a PKCE verifier and challenge, binds an ephemeral loopback listener on `127.0.0.1:0`, opens the Entra authorize URL in the system browser, catches the redirect, and exchanges the code for tokens server-side where no CORS policy applies. The refresh token goes to Windows Credential Manager; the access token stays in memory in Tauri state. The frontend gets five commands and never sees a token.

**Tech Stack:** Rust (`reqwest`, `tiny_http`, `keyring`, `sha2`, `base64`, `uuid`, `serde`), Tauri v2, `tauri-plugin-opener`, React 19.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`. This plan implements the **auth** milestone (M2 after the reorder recorded in that spec).
- **Branch:** `feat/tauri-migration`. Do not merge to `main`.
- **Authority:** `https://login.microsoftonline.com/organizations` — organizations, not `common` and not a tenant GUID. This matches the existing `src/services/auth.ts:20`.
- **Scopes requested:** exactly `offline_access User.Read Calendars.Read Calendars.ReadWrite`. `offline_access` is what yields the refresh token; the other three match today's behaviour.
- **`prompt=select_account`** on the authorize request, matching `src/services/auth.ts:53`.
- **Query encoding:** the authorization request query is
  `application/x-www-form-urlencoded` per RFC 6749 §3.1 — so the redirect URI
  is percent-encoded and the scope string's spaces become `+`, not `%20`.
  `Url::query_pairs_mut` produces exactly this, and Entra accepts it.
- **Redirect URI:** `http://localhost:{port}` where `{port}` is the OS-assigned port from binding `127.0.0.1:0`. Entra treats loopback redirects as port-agnostic, so the single registered `http://localhost` entry covers every port.
- **Loopback bind address is `127.0.0.1`, never `0.0.0.0`.** Binding all interfaces would expose the authorization code catcher to the local network.
- **The `state` parameter must be verified** on the redirect before the code is used, and a mismatch must abort the login. This is CSRF protection, not optional.
- **Tokens must never cross the IPC boundary.** No command returns an access token, a refresh token, or an `id_token`. If a later milestone needs Graph data, Rust fetches it.
- **Login timeout:** 5 minutes, after which the listener shuts down and the login fails cleanly.
- Rust commands are `snake_case`; `src/api/` wrappers expose `camelCase`. `src/api/` is the only place the two conventions meet.
- Rust dependency versions use major-version ranges where the crate is post-1.0 (`"1"`, `"2"`, `"3"`), and `"0.12"`-style minor pins only for pre-1.0 crates.
- Commands doing I/O must be `async` (`#[tauri::command]` on an `async fn`). A non-async command body runs inline in the IPC handler and would freeze the window.
- **Do not touch** anything under `src/components/calendar/`, `src/utils/`, `src/hooks/`, or `src/contexts/`.

### Prerequisite the user must complete (blocking, manual)

In the Entra app registration:

1. **Authentication → Add a platform → Mobile and desktop applications**, redirect URI exactly `http://localhost` — no port, no trailing slash, no path.
2. **Authentication → Advanced settings → Allow public client flows → Yes.** Without this the token endpoint rejects the PKCE exchange with `AADSTS7000218`. This is the single most likely blocker in this milestone.
3. Leave the existing Single-page application platform entry in place for now; the M5 milestone removes it.

API permissions are unchanged: `User.Read`, `Calendars.Read`, `Calendars.ReadWrite` delegated.

### Expected intermediate state

- The **database** is still not ported (that is now M3), so every screen past the dashboard shell throws at runtime. Reaching the dashboard at all is this milestone's win.
- `src/services/calendar.ts` is untouched and still references `window.electronAPI`. Sync is M4.
- The `ElectronAPI` interface in `src/types/index.ts` and the `window.electronAPI` mock in `src/test/setup.ts` stay for the database surface. M3 removes what remains.
- `npx tsc --noEmit` is **not** clean and never has been: 108 pre-existing errors. Judge by baseline, never by a clean run. Deleting MSAL should *remove* errors, not add them.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src-tauri/src/auth/mod.rs` | Auth module tree; the `AuthState` held in Tauri state |
| `src-tauri/src/auth/pkce.rs` | PKCE verifier/challenge generation, `state` nonce, authorize-URL building — pure, unit-tested |
| `src-tauri/src/auth/loopback.rs` | Ephemeral `127.0.0.1` listener that captures `code` + `state` |
| `src-tauri/src/auth/tokens.rs` | Token exchange, refresh, expiry, Credential Manager storage |
| `src-tauri/src/auth/error.rs` | `AuthError` enum, serialized to the frontend |
| `src-tauri/src/commands/auth.rs` | `login`, `cancel_login`, `logout`, `get_account`, `has_session` |
| `src/api/auth.ts` | Typed wrapper over those five commands |

**Modified:**

| Path | Change |
| --- | --- |
| `src-tauri/Cargo.toml` | Add `reqwest`, `tiny_http`, `keyring`, `sha2`, `base64`, `uuid`, `url`, `thiserror`, `tauri-plugin-opener` |
| `src-tauri/src/lib.rs` | Register the auth commands, the opener plugin, and `AuthState` |
| `src-tauri/src/commands/mod.rs` | Add `pub mod auth;` |
| `src-tauri/capabilities/default.json` | Add `opener:allow-open-url` |
| `src/services/auth.ts` | 138 lines → ~35; MSAL deleted |
| `src/App.tsx:44-84` | Collapse the MSAL redirect dance to a `has_session` check |
| `src/components/Login.tsx:15-25` | Await a real result instead of a page navigation |
| `src/components/UserMenu.tsx` | Read the account from Rust instead of a Graph client |
| `package.json` | Remove `@azure/msal-browser`, `@azure/msal-node`, `@microsoft/microsoft-graph-client` |

**Deleted:** nothing on disk; MSAL leaves via `package.json`.

---

### Task 1: PKCE and the authorize URL

Pure functions with no I/O — the ideal first Rust unit-testing target.

**Files:**
- Create: `src-tauri/src/auth/mod.rs`, `src-tauri/src/auth/pkce.rs`, `src-tauri/src/auth/error.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct PkcePair { pub verifier: String, pub challenge: String }`
  - `pub fn generate_pkce() -> PkcePair`
  - `pub fn generate_state() -> String`
  - `pub fn authorize_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String`
  - `pub const SCOPES: &str = "offline_access User.Read Calendars.Read Calendars.ReadWrite";`
  - `pub const AUTHORITY: &str = "https://login.microsoftonline.com/organizations";`
  - `pub enum AuthError` (in `error.rs`) implementing `std::error::Error` and `serde::Serialize`.

- [ ] **Step 1: Add the dependencies**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
tiny_http = "0.12"
keyring = { version = "3", features = ["windows-native"] }
sha2 = "0.10"
base64 = "0.22"
uuid = { version = "1", features = ["v4"] }
url = "2"
thiserror = "2"
tauri-plugin-opener = "2"
```

Two notes on these choices:

- `reqwest` uses `rustls-tls` with `default-features = false` deliberately: the default feature set pulls `native-tls`/OpenSSL, which is exactly the kind of native-build dependency this migration exists to escape.
- `uuid` v4 supplies the randomness for both the PKCE verifier and the `state` nonce. `rand`'s API changed shape across recent major versions; `Uuid::new_v4()` has been stable for years, and two concatenated UUIDs give 256 bits of entropy in 64 unreserved characters — comfortably inside PKCE's 43-128 character requirement.

- [ ] **Step 2: Write the failing tests**

First register the module, or the test file is not part of the crate and Step 3
reports "0 tests filtered out" instead of the compile error it expects. Create
`src-tauri/src/auth/mod.rs` with `pub mod error;` and `pub mod pkce;`, add
`mod auth;` to `src-tauri/src/lib.rs` beside `mod commands;`, and create
`src-tauri/src/auth/error.rs` with the contents given in Step 6.

Then create `src-tauri/src/auth/pkce.rs` containing **only** the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_is_within_the_pkce_length_range() {
        let pair = generate_pkce();
        assert!(
            pair.verifier.len() >= 43 && pair.verifier.len() <= 128,
            "verifier was {} chars, RFC 7636 requires 43-128",
            pair.verifier.len()
        );
    }

    #[test]
    fn verifier_uses_only_unreserved_characters() {
        let pair = generate_pkce();
        assert!(
            pair.verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' || c == '~'),
            "verifier contained a reserved character: {}",
            pair.verifier
        );
    }

    #[test]
    fn challenge_is_the_base64url_sha256_of_the_verifier() {
        // RFC 7636 Appendix B's published test vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn challenge_is_unpadded() {
        let pair = generate_pkce();
        assert!(!pair.challenge.contains('='), "challenge must not be padded");
    }

    #[test]
    fn each_pkce_pair_is_unique() {
        assert_ne!(generate_pkce().verifier, generate_pkce().verifier);
    }

    #[test]
    fn each_state_is_unique() {
        assert_ne!(generate_state(), generate_state());
    }

    #[test]
    fn authorize_url_carries_every_required_parameter() {
        let url = authorize_url(
            "client-abc",
            "http://localhost:54321",
            "challenge-xyz",
            "state-123",
        );

        assert!(url.starts_with(
            "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?"
        ));
        assert!(url.contains("client_id=client-abc"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=challenge-xyz"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-123"));
        assert!(url.contains("prompt=select_account"));
    }

    #[test]
    fn authorize_url_encodes_the_redirect_and_scopes() {
        let url = authorize_url("c", "http://localhost:1234", "ch", "st");

        // The redirect URI is percent-encoded.
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A1234"));

        // Scope spaces become '+', not '%20'. RFC 6749 section 3.1 specifies
        // the authorization request query in application/x-www-form-urlencoded
        // form, which is what Url::query_pairs_mut emits; Entra accepts it.
        // Asserting the exact encoding means a silent change gets caught here
        // rather than against the live endpoint.
        assert!(url.contains(
            "scope=offline_access+User.Read+Calendars.Read+Calendars.ReadWrite"
        ));

        // What must never appear is a raw, unencoded space anywhere in the URL.
        assert!(!url.contains(' '), "authorize URL contained a raw space: {url}");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test auth::pkce
```

Expected: FAIL to compile — `cannot find function generate_pkce in this scope`, and the same for `challenge_for`, `generate_state`, `authorize_url`.

- [ ] **Step 4: Write the implementation**

Prepend to `src-tauri/src/auth/pkce.rs`, above the test module:

```rust
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

/// `organizations` rather than `common`: this app is for work/school accounts,
/// matching the authority the MSAL implementation used.
pub const AUTHORITY: &str = "https://login.microsoftonline.com/organizations";

/// `offline_access` is what earns the refresh token; the rest match the
/// permissions granted on the app registration.
pub const SCOPES: &str = "offline_access User.Read Calendars.Read Calendars.ReadWrite";

pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

/// Two UUIDs give ~244 bits of entropy across 64 unreserved characters, inside
/// RFC 7636's 43-128 range. (A v4 UUID has 6 of its 128 bits fixed as version
/// and variant markers, so each contributes 122 random bits, not 128.)
/// `Uuid::new_v4` is a stabler source than `rand`, whose API has shifted across
/// major versions, and the uuid crate's v4 feature already draws from
/// getrandom, so the randomness is OS-CSPRNG quality either way.
pub fn generate_pkce() -> PkcePair {
    let verifier = format!(
        "{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let challenge = challenge_for(&verifier);
    PkcePair { verifier, challenge }
}

pub fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn generate_state() -> String {
    Uuid::new_v4().simple().to_string()
}

pub fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> String {
    let mut url = Url::parse(&format!("{AUTHORITY}/oauth2/v2.0/authorize"))
        .expect("authority is a compile-time constant and always parses");

    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("prompt", "select_account");

    url.into()
}
```

`Url::query_pairs_mut` handles the percent-encoding, which is why the redirect URI and the space-separated scopes come out well-formed rather than needing manual escaping.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test auth::pkce
```

Expected: PASS, 8 tests. The RFC test vector in `challenge_is_the_base64url_sha256_of_the_verifier` is the one that proves the challenge derivation is actually correct rather than merely self-consistent — if that fails, the base64 alphabet or padding is wrong.

- [ ] **Step 6: Create the error type**

Create `src-tauri/src/auth/error.rs`:

```rust
use serde::{Serialize, Serializer};

/// Auth failures the frontend may need to distinguish. Serializes to a plain
/// string for the IPC boundary, but stays a real enum in Rust so call sites
/// can match on it.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("No app registration ID is configured")]
    NotConfigured,

    #[error("A login is already in progress")]
    LoginInProgress,

    #[error("Login was cancelled")]
    Cancelled,

    #[error("Login timed out")]
    TimedOut,

    #[error("The sign-in response did not match this login attempt")]
    StateMismatch,

    #[error("Not signed in")]
    NoSession,

    #[error("Microsoft rejected the sign-in: {0}")]
    Provider(String),

    #[error("Network error talking to Microsoft: {0}")]
    Network(String),

    #[error("Could not access the Windows Credential Manager: {0}")]
    Keyring(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AuthError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AuthResult<T> = Result<T, AuthError>;
```

- [ ] **Step 7: Wire the module in**

Create `src-tauri/src/auth/mod.rs`:

```rust
pub mod error;
pub mod pkce;
```

In `src-tauri/src/lib.rs`, add `mod auth;` beside the existing `mod commands;`.

- [ ] **Step 8: Verify the crate compiles with no warnings**

```bash
cd src-tauri && cargo test auth
```

Expected: 8 tests pass, zero warnings. Dead-code warnings for the not-yet-used `AuthError` variants are acceptable at this task only — note them in your report.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/auth/
git commit -m "feat(auth): add PKCE generation and authorize-URL building

Pure functions with no I/O, covered by 8 unit tests including RFC 7636
Appendix B's published S256 test vector so the challenge derivation is
verified against the spec rather than only against itself.

uuid supplies the entropy rather than rand: two v4 UUIDs give 256 bits
across 64 unreserved characters, and the API is stabler across versions.
reqwest takes rustls-tls with default features off, to avoid pulling the
OpenSSL native build this migration exists to escape."
```

---

### Task 2: The loopback redirect catcher

**Files:**
- Create: `src-tauri/src/auth/loopback.rs`
- Modify: `src-tauri/src/auth/mod.rs`
- Test: inline `#[cfg(test)]` in `loopback.rs`

**Interfaces:**
- Consumes: `AuthError`, `AuthResult` from Task 1.
- Produces:
  - `pub struct Loopback { port: u16, server: tiny_http::Server }`
  - `pub fn bind() -> AuthResult<Loopback>`
  - `impl Loopback { pub fn port(&self) -> u16; pub fn redirect_uri(&self) -> String; pub fn wait_for_code(self, expected_state: &str, timeout: Duration, cancelled: &AtomicBool) -> AuthResult<String> }`
  - `pub fn parse_redirect_query(query: &str) -> Result<RedirectParams, AuthError>` where `RedirectParams { code: String, state: String }`

`wait_for_code` returns just the authorization code, having already verified the state. Consuming `self` guarantees the listener is dropped and the port released.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/auth/loopback.rs` with only the tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_successful_redirect() {
        let params = parse_redirect_query("code=abc123&state=xyz789").unwrap();
        assert_eq!(params.code, "abc123");
        assert_eq!(params.state, "xyz789");
    }

    #[test]
    fn percent_decodes_the_code() {
        // Entra's codes routinely contain characters that arrive encoded.
        let params = parse_redirect_query("code=a%2Bb%2Fc&state=s").unwrap();
        assert_eq!(params.code, "a+b/c");
    }

    #[test]
    fn ignores_parameter_order_and_extra_parameters() {
        let params =
            parse_redirect_query("session_state=q&state=xyz&code=abc&client_info=z").unwrap();
        assert_eq!(params.code, "abc");
        assert_eq!(params.state, "xyz");
    }

    #[test]
    fn surfaces_a_provider_error_with_its_description() {
        let error = parse_redirect_query(
            "error=access_denied&error_description=User+cancelled+the+flow",
        )
        .unwrap_err();

        match error {
            AuthError::Provider(message) => {
                assert!(message.contains("access_denied"));
                assert!(message.contains("User cancelled the flow"));
            }
            other => panic!("expected Provider, got {other:?}"),
        }
    }

    #[test]
    fn rejects_a_redirect_with_no_code() {
        assert!(matches!(
            parse_redirect_query("state=xyz").unwrap_err(),
            AuthError::Provider(_)
        ));
    }

    #[test]
    fn binds_to_an_ephemeral_port_on_loopback_only() {
        let loopback = bind().unwrap();
        assert!(loopback.port() > 0);
        assert_eq!(
            loopback.redirect_uri(),
            format!("http://localhost:{}", loopback.port())
        );
    }

    #[test]
    fn two_binds_get_different_ports() {
        let first = bind().unwrap();
        let second = bind().unwrap();
        assert_ne!(first.port(), second.port());
    }

    #[test]
    fn captures_the_code_from_a_real_request() {
        let loopback = bind().unwrap();
        let port = loopback.port();
        let cancelled = AtomicBool::new(false);

        std::thread::spawn(move || {
            // Give the listener a moment to reach accept().
            std::thread::sleep(Duration::from_millis(100));
            let _ = std::net::TcpStream::connect(("127.0.0.1", port)).map(|mut stream| {
                use std::io::Write;
                let _ = stream.write_all(
                    b"GET /?code=real-code&state=real-state HTTP/1.1\r\nHost: localhost\r\n\r\n",
                );
            });
        });

        let code = loopback
            .wait_for_code("real-state", Duration::from_secs(5), &cancelled)
            .unwrap();

        assert_eq!(code, "real-code");
    }

    #[test]
    fn rejects_a_mismatched_state() {
        let loopback = bind().unwrap();
        let port = loopback.port();
        let cancelled = AtomicBool::new(false);

        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let _ = std::net::TcpStream::connect(("127.0.0.1", port)).map(|mut stream| {
                use std::io::Write;
                let _ = stream.write_all(
                    b"GET /?code=c&state=attacker HTTP/1.1\r\nHost: localhost\r\n\r\n",
                );
            });
        });

        assert!(matches!(
            loopback.wait_for_code("expected", Duration::from_secs(5), &cancelled),
            Err(AuthError::StateMismatch)
        ));
    }

    #[test]
    fn times_out_when_no_redirect_arrives() {
        let loopback = bind().unwrap();
        let cancelled = AtomicBool::new(false);

        assert!(matches!(
            loopback.wait_for_code("s", Duration::from_millis(200), &cancelled),
            Err(AuthError::TimedOut)
        ));
    }

    #[test]
    fn stops_when_cancelled() {
        let loopback = bind().unwrap();
        let cancelled = AtomicBool::new(true);

        assert!(matches!(
            loopback.wait_for_code("s", Duration::from_secs(5), &cancelled),
            Err(AuthError::Cancelled)
        ));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test auth::loopback
```

Expected: FAIL to compile — `cannot find function bind`, `cannot find function parse_redirect_query`.

- [ ] **Step 3: Write the implementation**

Prepend to `src-tauri/src/auth/loopback.rs`:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use url::Url;

use super::error::{AuthError, AuthResult};

/// How often the accept loop wakes to re-check the timeout and cancel flag.
const POLL_INTERVAL: Duration = Duration::from_millis(200);

const SUCCESS_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\">\
<title>Signed in</title></head><body style=\"font-family:system-ui;text-align:center;padding:4rem\">\
<h1>Signed in</h1><p>You can close this tab and return to Calendar Manager.</p></body></html>";

#[derive(Debug, PartialEq, Eq)]
pub struct RedirectParams {
    pub code: String,
    pub state: String,
}

pub struct Loopback {
    port: u16,
    server: tiny_http::Server,
}

/// Bind an ephemeral port on loopback only. Port 0 lets the OS choose, so
/// nothing is hardcoded and nothing collides; Entra treats `http://localhost`
/// redirects as port-agnostic, so one registered URI covers every port.
pub fn bind() -> AuthResult<Loopback> {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| AuthError::Other(format!("could not bind a loopback port: {e}")))?;

    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| AuthError::Other("loopback listener has no IP address".into()))?
        .port();

    Ok(Loopback { port, server })
}

pub fn parse_redirect_query(query: &str) -> Result<RedirectParams, AuthError> {
    // A base is required to parse a bare query string; its value is discarded.
    let url = Url::parse(&format!("http://localhost/?{query}"))
        .map_err(|e| AuthError::Other(format!("unparseable redirect: {e}")))?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error) = error {
        let detail = error_description.unwrap_or_default();
        return Err(AuthError::Provider(format!("{error}: {detail}")));
    }

    match (code, state) {
        (Some(code), Some(state)) => Ok(RedirectParams { code, state }),
        _ => Err(AuthError::Provider(
            "sign-in response contained no authorization code".into(),
        )),
    }
}

impl Loopback {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://localhost:{}", self.port)
    }

    /// Block until the browser hits the redirect URI, then verify `state` and
    /// return the authorization code. Consumes `self` so the listener is always
    /// dropped and the port released, on every path.
    pub fn wait_for_code(
        self,
        expected_state: &str,
        timeout: Duration,
        cancelled: &AtomicBool,
    ) -> AuthResult<String> {
        let deadline = Instant::now() + timeout;

        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err(AuthError::Cancelled);
            }
            if Instant::now() >= deadline {
                return Err(AuthError::TimedOut);
            }

            // recv_timeout lets the loop re-check the flags above rather than
            // blocking in accept() forever.
            let request = match self.server.recv_timeout(POLL_INTERVAL) {
                Ok(Some(request)) => request,
                Ok(None) => continue,
                Err(e) => return Err(AuthError::Other(format!("loopback accept failed: {e}"))),
            };

            let query = request.url().split_once('?').map(|(_, q)| q.to_string());

            // Answer the browser before judging the payload, so the user sees a
            // page either way rather than a connection reset.
            let _ = request.respond(
                tiny_http::Response::from_string(SUCCESS_PAGE).with_header(
                    "Content-Type: text/html; charset=utf-8"
                        .parse::<tiny_http::Header>()
                        .expect("static header always parses"),
                ),
            );

            let Some(query) = query else {
                // Browsers request /favicon.ico and similar; ignore and keep waiting.
                continue;
            };

            let params = parse_redirect_query(&query)?;

            if params.state != expected_state {
                return Err(AuthError::StateMismatch);
            }

            return Ok(params.code);
        }
    }
}
```

Three details that matter:

- `recv_timeout` rather than a blocking `recv` is what makes the 5-minute timeout and the cancel flag actually work. A blocking accept would ignore both until a request arrived.
- The response is sent **before** the query is validated, so a user who denies consent still sees a page instead of a browser error.
- A request with no query string is skipped rather than treated as a failure — browsers fetch `/favicon.ico` against the redirect origin and would otherwise abort the login.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test auth::loopback
```

Expected: PASS, 11 tests. Note that four of them bind real sockets and one sleeps 200ms, so this file takes a second or two.

- [ ] **Step 5: Export the module**

In `src-tauri/src/auth/mod.rs`, add `pub mod loopback;`.

- [ ] **Step 6: Verify the whole crate still builds clean**

```bash
cd src-tauri && cargo test auth
```

Expected: 19 tests pass (8 from Task 1, 11 here), zero warnings other than dead-code on unused `AuthError` variants.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/auth/
git commit -m "feat(auth): add the loopback redirect catcher

Binds 127.0.0.1:0 so the OS picks the port; Entra treats http://localhost
redirects as port-agnostic, so one registered URI covers every run.

wait_for_code consumes self, guaranteeing the port is released on every
path, and polls with recv_timeout so the login timeout and the cancel flag
are actually honoured rather than ignored inside a blocking accept.

State is verified before the code is returned. Provider errors carry their
error_description through, and query-less requests (favicon.ico) are
skipped instead of aborting the login. 11 tests, four binding real sockets."
```

---

### Task 3: Token exchange, refresh, and Credential Manager storage

**Files:**
- Create: `src-tauri/src/auth/tokens.rs`
- Modify: `src-tauri/src/auth/mod.rs`
- Test: inline `#[cfg(test)]` in `tokens.rs`

**Interfaces:**
- Consumes: `AuthError`, `AuthResult`, `AUTHORITY`, `SCOPES` from Task 1.
- Produces:
  - `pub struct TokenResponse { pub access_token: String, pub refresh_token: Option<String>, pub expires_in: u64 }` (deserialized from Entra)
  - `pub struct AccessToken { pub value: String, pub expires_at: Instant }` with `pub fn is_stale(&self) -> bool`
  - `pub struct Account { pub name: String, pub username: String }` — `Serialize`, camelCase, the **only** auth data that crosses IPC
  - `pub async fn exchange_code(client_id: &str, redirect_uri: &str, code: &str, verifier: &str) -> AuthResult<TokenResponse>`
  - `pub async fn refresh(client_id: &str, refresh_token: &str) -> AuthResult<TokenResponse>`
  - `pub async fn fetch_account(access_token: &str) -> AuthResult<Account>`
  - `pub fn store_refresh_token(token: &str) -> AuthResult<()>`, `pub fn load_refresh_token() -> AuthResult<Option<String>>`, `pub fn clear_refresh_token() -> AuthResult<()>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/auth/tokens.rs` with only the tests. These cover the pure logic — response parsing and staleness — because the HTTP calls and Credential Manager need a real Microsoft endpoint and a real Windows session, which belong in the manual gate rather than in `cargo test`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_token_response() {
        let json = r#"{
            "token_type": "Bearer",
            "scope": "User.Read Calendars.Read",
            "expires_in": 3599,
            "access_token": "eyJ0eXAi...",
            "refresh_token": "0.AXkA..."
        }"#;

        let parsed: TokenResponse = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.access_token, "eyJ0eXAi...");
        assert_eq!(parsed.refresh_token.as_deref(), Some("0.AXkA..."));
        assert_eq!(parsed.expires_in, 3599);
    }

    #[test]
    fn parses_a_refresh_response_that_omits_the_refresh_token() {
        // Entra may return no new refresh token, in which case the old one stands.
        let json = r#"{"expires_in": 3599, "access_token": "at"}"#;

        let parsed: TokenResponse = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.refresh_token, None);
    }

    #[test]
    fn parses_an_account_from_the_graph_me_payload() {
        let json = r#"{
            "displayName": "Ada Lovelace",
            "userPrincipalName": "ada@example.com",
            "mail": "ada@example.com",
            "id": "abc"
        }"#;

        let account: Account = serde_json::from_str(json).unwrap();

        assert_eq!(account.name, "Ada Lovelace");
        assert_eq!(account.username, "ada@example.com");
    }

    #[test]
    fn a_fresh_token_is_not_stale() {
        let token = AccessToken::new("value".into(), 3600);
        assert!(!token.is_stale());
    }

    #[test]
    fn a_token_inside_the_refresh_margin_is_stale() {
        // 60s of validity is inside the 5-minute margin, so it must refresh
        // rather than be used and fail mid-request.
        let token = AccessToken::new("value".into(), 60);
        assert!(token.is_stale());
    }

    #[test]
    fn an_expired_token_is_stale() {
        let token = AccessToken::new("value".into(), 0);
        assert!(token.is_stale());
    }

    #[test]
    fn error_responses_become_provider_errors() {
        let body = r#"{
            "error": "invalid_client",
            "error_description": "AADSTS7000218: The request body must contain client_assertion or client_secret."
        }"#;

        let error = provider_error_from_body(body);

        match error {
            AuthError::Provider(message) => {
                assert!(message.contains("invalid_client"));
                assert!(message.contains("AADSTS7000218"));
            }
            other => panic!("expected Provider, got {other:?}"),
        }
    }

    #[test]
    fn unparseable_error_bodies_still_surface_something_useful() {
        match provider_error_from_body("<html>502 Bad Gateway</html>") {
            AuthError::Provider(message) => assert!(message.contains("502")),
            other => panic!("expected Provider, got {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test auth::tokens
```

Expected: FAIL to compile — `cannot find type TokenResponse`, `AccessToken`, `Account`, and `cannot find function provider_error_from_body`.

- [ ] **Step 3: Write the implementation**

Prepend to `src-tauri/src/auth/tokens.rs`:

```rust
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::error::{AuthError, AuthResult};
use super::pkce::{AUTHORITY, SCOPES};

/// Refresh this far before actual expiry, so a long request can't have its
/// token expire mid-flight.
const REFRESH_MARGIN: Duration = Duration::from_secs(300);

const KEYRING_SERVICE: &str = "com.triowfs.calendarmanager";
const KEYRING_ACCOUNT: &str = "microsoft-refresh-token";

#[derive(Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    /// Absent on some refresh responses, in which case the existing token stands.
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

/// Hand-rolled so that `{:?}` can never print a token. A derived `Debug` would
/// put both tokens in plaintext into any log line or panic message that
/// formatted this struct.
impl std::fmt::Debug for TokenResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenResponse")
            .field("access_token", &"<redacted>")
            .field("refresh_token", &self.refresh_token.as_ref().map(|_| "<redacted>"))
            .field("expires_in", &self.expires_in)
            .finish()
    }
}

/// The display identity of the signed-in user. This is the ONLY auth data that
/// crosses the IPC boundary — tokens never do.
///
/// `alias` rather than `rename`: alias adds an accepted name for
/// DESERIALIZATION only, so this reads Graph's `/me` payload directly while
/// still serializing as `name`/`username` for the frontend. `rename` would
/// apply in both directions and send Graph's field names to the webview,
/// breaking the `Account` interface in `src/api/auth.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    #[serde(alias = "displayName")]
    pub name: String,
    #[serde(alias = "userPrincipalName")]
    pub username: String,
}

pub struct AccessToken {
    pub value: String,
    pub expires_at: Instant,
}

impl AccessToken {
    pub fn new(value: String, expires_in: u64) -> Self {
        Self {
            value,
            expires_at: Instant::now() + Duration::from_secs(expires_in),
        }
    }

    pub fn is_stale(&self) -> bool {
        Instant::now() + REFRESH_MARGIN >= self.expires_at
    }
}

#[derive(Debug, Deserialize)]
struct ProviderErrorBody {
    error: String,
    #[serde(default)]
    error_description: String,
}

/// Entra's error bodies are JSON, but a gateway failure may return HTML. Fall
/// back to the raw body rather than masking the real problem.
pub fn provider_error_from_body(body: &str) -> AuthError {
    match serde_json::from_str::<ProviderErrorBody>(body) {
        Ok(parsed) => {
            AuthError::Provider(format!("{}: {}", parsed.error, parsed.error_description))
        }
        Err(_) => AuthError::Provider(body.chars().take(500).collect()),
    }
}

async fn post_to_token_endpoint(form: &[(&str, &str)]) -> AuthResult<TokenResponse> {
    let response = reqwest::Client::new()
        .post(format!("{AUTHORITY}/oauth2/v2.0/token"))
        .form(form)
        .send()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    if !status.is_success() {
        return Err(provider_error_from_body(&body));
    }

    serde_json::from_str(&body)
        .map_err(|e| AuthError::Other(format!("unexpected token response: {e}")))
}

/// Exchange the authorization code. No CORS policy applies here, which is the
/// entire reason auth lives in Rust rather than the webview.
pub async fn exchange_code(
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> AuthResult<TokenResponse> {
    post_to_token_endpoint(&[
        ("client_id", client_id),
        ("scope", SCOPES),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ])
    .await
}

pub async fn refresh(client_id: &str, refresh_token: &str) -> AuthResult<TokenResponse> {
    post_to_token_endpoint(&[
        ("client_id", client_id),
        ("scope", SCOPES),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ])
    .await
}

/// Read the profile from Graph rather than decoding the id_token, which would
/// mean a JWT dependency for two fields.
pub async fn fetch_account(access_token: &str) -> AuthResult<Account> {
    let response = reqwest::Client::new()
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    if !status.is_success() {
        return Err(provider_error_from_body(&body));
    }

    serde_json::from_str(&body)
        .map_err(|e| AuthError::Other(format!("unexpected /me response: {e}")))
}

fn keyring_entry() -> AuthResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| AuthError::Keyring(e.to_string()))
}

pub fn store_refresh_token(token: &str) -> AuthResult<()> {
    keyring_entry()?
        .set_password(token)
        .map_err(|e| AuthError::Keyring(e.to_string()))
}

pub fn load_refresh_token() -> AuthResult<Option<String>> {
    match keyring_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AuthError::Keyring(e.to_string())),
    }
}

pub fn clear_refresh_token() -> AuthResult<()> {
    match keyring_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // Already absent is the desired end state, not a failure.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AuthError::Keyring(e.to_string())),
    }
}
```

If the installed `keyring` version names the delete method `delete_password` rather than `delete_credential`, use that — the rename happened across major versions.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test auth::tokens
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Export the module and verify the crate**

Add `pub mod tokens;` to `src-tauri/src/auth/mod.rs`, then:

```bash
cd src-tauri && cargo test auth
```

Expected: 27 tests pass (8 + 11 + 8), zero warnings beyond dead code.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/auth/
git commit -m "feat(auth): add token exchange, refresh, and credential storage

Refresh tokens go to Windows Credential Manager via keyring; access
tokens carry an expiry and report themselves stale 5 minutes early so a
long request cannot have its token die mid-flight.

Account is the only auth type that crosses IPC — its serde renames let it
deserialize straight from Graph /me while presenting camelCase to the
frontend, avoiding a JWT dependency for two fields.

Error bodies fall back to the raw text when they aren't JSON, so a gateway
failure isn't masked. One test asserts the AADSTS7000218 shape, the error
raised when 'Allow public client flows' is off.

8 tests cover parsing and staleness. The HTTP calls and Credential Manager
need a real endpoint and Windows session, so they belong to the manual gate."
```

---

### Task 4: Commands and state wiring

**Files:**
- Create: `src-tauri/src/commands/auth.rs`
- Modify: `src-tauri/src/auth/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
- Test: inline `#[cfg(test)]` in `src-tauri/src/auth/mod.rs`

**Interfaces:**
- Consumes: everything from Tasks 1-3, plus the existing `get_config` command's store (to read `appRegistrationId`).
- Produces five commands:
  - `login() -> AuthResult<Account>`
  - `cancel_login() -> ()`
  - `logout() -> AuthResult<()>`
  - `get_account() -> Option<Account>`
  - `has_session() -> bool`

- [ ] **Step 1: Write the failing test for the state container**

Append to `src-tauri/src/auth/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_state_has_no_session() {
        let state = AuthState::default();
        assert!(!state.has_session());
        assert!(state.account().is_none());
    }

    #[test]
    fn recording_a_session_exposes_the_account() {
        let state = AuthState::default();

        state.set_session(
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada Lovelace".into(),
                username: "ada@example.com".into(),
            },
        );

        assert!(state.has_session());
        assert_eq!(state.account().unwrap().username, "ada@example.com");
    }

    #[test]
    fn clearing_a_session_removes_the_account() {
        let state = AuthState::default();
        state.set_session(
            tokens::AccessToken::new("at".into(), 3600),
            tokens::Account {
                name: "Ada".into(),
                username: "ada@example.com".into(),
            },
        );

        state.clear_session();

        assert!(!state.has_session());
        assert!(state.account().is_none());
    }

    #[test]
    fn only_one_login_may_be_in_flight() {
        let state = AuthState::default();

        assert!(state.begin_login().is_ok());
        assert!(matches!(
            state.begin_login(),
            Err(error::AuthError::LoginInProgress)
        ));

        state.end_login();
        assert!(state.begin_login().is_ok());
    }

    #[test]
    fn cancelling_sets_the_flag_the_listener_polls() {
        let state = AuthState::default();
        state.begin_login().unwrap();

        state.cancel_login();

        assert!(state.is_cancelled());
    }

    #[test]
    fn beginning_a_login_clears_a_stale_cancel_flag() {
        let state = AuthState::default();
        state.begin_login().unwrap();
        state.cancel_login();
        state.end_login();

        state.begin_login().unwrap();

        assert!(!state.is_cancelled());
    }
}
```

That last test is the one that matters most: without clearing the flag, a cancelled login would make every subsequent attempt fail instantly.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test auth::tests
```

Expected: FAIL to compile — `cannot find type AuthState`.

- [ ] **Step 3: Implement the state container**

Prepend to `src-tauri/src/auth/mod.rs`, above the test module:

```rust
pub mod error;
pub mod loopback;
pub mod pkce;
pub mod tokens;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use error::{AuthError, AuthResult};
use tokens::{AccessToken, Account};

/// Auth state for the app's lifetime. The access token lives here and nowhere
/// else — never on disk, never across IPC.
#[derive(Default)]
pub struct AuthState {
    session: Mutex<Option<Session>>,
    login_in_flight: AtomicBool,
    /// An Arc so a clone can move into the blocking listener thread while
    /// `cancel_login` still reaches the same flag from the command.
    cancelled: Arc<AtomicBool>,
}

struct Session {
    token: AccessToken,
    account: Account,
}

impl AuthState {
    pub fn has_session(&self) -> bool {
        self.session.lock().expect("auth state poisoned").is_some()
    }

    pub fn account(&self) -> Option<Account> {
        self.session
            .lock()
            .expect("auth state poisoned")
            .as_ref()
            .map(|session| session.account.clone())
    }

    pub fn set_session(&self, token: AccessToken, account: Account) {
        *self.session.lock().expect("auth state poisoned") =
            Some(Session { token, account });
    }

    pub fn clear_session(&self) {
        *self.session.lock().expect("auth state poisoned") = None;
    }

    /// Returns the current access token if it is still fresh enough to use.
    pub fn fresh_token(&self) -> Option<String> {
        let guard = self.session.lock().expect("auth state poisoned");
        guard
            .as_ref()
            .filter(|session| !session.token.is_stale())
            .map(|session| session.token.value.clone())
    }

    pub fn begin_login(&self) -> AuthResult<()> {
        if self
            .login_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AuthError::LoginInProgress);
        }
        // A cancel from a previous attempt must not kill this one.
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn end_login(&self) {
        self.login_in_flight.store(false, Ordering::SeqCst);
    }

    pub fn cancel_login(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// A clone of the flag the loopback listener polls. Cloning the Arc, not
    /// the flag, is what lets the blocking thread and `cancel_login` share it.
    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src-tauri && cargo test auth::tests
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the commands**

Create `src-tauri/src/commands/auth.rs`:

```rust
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use crate::auth::error::{AuthError, AuthResult};
use crate::auth::{loopback, pkce, tokens, AuthState};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const STORE_FILE: &str = "config.json";

fn client_id<R: Runtime>(app: &AppHandle<R>) -> AuthResult<String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AuthError::Other(e.to_string()))?;

    store
        .get("appRegistrationId")
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|id| !id.trim().is_empty())
        .ok_or(AuthError::NotConfigured)
}

/// Records the session and persists the refresh token. Shared by login and
/// session restore so the two cannot drift apart.
async fn establish_session<R: Runtime>(
    app: &AppHandle<R>,
    response: tokens::TokenResponse,
) -> AuthResult<tokens::Account> {
    let account = tokens::fetch_account(&response.access_token).await?;

    if let Some(refresh_token) = response.refresh_token.as_deref() {
        tokens::store_refresh_token(refresh_token)?;
    }

    app.state::<AuthState>().set_session(
        tokens::AccessToken::new(response.access_token, response.expires_in),
        account.clone(),
    );

    Ok(account)
}

#[tauri::command]
pub async fn login<R: Runtime>(app: AppHandle<R>) -> AuthResult<tokens::Account> {
    let client_id = client_id(&app)?;
    app.state::<AuthState>().begin_login()?;

    let result = run_login(&app, &client_id).await;

    app.state::<AuthState>().end_login();
    result
}

async fn run_login<R: Runtime>(
    app: &AppHandle<R>,
    client_id: &str,
) -> AuthResult<tokens::Account> {
    let pkce_pair = pkce::generate_pkce();
    let state_nonce = pkce::generate_state();

    let listener = loopback::bind()?;
    let redirect_uri = listener.redirect_uri();

    let url = pkce::authorize_url(
        client_id,
        &redirect_uri,
        &pkce_pair.challenge,
        &state_nonce,
    );

    // The system browser, not an embedded webview: the user gets their real
    // Entra session, password manager, MFA and Windows Hello.
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AuthError::Other(format!("could not open the browser: {e}")))?;

    // tiny_http blocks, so keep it off the async runtime's worker threads.
    // The Arc'd cancel flag is what lets cancel_login reach the listener while
    // it sits in recv_timeout on another thread.
    let cancel_flag = app.state::<AuthState>().cancel_flag();
    let expected_state = state_nonce.clone();

    let code = tauri::async_runtime::spawn_blocking(move || {
        listener.wait_for_code(&expected_state, LOGIN_TIMEOUT, &cancel_flag)
    })
    .await
    .map_err(|e| AuthError::Other(format!("login task failed: {e}")))??;

    let response =
        tokens::exchange_code(client_id, &redirect_uri, &code, &pkce_pair.verifier).await?;

    establish_session(app, response).await
}

#[tauri::command]
pub fn cancel_login(state: State<'_, AuthState>) {
    state.cancel_login();
}

#[tauri::command]
pub async fn logout<R: Runtime>(app: AppHandle<R>) -> AuthResult<()> {
    tokens::clear_refresh_token()?;
    app.state::<AuthState>().clear_session();
    Ok(())
}

#[tauri::command]
pub fn get_account(state: State<'_, AuthState>) -> Option<tokens::Account> {
    state.account()
}

/// Restores a session from the stored refresh token when possible, so a
/// returning user goes straight to the dashboard. Replaces MSAL's
/// localStorage cache.
#[tauri::command]
pub async fn has_session<R: Runtime>(app: AppHandle<R>) -> bool {
    if app.state::<AuthState>().has_session() {
        return true;
    }

    let Ok(client_id) = client_id(&app) else {
        return false;
    };
    let Ok(Some(refresh_token)) = tokens::load_refresh_token() else {
        return false;
    };
    let Ok(response) = tokens::refresh(&client_id, &refresh_token).await else {
        // A revoked or expired refresh token means a real sign-in is needed.
        let _ = tokens::clear_refresh_token();
        return false;
    };

    establish_session(&app, response).await.is_ok()
}
```

Three details worth understanding rather than skimming:

- **The double `??`** on the `spawn_blocking` call is not a typo. The first unwraps the join result (did the thread panic?), the second unwraps `wait_for_code`'s own `AuthResult`.
- **`&cancel_flag` passes an `Arc<AtomicBool>` where `&AtomicBool` is expected** — deref coercion handles it, so `wait_for_code` needs no signature change from Task 2.
- **`login` calls `end_login()` on every path**, success or failure, by capturing the result first. Without that, one failed login would leave `login_in_flight` stuck true and every later attempt would return `LoginInProgress`.

- [ ] **Step 6: Register everything**

In `src-tauri/src/commands/mod.rs`, add `pub mod auth;`.

In `src-tauri/src/lib.rs`: add `use auth::AuthState;`, add `.plugin(tauri_plugin_opener::init())`, add `.manage(AuthState::default())`, and extend `generate_handler!` with `commands::auth::login`, `commands::auth::cancel_login`, `commands::auth::logout`, `commands::auth::get_account`, `commands::auth::has_session`.

In `src-tauri/capabilities/default.json`, add `"opener:allow-open-url"` to `permissions`.

- [ ] **Step 7: Verify**

```bash
cd src-tauri && cargo test
```

Expected: 33 tests pass (8 + 11 + 8 + 6), zero warnings. `cargo check` must be clean — no placeholder code left.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ src-tauri/capabilities/default.json
git commit -m "feat(auth): add the five auth commands and shared state

login/cancel_login/logout/get_account/has_session. The access token lives
only in AuthState behind a mutex; no command returns a token, so nothing
of the sort reaches the webview.

has_session doubles as session restore: it refreshes from the stored token
and clears it when Entra rejects it, replacing MSAL's localStorage cache.
establish_session is shared by login and restore so they cannot drift.

The blocking loopback listener runs via spawn_blocking with an Arc'd
cancel flag, keeping tiny_http off the async runtime's workers while
cancel_login can still reach it. begin_login clears a stale cancel flag,
without which one cancellation would break every later attempt."
```

---

### Task 5: Frontend rewire and MSAL removal

**Files:**
- Create: `src/api/auth.ts`, `src/services/auth.test.ts`
- Modify: `src/services/auth.ts` (full rewrite), `src/App.tsx:44-84`, `src/components/Login.tsx:15-25`, `src/components/UserMenu.tsx`, `package.json`
- Test: `src/services/auth.test.ts`, `src/components/UserMenu.test.tsx`

**Interfaces:**
- Consumes: the five commands from Task 4.
- Produces:
  - `src/api/auth.ts`: `login(): Promise<Account>`, `cancelLogin(): Promise<void>`, `logout(): Promise<void>`, `getAccount(): Promise<Account | null>`, `hasSession(): Promise<boolean>`, and `export interface Account { name: string; username: string }`.
  - `authService` keeps the names its callers already use: `login`, `logout`, `getCurrentAccount`, `isLoggedIn`. `initialize`, `handleRedirectPromise`, `getAccessToken`, and `getGraphClient` are **deleted**.

- [ ] **Step 1: Write the failing test**

Create `src/services/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as authApi from '../api/auth'
import { authService } from './auth'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  cancelLogin: vi.fn(),
  logout: vi.fn(),
  getAccount: vi.fn(),
  hasSession: vi.fn(),
}))

const account = { name: 'Ada Lovelace', username: 'ada@example.com' }

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the account on a successful login', async () => {
    vi.mocked(authApi.login).mockResolvedValue(account)

    expect(await authService.login()).toEqual(account)
  })

  it('propagates a login failure so the UI can show it', async () => {
    vi.mocked(authApi.login).mockRejectedValue('Microsoft rejected the sign-in')

    await expect(authService.login()).rejects.toBe('Microsoft rejected the sign-in')
  })

  it('reports a live session', async () => {
    vi.mocked(authApi.hasSession).mockResolvedValue(true)

    expect(await authService.isLoggedIn()).toBe(true)
  })

  it('reports no session', async () => {
    vi.mocked(authApi.hasSession).mockResolvedValue(false)

    expect(await authService.isLoggedIn()).toBe(false)
  })

  it('reads the current account', async () => {
    vi.mocked(authApi.getAccount).mockResolvedValue(account)

    expect(await authService.getCurrentAccount()).toEqual(account)
  })

  it('returns null when there is no account', async () => {
    vi.mocked(authApi.getAccount).mockResolvedValue(null)

    expect(await authService.getCurrentAccount()).toBeNull()
  })

  it('logs out', async () => {
    await authService.logout()

    expect(authApi.logout).toHaveBeenCalled()
  })

  it('exposes no way to obtain a token', () => {
    // Tokens must never cross the IPC boundary.
    const surface = authService as unknown as Record<string, unknown>
    expect(surface.getAccessToken).toBeUndefined()
    expect(surface.getGraphClient).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/services/auth.test.ts
```

Expected: FAIL — `Cannot find module '../api/auth'`.

- [ ] **Step 3: Create the API wrapper**

Create `src/api/auth.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'

/**
 * Authentication, owned by Rust. The sign-in happens in the system browser
 * and the token exchange happens in Rust, so no access token, refresh token
 * or id_token ever reaches this process.
 */

export interface Account {
  name: string
  username: string
}

export function login(): Promise<Account> {
  return invoke<Account>('login')
}

export function cancelLogin(): Promise<void> {
  return invoke('cancel_login')
}

export function logout(): Promise<void> {
  return invoke('logout')
}

export async function getAccount(): Promise<Account | null> {
  return (await invoke<Account | null>('get_account')) ?? null
}

export function hasSession(): Promise<boolean> {
  return invoke<boolean>('has_session')
}
```

- [ ] **Step 4: Rewrite the auth service**

Replace the entire contents of `src/services/auth.ts`:

```typescript
import { login, logout, getAccount, hasSession, cancelLogin, Account } from '../api/auth'

export type { Account }

/**
 * Thin facade over the Rust auth commands. There is deliberately no
 * getAccessToken or getGraphClient: tokens stay in Rust, and anything needing
 * Graph data asks Rust for it.
 */
class AuthService {
  /** Opens the system browser and resolves once the code has been exchanged. */
  async login(): Promise<Account> {
    return login()
  }

  async cancelLogin(): Promise<void> {
    return cancelLogin()
  }

  async logout(): Promise<void> {
    return logout()
  }

  async getCurrentAccount(): Promise<Account | null> {
    return getAccount()
  }

  /** Also restores a session from the stored refresh token when one exists. */
  async isLoggedIn(): Promise<boolean> {
    return hasSession()
  }
}

export const authService = new AuthService()
```

Note both `getCurrentAccount` and `isLoggedIn` are now **async**, where MSAL's were synchronous. Every caller must be updated — Steps 6 and 7.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/services/auth.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Simplify the App state machine**

In `src/App.tsx`, replace the `initializeApp` function inside the `useEffect` (currently lines 44-74) with:

```typescript
    const initializeApp = async () => {
      try {
        const appRegistrationId = await storageService.getAppRegistrationId()

        if (!appRegistrationId) {
          setAppState('setup')
          return
        }

        // Rust restores a session from the stored refresh token if it can, so
        // there is no redirect to handle and no MSAL cache to prime.
        setAppState((await authService.isLoggedIn()) ? 'dashboard' : 'login')
      } catch (error) {
        console.error('Error initializing app:', error)
        setAppState('login')
      }
    }
```

Then replace `handleSetupComplete` (currently lines 76-84) with:

```typescript
  const handleSetupComplete = async (appRegistrationId: string) => {
    try {
      await storageService.setAppRegistrationId(appRegistrationId)
      setAppState('login')
    } catch (error) {
      console.error('Error completing setup:', error)
      setAppState('setup')
    }
  }
```

Two deliberate changes beyond deleting MSAL:

- `authService.initialize(...)` is gone entirely — Rust reads `appRegistrationId` from the store itself, so there is nothing to hand it.
- The catch now falls through to `'login'`, **not** `'setup'`. The old behaviour is exactly what made this milestone's bug look like a config problem: a failing auth call sent the user back to re-enter a client ID that was already correct.

- [ ] **Step 7: Make the Login screen await a real result**

In `src/components/Login.tsx`, replace `handleLogin` (lines 15-25) with:

```typescript
  const handleLogin = async () => {
    setLoading(true);
    try {
      const { authService } = await import('../services/auth');
      await authService.login();
      onLoginSuccess();
    } catch (error) {
      console.error('Login failed:', error);
      onLoginError(typeof error === 'string' ? error : 'Login failed');
      setLoading(false);
    }
  };
```

Change the prop destructuring on line 11 from `onLoginSuccess: _onLoginSuccess` back to `onLoginSuccess`. `login()` now resolves with an account rather than navigating the page away, so the success callback finally fires — the reason it was prefixed unused.

Note the error is a plain string: `AuthError` serializes to a string, not an `Error`.

Also update the info alert's description (line 47) so it no longer implies an in-app sign-in:

```tsx
            description="Your browser will open so you can sign in with your Microsoft work or school account."
```

- [ ] **Step 8: Point UserMenu at the Rust account**

`src/components/UserMenu.tsx` currently calls `authService.getGraphClient()` and queries Graph for the profile. Both are gone. Replace its profile-loading effect so it reads the account from Rust, and map it onto whatever shape the component already renders:

```typescript
  useEffect(() => {
    let cancelled = false

    const loadAccount = async () => {
      try {
        const account = await authService.getCurrentAccount()
        if (cancelled) return
        setUser(
          account
            ? {
                displayName: account.name,
                mail: account.username,
                givenName: account.name.split(' ')[0] || '',
                surname: account.name.split(' ').slice(1).join(' '),
              }
            : null
        )
      } catch (error) {
        console.error('Could not load the signed-in account:', error)
      }
    }

    loadAccount()
    return () => {
      cancelled = true
    }
  }, [])
```

Read the component first and adapt the field names to its existing `user` state shape rather than assuming the above matches exactly — the point is that the data now comes from `getCurrentAccount()`, not a Graph client. Its `authService.logout()` call needs no change. If it calls `authService.isLoggedIn()` synchronously, that must be awaited now.

- [ ] **Step 9: Remove MSAL**

```bash
npm uninstall @azure/msal-browser @azure/msal-node @microsoft/microsoft-graph-client
```

Then confirm nothing references them:

```bash
grep -rn "msal\|microsoft-graph-client" src/ --include=*.ts --include=*.tsx
```

Expected: no hits in non-test files. `src/services/calendar.ts` imports the Graph client — **if it does, stop and report.** That file belongs to M4, and if it still imports the package, uninstalling breaks the build; in that case leave `@microsoft/microsoft-graph-client` installed, remove only the two MSAL packages, and note it for M4.

- [ ] **Step 10: Verify the frontend**

```bash
npm run test:run
```

Expected: all green, with 8 new tests in `auth.test.ts`. `UserMenu.test.tsx` will need its mock updated from a Graph client to `getCurrentAccount` — do that, keeping its existing assertions.

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: **111** — the 108 baseline plus exactly three new errors in
`src/services/calendar.ts`, where `authService.getGraphClient()` no longer
exists. Those three are unavoidable and correct: this task deletes
`getGraphClient`, and `calendar.ts` belongs to the sync milestone, which
replaces those call sites with Rust-side Graph fetching. Do not fix them here.

Check that **no** new error mentions `auth`, `Login`, `UserMenu`, or `App` — those
would be real. `UserMenu.tsx`'s single unread-`token` error is pre-existing.

- [ ] **Step 11: Commit**

```bash
git add src/api/auth.ts src/services/auth.ts src/services/auth.test.ts src/App.tsx src/components/Login.tsx src/components/UserMenu.tsx src/components/UserMenu.test.tsx package.json package-lock.json
git commit -m "feat(auth): move the frontend onto the Rust auth commands

services/auth.ts drops from 138 lines to a facade over five commands.
getAccessToken, getGraphClient, handleRedirectPromise and initialize are
all deleted — the frontend no longer holds a token or a Graph client, and
Rust reads appRegistrationId from the store itself.

App.tsx loses the initialize/handleRedirectPromise/isLoggedIn dance for a
single isLoggedIn check, and its catch now falls through to 'login' rather
than 'setup'. That last change fixes the symptom that made a failing auth
call look like a bad client ID and sent the user round the setup loop.

Login.tsx finally calls onLoginSuccess: login() resolves with an account
instead of navigating the page away. UserMenu reads the account from Rust
rather than querying Graph. MSAL is uninstalled."
```

---

## Definition of Done

- [ ] `cd src-tauri && cargo test` — 33 tests pass, no warnings.
- [ ] `npm run test:run` — green, including the 8 new `auth.test.ts` tests.
- [ ] `npx tsc --noEmit` reports 111 errors: the 108 baseline plus three
  `getGraphClient` errors in `calendar.ts` that the sync milestone owns. No new
  error touches the auth path itself.
- [ ] `grep -rn "msal" src/` returns nothing outside tests.
- [ ] No command returns a token: `grep -rn "access_token\|refresh_token" src/` returns nothing.

**Manual gate — only the user can run this:**

1. Complete the Entra prerequisite above (**both** steps — `http://localhost` under Mobile and desktop applications, and Allow public client flows → Yes).
2. `npm start` → Sign in with Microsoft. **The system browser opens**, not an in-app window.
3. Sign in. The browser shows "Signed in — you can close this tab", and the app reaches the dashboard.
4. Close the app entirely and relaunch: it goes **straight to the dashboard**, no sign-in.
5. Check the credential: Windows Credential Manager → Windows Credentials → a generic credential for `com.triowfs.calendarmanager`.
   **This step is the spec's keyring validation**, which it asks to happen in
   this milestone rather than being discovered at M6. If steps 4-6 fail with a
   `Could not access the Windows Credential Manager` error, the spec's fallback
   applies — an encrypted file in the app data dir — and that becomes a
   follow-up task here, not later. Do not implement the fallback speculatively;
   `keyring` is expected to work and unused fallback code is worse than none.
6. Sign out from the user menu, confirm you land on the login screen, and confirm the credential is gone.
7. Start a login and close the browser tab without signing in; confirm the app recovers and a second attempt works.
8. Expected still broken: the calendar and settings screens, which need the database (M3).

If step 2 fails with `AADSTS7000218`, Allow public client flows is still off.

## Next

M3 (Rust data layer) gets its own plan, written once this milestone lands.
