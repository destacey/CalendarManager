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
