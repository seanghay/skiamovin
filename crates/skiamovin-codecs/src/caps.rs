//! Runtime capability probing.

use crate::{AudioCodec, VideoCodec};

/// What this machine can encode/decode. The `bool` is "hardware accelerated".
#[derive(Clone, Debug, Default)]
pub struct Capabilities {
    pub video_encode: Vec<(VideoCodec, bool)>,
    pub video_decode: Vec<(VideoCodec, bool)>,
    pub audio_encode: Vec<AudioCodec>,
    pub audio_decode: Vec<AudioCodec>,
}

/// Probe codec support. This takes a few milliseconds, so cache the result.
#[cfg(target_os = "macos")]
pub fn capabilities() -> Capabilities {
    use crate::ffi::*;
    use crate::{AudioEncoder, VideoEncoder, VideoEncoderConfig};

    let mut caps = Capabilities::default();
    for codec in [VideoCodec::Avc, VideoCodec::Hevc] {
        let cfg = VideoEncoderConfig::new(codec, 256, 256);
        if let Ok(enc) = VideoEncoder::new(cfg) {
            caps.video_encode.push((codec, enc.is_hardware_accelerated()));
        }
        let ct = match codec {
            VideoCodec::Avc => kCMVideoCodecType_H264,
            VideoCodec::Hevc => kCMVideoCodecType_HEVC,
        };
        // macOS ships software decoders for both codecs.
        let hw = unsafe { VTIsHardwareDecodeSupported(ct) != 0 };
        caps.video_decode.push((codec, hw));
    }
    if AudioEncoder::new(48000, 2, None).is_ok() {
        caps.audio_encode.push(AudioCodec::Aac);
    }
    for codec in [AudioCodec::Aac, AudioCodec::Mp3] {
        if crate::AudioDecoder::new(codec, 44100, 2, None).is_ok() {
            caps.audio_decode.push(codec);
        }
    }
    caps
}

/// Unsupported platform: nothing available.
#[cfg(not(target_os = "macos"))]
pub fn capabilities() -> Capabilities {
    Capabilities::default()
}
