//! DPAPI-encrypted file storage for the refresh token.
//!
//! Replaces Windows Credential Manager, whose `keyring`-encoded blob is capped
//! at 2560 bytes because `set_password` writes it as UTF-16 and Credential
//! Manager caps a credential's `CredentialBlob` at that many bytes. Entra
//! refresh tokens routinely exceed the ~1280-character budget that leaves, and
//! Microsoft documents that clients must not assume any maximum token length
//! — so this is not a size the app can just avoid. DPAPI has no such limit:
//! it is the same mechanism MSAL's own Windows token cache uses to encrypt an
//! on-disk cache file bound to the current user, which is exactly the shape
//! this module gives the refresh token.
//!
//! `CryptProtectData`/`CryptUnprotectData` bind the ciphertext to the calling
//! user's logon credentials with no extra entropy: entropy would itself need
//! to be stored somewhere, and stashing it beside the ciphertext (the only
//! place available to an unattended desktop app) buys nothing over DPAPI's
//! own per-user key.

use std::fs;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use super::error::{AuthError, AuthResult};

/// Encrypt `secret` with DPAPI, bound to the current user, and durably write
/// it to `path`.
///
/// Writes to a temporary sibling file first and renames it over `path`, so a
/// process that dies mid-write leaves either the old file or the new one —
/// never a truncated file that would decrypt (or fail to) unpredictably.
pub fn store(path: &Path, secret: &str) -> AuthResult<()> {
    let ciphertext = encrypt(secret.as_bytes())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AuthError::SecretStore(format!("could not create {}: {e}", parent.display())))?;
    }

    let temp_path = sibling_temp_path(path);
    fs::write(&temp_path, &ciphertext).map_err(|e| {
        AuthError::SecretStore(format!("could not write {}: {e}", temp_path.display()))
    })?;
    fs::rename(&temp_path, path).map_err(|e| {
        // Best-effort cleanup of the temp file; the write error is what matters.
        let _ = fs::remove_file(&temp_path);
        AuthError::SecretStore(format!(
            "could not replace {} with {}: {e}",
            path.display(),
            temp_path.display()
        ))
    })
}

/// Read and decrypt the secret at `path`.
///
/// `Ok(None)` means "no usable secret is stored": the file is absent, or it
/// exists but cannot be decrypted (corrupted, or written by a different
/// Windows account — DPAPI ties the key to the user, and a roamed master key
/// can also be transiently unreachable). In the latter case the file is
/// preserved by renaming it to `<name>.corrupt` rather than deleted, so a
/// transient DPAPI failure can't destroy a perfectly good credential and the
/// bytes remain available for diagnosis. This app builds with
/// `windows_subsystem = "windows"` in release, so there is no console for
/// `eprintln!` to reach; the renamed file, not stderr, is what a developer
/// actually has to go on.
pub fn load(path: &Path) -> AuthResult<Option<String>> {
    let ciphertext = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AuthError::SecretStore(format!(
                "could not read {}: {e}",
                path.display()
            )))
        }
    };

    match decrypt(&ciphertext) {
        Ok(plaintext) => {
            let secret = String::from_utf8(plaintext).map_err(|_| {
                AuthError::SecretStore("decrypted secret was not valid UTF-8".into())
            });
            match secret {
                Ok(secret) => Ok(Some(secret)),
                Err(_) => {
                    eprintln!(
                        "secret_store: {} decrypted to non-UTF-8 data; discarding it",
                        path.display()
                    );
                    let _ = fs::remove_file(path);
                    Ok(None)
                }
            }
        }
        Err(_) => {
            eprintln!(
                "secret_store: {} could not be decrypted (corrupt, or written by a different \
                 account); preserving it as {}.corrupt for diagnosis",
                path.display(),
                path.display()
            );
            let _ = fs::rename(path, corrupt_path(path));
            Ok(None)
        }
    }
}

/// The sibling path a corrupt secret file is renamed to, so it can be
/// inspected rather than lost. A fixed name (not a fresh UUID each time) so
/// repeated failures overwrite the same file instead of littering the
/// directory.
fn corrupt_path(path: &Path) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "secret".into());
    path.with_file_name(format!("{file_name}.corrupt"))
}

/// Remove the stored secret. Already-absent is success, not a failure.
pub fn clear(path: &Path) -> AuthResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AuthError::SecretStore(format!(
            "could not remove {}: {e}",
            path.display()
        ))),
    }
}

/// A same-directory temp path so the final `rename` is same-filesystem (and
/// therefore atomic on NTFS) rather than a cross-volume copy.
fn sibling_temp_path(path: &Path) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "secret".into());
    path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

/// Encrypt `plaintext` with `CryptProtectData`, bound to the current user.
///
/// # Safety invariant
/// `CryptProtectData` allocates its output buffer via `LocalAlloc` and hands
/// ownership to the caller through `out_blob.pbData`; the API contract is
/// that the caller must free it with `LocalFree`. That free happens in this
/// function on every path — success and each early return — via `OutputBlob`,
/// a tiny RAII guard whose `Drop` calls `LocalFree` unconditionally. The
/// unsafe block itself does nothing but call the FFI function and copy bytes
/// out of the buffer it describes; it never has to reason about the free
/// because `OutputBlob` will always run to do that.
fn encrypt(plaintext: &[u8]) -> AuthResult<Vec<u8>> {
    // The blob borrows `plaintext` only for the duration of the call below;
    // it never outlives this function.
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };

    let mut out_blob = CRYPT_INTEGER_BLOB::default();

    // SAFETY: `in_blob` points at `plaintext`, which is alive for this whole
    // call. `out_blob` is a valid, zero-initialized location for the API to
    // write an output blob descriptor into. No entropy, no prompt (UI is
    // forbidden), no description. On success, ownership of the buffer
    // `out_blob.pbData` points at passes to us; it is wrapped immediately
    // below so it is freed exactly once regardless of what happens after.
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if ok.is_err() {
        return Err(AuthError::SecretStore(format!(
            "CryptProtectData failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    // From here on `out_blob.pbData` is a LocalAlloc'd buffer we own; wrap it
    // so it is freed on every subsequent return path.
    let guard = OutputBlob(out_blob);
    Ok(guard.as_slice().to_vec())
}

/// Decrypt bytes produced by `encrypt`/`CryptProtectData`.
///
/// # Safety invariant
/// Same shape as `encrypt`: `CryptUnprotectData` LocalAlloc's its output
/// buffer, and `OutputBlob`'s `Drop` frees it unconditionally on every path
/// out of this function.
fn decrypt(ciphertext: &[u8]) -> AuthResult<Vec<u8>> {
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };

    let mut out_blob = CRYPT_INTEGER_BLOB::default();

    // SAFETY: `in_blob` points at `ciphertext`, alive for this whole call.
    // `out_blob` is a valid, zero-initialized output location. On success the
    // returned buffer is immediately handed to `OutputBlob`, which guarantees
    // the matching `LocalFree`.
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if ok.is_err() {
        return Err(AuthError::SecretStore(format!(
            "CryptUnprotectData failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    let guard = OutputBlob(out_blob);
    Ok(guard.as_slice().to_vec())
}

/// Owns a `CRYPT_INTEGER_BLOB` whose `pbData` was `LocalAlloc`'d by DPAPI.
/// `Drop` frees it with `LocalFree` unconditionally, which is what makes the
/// free unconditional across every return path in `encrypt`/`decrypt` above.
struct OutputBlob(CRYPT_INTEGER_BLOB);

impl OutputBlob {
    fn as_slice(&self) -> &[u8] {
        if self.0.pbData.is_null() || self.0.cbData == 0 {
            return &[];
        }
        // SAFETY: DPAPI guarantees pbData points at cbData readable bytes for
        // a successful call, and this guard is only ever constructed from
        // such a result. The slice's lifetime is tied to &self, so it cannot
        // outlive the buffer LocalFree will release.
        unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize) }
    }
}

impl Drop for OutputBlob {
    fn drop(&mut self) {
        if !self.0.pbData.is_null() {
            // SAFETY: pbData was allocated by DPAPI via LocalAlloc, per the
            // Win32 contract for CryptProtectData/CryptUnprotectData output
            // buffers. Freeing it here, exactly once, on every path (this is
            // a Drop impl) is the API's required cleanup.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0.pbData as *mut core::ffi::c_void)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "calendar-manager-secret-store-test-{label}-{nanos}-{}.bin",
            uuid::Uuid::new_v4()
        ))
    }

    struct TempPath(std::path::PathBuf);

    impl Drop for TempPath {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_file(corrupt_path(&self.0));
        }
    }

    #[test]
    fn round_trips_a_short_secret() {
        let path = TempPath(unique_temp_path("short"));

        store(&path.0, "hunter2").unwrap();
        let loaded = load(&path.0).unwrap();

        assert_eq!(loaded.as_deref(), Some("hunter2"));
    }

    #[test]
    fn round_trips_a_4000_character_secret() {
        // Regression test for the actual bug: Credential Manager's 2560-byte
        // UTF-16 cap broke at well under this size.
        let path = TempPath(unique_temp_path("long"));
        let secret: String = "a".repeat(4000);

        store(&path.0, &secret).unwrap();
        let loaded = load(&path.0).unwrap();

        assert_eq!(loaded.as_deref(), Some(secret.as_str()));
    }

    #[test]
    fn load_on_a_missing_path_returns_none() {
        let path = unique_temp_path("missing");
        assert!(!path.exists());

        assert_eq!(load(&path).unwrap(), None);
    }

    #[test]
    fn the_bytes_on_disk_do_not_contain_the_plaintext() {
        let path = TempPath(unique_temp_path("plaintext-check"));
        let secret = "correct-horse-battery-staple-do-not-leak-me";

        store(&path.0, secret).unwrap();
        let on_disk = fs::read(&path.0).unwrap();
        let on_disk_text = String::from_utf8_lossy(&on_disk);

        assert!(!on_disk_text.contains(secret));
    }

    #[test]
    fn a_corrupt_file_makes_load_return_none_and_preserves_it_as_dot_corrupt() {
        let path = TempPath(unique_temp_path("corrupt"));
        let bytes: &[u8] = b"not a valid DPAPI blob at all";
        fs::write(&path.0, bytes).unwrap();

        let loaded = load(&path.0).unwrap();

        assert_eq!(loaded, None);
        assert!(!path.0.exists());

        let corrupt = corrupt_path(&path.0);
        assert!(corrupt.exists());
        assert_eq!(fs::read(&corrupt).unwrap(), bytes);
    }

    #[test]
    fn a_second_corrupt_load_overwrites_the_existing_dot_corrupt_file() {
        let path = TempPath(unique_temp_path("corrupt-overwrite"));
        fs::write(&path.0, b"first corrupt payload").unwrap();
        assert_eq!(load(&path.0).unwrap(), None);
        assert!(corrupt_path(&path.0).exists());

        // A fresh corrupt file at the same original path, decrypted a second time.
        fs::write(&path.0, b"second corrupt payload").unwrap();
        let loaded = load(&path.0).unwrap();

        assert_eq!(loaded, None);
        assert!(!path.0.exists());
        let corrupt = corrupt_path(&path.0);
        assert!(corrupt.exists());
        assert_eq!(fs::read(&corrupt).unwrap(), b"second corrupt payload");
    }

    #[test]
    fn clear_removes_the_file() {
        let path = TempPath(unique_temp_path("clear"));
        store(&path.0, "secret").unwrap();
        assert!(path.0.exists());

        clear(&path.0).unwrap();

        assert!(!path.0.exists());
    }

    #[test]
    fn clear_on_an_absent_file_succeeds() {
        let path = unique_temp_path("clear-absent");
        assert!(!path.exists());

        assert!(clear(&path).is_ok());
    }

    #[test]
    fn storing_twice_overwrites_rather_than_appending() {
        let path = TempPath(unique_temp_path("overwrite"));

        store(&path.0, "first-secret").unwrap();
        store(&path.0, "second-secret").unwrap();

        assert_eq!(load(&path.0).unwrap().as_deref(), Some("second-secret"));
    }
}
