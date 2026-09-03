use tauri::{AppHandle, Manager, Runtime, State};

use crate::auth::error::AuthResult;
use crate::auth::{self, secret_store, tokens, AuthState};

#[tauri::command]
pub async fn login<R: Runtime>(app: AppHandle<R>) -> AuthResult<tokens::Account> {
    let client_id = auth::client_id(&app)?;
    app.state::<AuthState>().begin_login()?;

    let result = auth::run_login(&app, &client_id).await;

    app.state::<AuthState>().end_login();
    result
}

#[tauri::command]
pub fn cancel_login(state: State<'_, AuthState>) {
    state.cancel_login();
}

#[tauri::command]
pub async fn logout<R: Runtime>(app: AppHandle<R>) -> AuthResult<()> {
    secret_store::clear(&auth::refresh_token_path(&app)?)?;
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
/// rejected refresh token belongs to `ensure_access_token`, next to the call
/// that can actually prove it invalid.
#[tauri::command]
pub async fn has_session<R: Runtime>(app: AppHandle<R>) -> bool {
    auth::ensure_access_token(&app).await.is_ok()
}
