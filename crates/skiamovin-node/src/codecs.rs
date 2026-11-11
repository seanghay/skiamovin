//! Native codecs (VideoToolbox and AudioToolbox) for JavaScript, used as Mediabunny custom encoders and
//! decoders. Timestamps are in microseconds.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use skiamovin_codecs as c;

fn err(e: impl std::fmt::Display) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, e.to_string())
}

fn video_codec(s: &str) -> Result<c::VideoCodec> {
    match s {
        "avc" => Ok(c::VideoCodec::Avc),
        "hevc" => Ok(c::VideoCodec::Hevc),
        o => Err(err(format!("unsupported video codec '{o}'"))),
    }
}

#[napi(object)]
pub struct NativePacket {
    pub data: Uint8Array,
    pub timestamp: f64,
    pub duration: f64,
    pub key: bool,
}

#[napi(object)]
pub struct NativeVideoFrame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub data: Uint8Array,
    pub timestamp: f64,
    pub duration: f64,
}

#[napi(object)]
pub struct NativeAudioData {
    pub data: Float32Array,
    pub frames: u32,
    pub channels: u32,
    pub sample_rate: u32,
    pub timestamp: f64,
}

#[napi(object)]
pub struct NativeCodecCapabilities {
    pub video_encode: Vec<String>,
    pub video_encode_hardware: Vec<String>,
    pub video_decode: Vec<String>,
    pub video_decode_hardware: Vec<String>,
    pub audio_encode: Vec<String>,
    pub audio_decode: Vec<String>,
}

fn vname(v: c::VideoCodec) -> String {
    match v {
        c::VideoCodec::Avc => "avc".into(),
        c::VideoCodec::Hevc => "hevc".into(),
    }
}
fn aname(a: c::AudioCodec) -> String {
    match a {
        c::AudioCodec::Aac => "aac".into(),
        c::AudioCodec::Mp3 => "mp3".into(),
    }
}

#[napi(js_name = "codec_capabilities")]
pub fn codec_capabilities() -> NativeCodecCapabilities {
    let caps = c::capabilities();
    NativeCodecCapabilities {
        video_encode: caps.video_encode.iter().map(|(v, _)| vname(*v)).collect(),
        video_encode_hardware: caps.video_encode.iter().filter(|(_, hw)| *hw).map(|(v, _)| vname(*v)).collect(),
        video_decode: caps.video_decode.iter().map(|(v, _)| vname(*v)).collect(),
        video_decode_hardware: caps.video_decode.iter().filter(|(_, hw)| *hw).map(|(v, _)| vname(*v)).collect(),
        audio_encode: caps.audio_encode.iter().map(|a| aname(*a)).collect(),
        audio_decode: caps.audio_decode.iter().map(|a| aname(*a)).collect(),
    }
}

#[napi(object)]
pub struct NativeVideoEncoderConfig {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub bitrate: Option<f64>,
    pub frame_rate: Option<f64>,
    pub key_frame_interval: Option<f64>,
    pub realtime: Option<bool>,
    pub prefer_hardware: Option<bool>,
    pub alpha: Option<bool>,
}

#[napi]
pub struct NativeVideoEncoder {
    inner: c::VideoEncoder,
    width: u32,
    height: u32,
}

#[napi]
impl NativeVideoEncoder {
    #[napi(constructor)]
    pub fn new(config: NativeVideoEncoderConfig) -> Result<Self> {
        let mut cfg = c::VideoEncoderConfig::new(video_codec(&config.codec)?, config.width, config.height);
        cfg.bitrate = config.bitrate.map(|b| b as u32);
        cfg.frame_rate = config.frame_rate;
        cfg.key_frame_interval = config.key_frame_interval;
        cfg.realtime = config.realtime.unwrap_or(false);
        cfg.prefer_hardware = config.prefer_hardware.unwrap_or(true);
        cfg.alpha = config.alpha.unwrap_or(false);
        Ok(Self { inner: c::VideoEncoder::new(cfg).map_err(err)?, width: config.width, height: config.height })
    }

    /// BGRA8 pixels, `stride` bytes per row.
    #[napi]
    pub fn encode_bgra(
        &mut self,
        data: Uint8Array,
        stride: u32,
        timestamp: f64,
        duration: f64,
        key: bool,
    ) -> Result<()> {
        self.inner.encode_bgra(&data, stride as usize, timestamp as i64, duration as i64, key).map_err(err)
    }

    /// Encodes the current contents of a Skiamovin surface (by handle).
    #[napi]
    pub fn encode_surface(&mut self, surface: u32, timestamp: f64, duration: f64, key: bool) -> Result<()> {
        let px = skiamovin_core::api::surface::surface_read_pixels(
            surface,
            0,
            0,
            self.width as i32,
            self.height as i32,
            1,
            2,
        )
        .map_err(err)?;
        self.inner.encode_bgra(&px, self.width as usize * 4, timestamp as i64, duration as i64, key).map_err(err)
    }

    /// Encodes an IOSurface-backed Skiamovin surface without copying its pixels.
    /// Waits for the GPU to finish the frame, then until at most `max_in_flight` frames are still encoding.
    /// Do not draw into the surface again until its frame is done.
    #[napi]
    pub fn encode_surface_zero_copy(
        &mut self,
        surface: u32,
        timestamp: f64,
        duration: f64,
        key: bool,
        max_in_flight: u32,
    ) -> Result<()> {
        let ptr = skiamovin_core::api::surface::surface_iosurface(surface).map_err(err)? as usize;
        if ptr == 0 {
            return self.encode_surface(surface, timestamp, duration, key);
        }
        skiamovin_core::api::surface::surface_flush_sync(surface).map_err(err)?;
        unsafe { self.inner.encode_iosurface(ptr as *mut std::ffi::c_void, timestamp as i64, duration as i64, key) }
            .map_err(err)?;
        self.inner.wait_in_flight(max_in_flight as usize).map_err(err)
    }

    #[napi]
    pub fn in_flight(&self) -> u32 {
        self.inner.in_flight() as u32
    }

    /// Encodes a Skiamovin image (by handle). GPU images are copied to the CPU first.
    #[napi]
    pub fn encode_image(&mut self, image: u32, timestamp: f64, duration: f64, key: bool) -> Result<()> {
        let px =
            skiamovin_core::api::image::image_read_pixels(image, 0, 0, self.width as i32, self.height as i32, 1, 2)
                .map_err(err)?;
        self.inner.encode_bgra(&px, self.width as usize * 4, timestamp as i64, duration as i64, key).map_err(err)
    }

    #[napi]
    pub fn flush(&mut self) -> Result<()> {
        self.inner.flush().map_err(err)
    }

    #[napi]
    pub fn take_packets(&mut self) -> Vec<NativePacket> {
        self.inner
            .take_packets()
            .into_iter()
            .map(|p| NativePacket {
                data: Uint8Array::new(p.data),
                timestamp: p.timestamp_us as f64,
                duration: p.duration_us as f64,
                key: p.key,
            })
            .collect()
    }

    #[napi]
    pub fn description(&self) -> Option<Uint8Array> {
        self.inner.description().map(Uint8Array::new)
    }

    #[napi]
    pub fn is_hardware_accelerated(&self) -> bool {
        self.inner.is_hardware_accelerated()
    }
}

/// A decoded frame that still lives in the decoder's IOSurface.
#[napi]
pub struct NativeDecodedSurface {
    inner: Option<c::DecodedSurface>,
    width: u32,
    height: u32,
    timestamp: f64,
    duration: f64,
}

#[napi]
impl NativeDecodedSurface {
    #[napi(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[napi(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[napi(getter)]
    pub fn timestamp(&self) -> f64 {
        self.timestamp
    }
    #[napi(getter)]
    pub fn duration(&self) -> f64 {
        self.duration
    }
    /// IOSurfaceRef pointer (0 after release).
    #[napi]
    pub fn iosurface(&self) -> f64 {
        self.inner.as_ref().map(|s| s.iosurface() as usize as f64).unwrap_or(0.0)
    }
    /// Copies the pixels out (BGRA).
    #[napi]
    pub fn to_bgra(&self) -> Result<NativeVideoFrame> {
        let s = self.inner.as_ref().ok_or_else(|| err("frame has been released"))?;
        let f = s.to_bgra();
        Ok(NativeVideoFrame {
            width: f.width,
            height: f.height,
            stride: f.stride as u32,
            data: Uint8Array::new(f.bgra),
            timestamp: f.timestamp_us as f64,
            duration: f.duration_us as f64,
        })
    }
    /// Returns the buffer to the decoder's pool.
    #[napi]
    pub fn release(&mut self) {
        self.inner = None;
    }
}

#[napi]
pub struct NativeVideoDecoder {
    inner: c::VideoDecoder,
}

#[napi]
impl NativeVideoDecoder {
    #[napi(constructor)]
    pub fn new(codec: String, description: Uint8Array, coded_width: u32, coded_height: u32) -> Result<Self> {
        Ok(Self {
            inner: c::VideoDecoder::new(video_codec(&codec)?, &description, coded_width, coded_height).map_err(err)?,
        })
    }

    /// Asynchronous decoding: decode() returns at once and frames arrive later.
    #[napi]
    pub fn set_async(&mut self, enabled: bool) {
        self.inner.set_async(enabled);
    }

    #[napi]
    pub fn pending(&self) -> u32 {
        self.inner.pending() as u32
    }

    #[napi]
    pub fn wait_pending(&mut self, max: u32) -> Result<()> {
        self.inner.wait_pending(max as usize).map_err(err)
    }

    #[napi]
    pub fn set_zero_copy(&mut self, enabled: bool) {
        self.inner.set_zero_copy(enabled);
    }

    #[napi]
    pub fn take_surfaces(&mut self) -> Vec<NativeDecodedSurface> {
        self.inner
            .take_surfaces()
            .into_iter()
            .map(|s| NativeDecodedSurface {
                width: s.width,
                height: s.height,
                timestamp: s.timestamp_us as f64,
                duration: s.duration_us as f64,
                inner: Some(s),
            })
            .collect()
    }

    #[napi]
    pub fn set_reorder_depth(&mut self, depth: u32) {
        self.inner.set_reorder_depth(depth as usize);
    }

    #[napi]
    pub fn decode(&mut self, data: Uint8Array, timestamp: f64, duration: f64, key: bool) -> Result<()> {
        self.inner.decode(&data, timestamp as i64, duration as i64, key).map_err(err)
    }

    #[napi]
    pub fn flush(&mut self) -> Result<()> {
        self.inner.flush().map_err(err)
    }

    #[napi]
    pub fn take_frames(&mut self) -> Vec<NativeVideoFrame> {
        self.inner
            .take_frames()
            .into_iter()
            .map(|f| NativeVideoFrame {
                width: f.width,
                height: f.height,
                stride: f.stride as u32,
                data: Uint8Array::new(f.bgra),
                timestamp: f.timestamp_us as f64,
                duration: f.duration_us as f64,
            })
            .collect()
    }
}

#[napi]
pub struct NativeAudioEncoder {
    inner: c::AudioEncoder,
}

#[napi]
impl NativeAudioEncoder {
    #[napi(constructor)]
    pub fn new(sample_rate: u32, channels: u32, bitrate: Option<f64>) -> Result<Self> {
        Ok(Self { inner: c::AudioEncoder::new(sample_rate, channels, bitrate.map(|b| b as u32)).map_err(err)? })
    }

    #[napi]
    pub fn encode(&mut self, interleaved: Float32Array, timestamp: f64) -> Result<()> {
        self.inner.encode_f32_interleaved(&interleaved, timestamp as i64).map_err(err)
    }

    #[napi]
    pub fn flush(&mut self) -> Result<()> {
        self.inner.flush().map_err(err)
    }

    #[napi]
    pub fn take_packets(&mut self) -> Vec<NativePacket> {
        self.inner
            .take_packets()
            .into_iter()
            .map(|p| NativePacket {
                data: Uint8Array::new(p.data),
                timestamp: p.timestamp_us as f64,
                duration: p.duration_us as f64,
                key: true,
            })
            .collect()
    }

    #[napi]
    pub fn description(&self) -> Uint8Array {
        Uint8Array::new(self.inner.description())
    }

    #[napi]
    pub fn priming_frames(&self) -> u32 {
        self.inner.priming_frames()
    }
}

#[napi]
pub struct NativeAudioDecoder {
    inner: c::AudioDecoder,
}

#[napi]
impl NativeAudioDecoder {
    #[napi(constructor)]
    pub fn new(codec: String, sample_rate: u32, channels: u32, description: Option<Uint8Array>) -> Result<Self> {
        let codec = match codec.as_str() {
            "aac" => c::AudioCodec::Aac,
            "mp3" => c::AudioCodec::Mp3,
            o => return Err(err(format!("unsupported audio codec '{o}'"))),
        };
        let d = description.as_ref().map(|d| d.as_ref());
        Ok(Self { inner: c::AudioDecoder::new(codec, sample_rate, channels, d).map_err(err)? })
    }

    #[napi]
    pub fn decode(&mut self, data: Uint8Array, timestamp: f64) -> Result<()> {
        self.inner.decode(&data, timestamp as i64).map_err(err)
    }

    #[napi]
    pub fn flush(&mut self) -> Result<()> {
        self.inner.flush().map_err(err)
    }

    #[napi]
    pub fn take_audio(&mut self) -> Vec<NativeAudioData> {
        self.inner
            .take_audio()
            .into_iter()
            .map(|a| NativeAudioData {
                frames: a.frames as u32,
                channels: a.channels,
                sample_rate: a.sample_rate,
                timestamp: a.timestamp_us as f64,
                data: Float32Array::new(a.samples),
            })
            .collect()
    }
}
