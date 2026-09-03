use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use crate::auth::error::{AuthError, AuthResult};
use crate::auth::{loopback, pkce, secret_store, tokens, AuthState};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const STORE_FILE: &str = "config.json";
const REFRESH_TOKEN_FILE: &str = "refresh-token.bin";

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

/// Path to the DPAPI-encrypted refresh token file, alongside `config.json` in
/// `%APPDATA%/com.triowfs.calendarmanager/`.
fn refresh_token_path<R: Runtime>(app: &AppHandle<R>) -> AuthResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(REFRESH_TOKEN_FILE))
        .map_err(|e| AuthError::Keyring(e.to_string()))
}

/// Records the session and persists the refresh token. Shared by login and
/// session restore so the two cannot drift apart.
async fn establish_session<R: Runtime>(
    app: &AppHandle<R>,
    response: tokens::TokenResponse,
) -> AuthResult<tokens::Account> {
    // Persist before the profile read: a transient Graph failure must not cost
    // the user a refresh token Entra has already rotated and accepted.
    if let Some(refresh_token) = response.refresh_token.as_deref() {
        secret_store::store(&refresh_token_path(app)?, refresh_token)?;
    }

    let account = tokens::fetch_account(&response.access_token).await?;

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
    let token_path = refresh_token_path(app)?;
    let refresh_token = secret_store::load(&token_path)?.ok_or(AuthError::NoSession)?;

    let response = match tokens::refresh(&client_id, &refresh_token).await {
        Ok(response) => response,
        Err(error) => {
            // Only the token endpoint rejecting the grant proves the refresh
            // token is worthless. A network failure leaves it perfectly valid,
            // and discarding it there would force a re-login just because the
            // app started offline. This decision deliberately sits next to the
            // refresh call: any later failure — notably the Graph /me read in
            // establish_session — says nothing about the refresh token and must
            // never reach it.
            if matches!(error, AuthError::Provider(_)) {
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
    secret_store::clear(&refresh_token_path(&app)?)?;
    app.state::<AuthState>().clear_session();
    Ok(())
}

#[tauri::command]
pub fn get_account(state: State<'_, AuthState>) -> Option<tokens::Account> {
    state.account()
}

/// Reports whether there is a usable session, restoring one from the stored
/// refresh token when possible so a returning user goes straight to the
/// dashboard. Replaces MSAL's localStorage cache. The decision to discard a
/// rejected refresh token belongs to ensure_access_token, next to the call
/// that can actually prove it invalid.
#[tauri::command]
pub async fn has_session<R: Runtime>(app: AppHandle<R>) -> bool {
    ensure_access_token(&app).await.is_ok()
}
