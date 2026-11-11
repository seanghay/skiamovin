//! Native video and audio codecs for skiamovin.
//!
//! On macOS this uses VideoToolbox (H.264 and HEVC) and AudioToolbox (AAC
//! encode, AAC and MP3 decode). On other platforms every constructor returns
//! an error and [`capabilities`] reports nothing.
//!
//! Conventions:
//! * Timestamps and durations are in microseconds.
//! * Video packets are NAL units with 4-byte length prefixes, as in MP4.
//!   [`VideoEncoder::description`] is the matching `avcC`/`hvcC` record.
//! * Audio packets are raw AAC frames without ADTS headers.
//!   [`AudioEncoder::description`] is the AudioSpecificConfig.
//! * All types are `Send` but not `Sync`.

pub mod aac;
mod audio_decoder;
mod audio_encoder;
mod caps;
mod error;
mod iosurface;
pub mod nal;
mod video_decoder;
mod video_encoder;

#[cfg(target_os = "macos")]
mod cf;
#[cfg(target_os = "macos")]
mod ffi;

pub use audio_decoder::{AudioDecoder, DecodedAudio};
pub use audio_encoder::{AudioEncoder, EncodedAudioPacket};
pub use caps::{capabilities, Capabilities};
pub use error::{CodecError, Result};
pub use iosurface::{create_iosurface_bgra, IOSurfaceHandle};
pub use video_decoder::{DecodedSurface, DecodedVideoFrame, VideoDecoder, DEFAULT_REORDER_DEPTH};
pub use video_encoder::{EncodedVideoPacket, VideoEncoder, VideoEncoderConfig};

/// Video codec family.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VideoCodec {
    /// H.264 / AVC (`avc1`, description = `avcC`).
    Avc,
    /// H.265 / HEVC (`hvc1`, description = `hvcC`).
    Hevc,
}

/// Audio codec family.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AudioCodec {
    /// MPEG-4 AAC (encoder produces AAC-LC).
    Aac,
    /// MPEG-1/2 Layer III (decode only).
    Mp3,
}
