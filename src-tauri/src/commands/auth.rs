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

/// Returns a usable access token, refreshing or restoring from the Credential
/// Manager as needed. This is the single entry point for anything that needs
/// to call Graph — the sync milestone calls this rather than reaching into
/// AuthState, so the refresh rules live in exactly one place.
pub async fn ensure_access_token<R: Runtime>(app: &AppHandle<R>) -> AuthResult<String> {
    // Still-fresh in-memory token: the common case, no network needed.
    if let Some(token) = app.state::<AuthState>().fresh_token() {
        return Ok(token);
    }

    let client_id = client_id(app)?;
    let refresh_token = tokens::load_refresh_token()?.ok_or(AuthError::NoSession)?;
    let response = tokens::refresh(&client_id, &refresh_token).await?;

    // Clone before establish_session consumes the response.
    let access_token = response.access_token.clone();
    establish_session(app, response).await?;

    Ok(access_token)
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

/// Reports whether there is a usable session, restoring one from the stored
/// refresh token when possible so a returning user goes straight to the
/// dashboard. Replaces MSAL's localStorage cache.
#[tauri::command]
pub async fn has_session<R: Runtime>(app: AppHandle<R>) -> bool {
    match ensure_access_token(&app).await {
        Ok(_) => true,
        // Entra rejected the refresh token, so it is revoked or expired and
        // worth nothing: discard it and make the user sign in again.
        Err(AuthError::Provider(_)) => {
            let _ = tokens::clear_refresh_token();
            false
        }
        // Anything else is transient or unrelated — no network, no client ID
        // configured, Credential Manager unavailable. Keep the stored token;
        // deleting it here would force a full re-login just because the app
        // started offline.
        Err(_) => false,
    }
}
