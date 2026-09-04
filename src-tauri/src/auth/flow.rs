//! The OAuth PKCE login flow and access-token refresh logic.
//!
//! `commands/auth.rs` is the IPC surface only: each `#[tauri::command]`
//! function there delegates into this module in a line or two. Keeping the
//! flow here (rather than in `commands/`) means the coming sync milestone can
//! call `ensure_access_token` as a call into a domain module, not a call into
//! the IPC layer.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use super::error::{AuthError, AuthResult};
use super::{loopback, pkce, secret_store, tokens, AuthState};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const STORE_FILE: &str = "config.json";
const REFRESH_TOKEN_FILE: &str = "refresh-token.bin";

pub fn client_id<R: Runtime>(app: &AppHandle<R>) -> AuthResult<String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AuthError::Other(e.to_string()))?;

    store
        .get("appRegistrationId")
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|id| !id.trim().is_empty())
        .ok_or(AuthError::NotConfigured)
}

/// Path to the DPAPI-encrypted refresh token file, alongside `config.json` in
/// `%APPDATA%/com.triowfs.calendarmanager/`.
pub fn refresh_token_path<R: Runtime>(app: &AppHandle<R>) -> AuthResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(REFRESH_TOKEN_FILE))
        .map_err(|e| AuthError::SecretStore(e.to_string()))
}

/// Records the session and persists the refresh token. Shared by login and
/// session restore so the two cannot drift apart.
async fn establish_session<R: Runtime>(
    app: &AppHandle<R>,
    response: tokens::TokenResponse,
) -> AuthResult<tokens::Account> {
    // Captured before the only await below, so a `logout` that lands while
    // this call is suspended waiting on Graph can be detected: a
    // `clear_session` in between bumps the generation, and
    // `set_session_if_current` below then fails rather than silently
    // resurrecting a session the user just signed out of.
    let generation = app.state::<AuthState>().generation();

    // Persist before the profile read: a transient Graph failure must not cost
    // the user a refresh token Entra has already rotated and accepted.
    if let Some(refresh_token) = response.refresh_token.as_deref() {
        secret_store::store(&refresh_token_path(app)?, refresh_token)?;
    }

    let account = tokens::fetch_account(&response.access_token).await?;

    let applied = app.state::<AuthState>().set_session_if_current(
        generation,
        tokens::AccessToken::new(response.access_token, response.expires_in),
        account.clone(),
    );

    if !applied {
        // A logout happened mid-flight. Keeping the token we just persisted
        // above would leave the user logged out in the UI right now but
        // silently signed back in on the next launch, so undo the persist
        // too rather than just skipping the in-memory session.
        let _ = secret_store::clear(&refresh_token_path(app)?);
        return Err(AuthError::NoSession);
    }

    Ok(account)
}

/// Returns a usable access token, refreshing or restoring from secure storage
/// as needed. This is the single entry point for anything that needs to call
/// Graph — the sync milestone calls this rather than reaching into
/// AuthState, so the refresh rules live in exactly one place.
pub async fn ensure_access_token<R: Runtime>(app: &AppHandle<R>) -> AuthResult<String> {
    let state = app.state::<AuthState>();

    // Still-fresh in-memory token: the common case, no network needed.
    if let Some(token) = state.fresh_token() {
        return Ok(token);
    }

    // Serialize refreshes: two callers that both miss the fast path above —
    // React StrictMode double-invoking the init effect makes this the normal
    // case, not just a rare race — would otherwise each POST a refresh and
    // each get back a different rotated refresh token, with whichever is
    // persisted second silently winning. Re-checking fresh_token() once the
    // lock is held means only the first caller actually refreshes; anyone
    // who was waiting gets that result for free instead of racing it.
    let _refresh_guard = state.refresh_lock().lock().await;

    if let Some(token) = state.fresh_token() {
        return Ok(token);
    }

    let client_id = client_id(app)?;
    let token_path = refresh_token_path(app)?;
    let refresh_token = secret_store::load(&token_path)?.ok_or(AuthError::NoSession)?;

    let response = match tokens::refresh(&client_id, &refresh_token).await {
        Ok(response) => response,
        Err(error) => {
            // Only AuthError::InvalidGrant proves the refresh token is
            // worthless. tokens::refresh returns that variant exclusively
            // when the token endpoint's response itself decodes to OAuth's
            // invalid_grant — every other token-endpoint failure (a 503, a
            // 429, a proxy's HTML error page) comes back as Provider and
            // leaves the token valid. This is the third bug of this class in
            // this milestone, so the distinction is now structural: an error
            // variant only the token endpoint can produce, not a predicate
            // someone has to remember to apply correctly at each call site.
            if matches!(error, AuthError::InvalidGrant(_)) {
                let _ = secret_store::clear(&token_path);
            }
            return Err(error);
        }
    };

    // Clone before establish_session consumes the response.
    let access_token = response.access_token.clone();
    establish_session(app, response).await?;

    Ok(access_token)
}

pub async fn run_login<R: Runtime>(
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
