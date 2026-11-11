//! Error type shared by all codecs.

use std::fmt;

/// Error returned by every fallible codec operation.
///
/// The message names the failing call and, for Apple APIs, the `OSStatus` code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodecError {
    message: String,
    status: Option<i32>,
}

impl CodecError {
    /// Create an error from a plain message.
    pub fn new(message: impl Into<String>) -> Self {
        CodecError { message: message.into(), status: None }
    }

    /// Create an error from a failing OS call (`OSStatus` / `CVReturn`).
    pub fn os(context: &str, status: i32) -> Self {
        let bytes = status.to_be_bytes();
        let fcc = if bytes.iter().all(|b| b.is_ascii_graphic() || *b == b' ') {
            format!(" '{}'", String::from_utf8_lossy(&bytes))
        } else {
            String::new()
        };
        CodecError { message: format!("{context} failed: OSStatus {status}{fcc}"), status: Some(status) }
    }

    /// Human readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The `OSStatus` code, if this error came from an Apple API.
    pub fn status(&self) -> Option<i32> {
        self.status
    }
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CodecError {}

/// Crate result alias.
pub type Result<T> = std::result::Result<T, CodecError>;

#[cfg(target_os = "macos")]
pub(crate) fn check(context: &str, status: i32) -> Result<()> {
    if status == 0 {
        Ok(())
    } else {
        Err(CodecError::os(context, status))
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn unsupported<T>() -> Result<T> {
    Err(CodecError::new("unsupported platform"))
}
