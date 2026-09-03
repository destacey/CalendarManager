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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_contains_a_token() {
        let response = TokenResponse {
            access_token: "super-secret-access".into(),
            refresh_token: Some("super-secret-refresh".into()),
            expires_in: 3599,
        };

        let rendered = format!("{response:?}");

        assert!(!rendered.contains("super-secret-access"));
        assert!(!rendered.contains("super-secret-refresh"));
        assert!(rendered.contains("<redacted>"));
        assert!(rendered.contains("3599"));
    }

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
