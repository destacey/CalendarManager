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
