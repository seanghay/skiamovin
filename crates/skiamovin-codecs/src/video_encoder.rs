//! H.264 and HEVC encoder using `VTCompressionSession`.
//!
//! B-frames are disabled, so packets come out in presentation order.
//! Packets use 4-byte length prefixes, as stored in MP4 samples.

use crate::{Result, VideoCodec};

/// Encoder configuration.
#[derive(Clone, Debug)]
pub struct VideoEncoderConfig {
    pub codec: VideoCodec,
    pub width: u32,
    pub height: u32,
    /// Average bitrate in bits per second. `None` uses quality-based encoding.
    pub bitrate: Option<u32>,
    pub frame_rate: Option<f64>,
    /// Maximum seconds between key frames.
    pub key_frame_interval: Option<f64>,
    /// Ask for low-latency encoding.
    pub realtime: bool,
    /// Try a hardware encoder first, then fall back to any encoder.
    pub prefer_hardware: bool,
    /// Encode an alpha channel. HEVC only.
    pub alpha: bool,
    /// Prefer encoding speed over quality when the encoder supports it (macOS 12+).
    pub speed_over_quality: bool,
}

impl VideoEncoderConfig {
    /// Default settings for the given codec and size.
    pub fn new(codec: VideoCodec, width: u32, height: u32) -> Self {
        VideoEncoderConfig {
            codec,
            width,
            height,
            bitrate: None,
            frame_rate: None,
            key_frame_interval: None,
            realtime: false,
            prefer_hardware: true,
            alpha: false,
            speed_over_quality: false,
        }
    }
}

/// One encoded access unit.
#[derive(Clone, Debug)]
pub struct EncodedVideoPacket {
    /// NAL units with 4-byte big-endian length prefixes.
    pub data: Vec<u8>,
    pub timestamp_us: i64,
    pub duration_us: i64,
    pub key: bool,
}

#[cfg(target_os = "macos")]
pub use imp::VideoEncoder;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::cf::*;
    use crate::error::check;
    use crate::ffi::*;
    use crate::CodecError;
    use std::collections::VecDeque;
    use std::ffi::c_void;
    use std::ptr;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    /// State shared with the output callback.
    struct Inner {
        state: Mutex<Shared>,
        done: Condvar,
    }

    struct Shared {
        /// Timestamps of submitted frames whose output callback has not fired.
        in_flight: VecDeque<CMTime>,
        codec: VideoCodec,
        packets: Vec<EncodedVideoPacket>,
        description: Option<Vec<u8>>,
        error: Option<CodecError>,
    }

    /// Hardware-accelerated (when available) H.264/HEVC encoder.
    pub struct VideoEncoder {
        session: VTCompressionSessionRef,
        shared: Arc<Inner>,
        config: VideoEncoderConfig,
        hardware: bool,
    }

    // The session is never used concurrently because all methods take
    // `&mut self`, and shared state is behind a Mutex.
    unsafe impl Send for VideoEncoder {}

    unsafe extern "C" fn output_callback(
        refcon: *mut c_void,
        _frame_refcon: *mut c_void,
        status: OSStatus,
        info_flags: u32,
        sbuf: CMSampleBufferRef,
    ) {
        let inner = &*(refcon as *const Inner);
        inner.done.notify_all(); // waiters wake once the lock is released
        let mut s = match inner.state.lock() {
            Ok(s) => s,
            Err(p) => p.into_inner(),
        };
        // The callback fires once per submitted frame, including dropped
        // frames and errors.
        let cb_pts = if sbuf.is_null() { None } else { Some(CMSampleBufferGetPresentationTimeStamp(sbuf)) };
        match cb_pts.and_then(|t| s.in_flight.iter().position(|q| q.value == t.value && q.timescale == t.timescale)) {
            Some(i) => {
                s.in_flight.remove(i);
            }
            None => {
                s.in_flight.pop_front();
            }
        }
        if status != 0 {
            s.error = Some(CodecError::os("VideoToolbox encode (callback)", status));
            return;
        }
        if sbuf.is_null() || info_flags & kVTEncodeInfo_FrameDropped != 0 {
            return;
        }
        let block = CMSampleBufferGetDataBuffer(sbuf);
        if block.is_null() {
            return;
        }
        let len = CMBlockBufferGetDataLength(block);
        let mut data = vec![0u8; len];
        let st = CMBlockBufferCopyDataBytes(block, 0, len, data.as_mut_ptr() as *mut c_void);
        if st != 0 {
            s.error = Some(CodecError::os("CMBlockBufferCopyDataBytes", st));
            return;
        }

        let mut key = true;
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sbuf, 0);
        if !attachments.is_null() && CFArrayGetCount(attachments) > 0 {
            let dict = CFArrayGetValueAtIndex(attachments, 0);
            if !dict.is_null() {
                let not_sync = CFDictionaryGetValue(dict, kCMSampleAttachmentKey_NotSync);
                if cf_bool_value(not_sync) == Some(true) {
                    key = false;
                }
            }
        }

        if key || s.description.is_none() {
            let fd = CMSampleBufferGetFormatDescription(sbuf);
            if !fd.is_null() {
                if let Some(desc) = extract_description(fd, s.codec) {
                    s.description = Some(desc);
                }
            }
        }

        let pts = CMSampleBufferGetPresentationTimeStamp(sbuf);
        let dur = CMSampleBufferGetDuration(sbuf);
        s.packets.push(EncodedVideoPacket { data, timestamp_us: pts.to_us(), duration_us: dur.to_us(), key });
    }

    /// Pull the avcC/hvcC record out of a format description.
    unsafe fn extract_description(fd: CMFormatDescriptionRef, codec: VideoCodec) -> Option<Vec<u8>> {
        let atoms = CMFormatDescriptionGetExtension(fd, kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms);
        if !atoms.is_null() && CFGetTypeID(atoms) == CFDictionaryGetTypeID() {
            let key = cf_str(match codec {
                VideoCodec::Avc => "avcC",
                VideoCodec::Hevc => "hvcC",
            });
            let d = CFDictionaryGetValue(atoms, key.as_ptr());
            if !d.is_null() && CFGetTypeID(d) == CFDataGetTypeID() {
                let bytes = cf_data_bytes(d);
                if !bytes.is_empty() {
                    return Some(bytes);
                }
            }
        }
        if codec == VideoCodec::Avc {
            return build_avcc(fd);
        }
        None
    }

    /// Build an avcC record from the parameter sets.
    unsafe fn build_avcc(fd: CMFormatDescriptionRef) -> Option<Vec<u8>> {
        let mut count = 0usize;
        let mut nal_len = 0i32;
        let st = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            fd,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut count,
            &mut nal_len,
        );
        if st != 0 || count < 2 {
            return None;
        }
        let mut sps = Vec::new();
        let mut pps = Vec::new();
        for i in 0..count {
            let mut p: *const u8 = ptr::null();
            let mut size = 0usize;
            if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                fd,
                i,
                &mut p,
                &mut size,
                ptr::null_mut(),
                ptr::null_mut(),
            ) != 0
                || p.is_null()
            {
                return None;
            }
            let ps = std::slice::from_raw_parts(p, size).to_vec();
            match ps.first().map(|b| b & 0x1f) {
                Some(7) => sps.push(ps),
                Some(8) => pps.push(ps),
                _ => {}
            }
        }
        let first = sps.first()?;
        if first.len() < 4 {
            return None;
        }
        let mut out = vec![1, first[1], first[2], first[3], 0xfc | 3, 0xe0 | sps.len() as u8];
        for s in &sps {
            out.extend_from_slice(&(s.len() as u16).to_be_bytes());
            out.extend_from_slice(s);
        }
        out.push(pps.len() as u8);
        for p in &pps {
            out.extend_from_slice(&(p.len() as u16).to_be_bytes());
            out.extend_from_slice(p);
        }
        Some(out)
    }

    /// Try to create a compression session with the given encoder spec.
    unsafe fn create_session(
        config: &VideoEncoderConfig,
        codec_type: CMVideoCodecType,
        require_hw: Option<bool>,
        refcon: *mut c_void,
    ) -> Result<VTCompressionSessionRef> {
        let mut spec = CfDict::new();
        if let Some(req) = require_hw {
            spec.set(kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder, cf_bool(true));
            spec.set(kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder, cf_bool(req));
        }
        let pixfmt = cf_i32(kCVPixelFormatType_32BGRA as i32);
        let w = cf_i32(config.width as i32);
        let h = cf_i32(config.height as i32);
        let iosurf = CfDict::new();
        let mut attrs = CfDict::new();
        attrs
            .set(kCVPixelBufferPixelFormatTypeKey, pixfmt.as_ptr())
            .set(kCVPixelBufferWidthKey, w.as_ptr())
            .set(kCVPixelBufferHeightKey, h.as_ptr())
            .set(kCVPixelBufferIOSurfacePropertiesKey, iosurf.as_ptr());

        let mut session: VTCompressionSessionRef = ptr::null_mut();
        let st = VTCompressionSessionCreate(
            ptr::null(),
            config.width as i32,
            config.height as i32,
            codec_type,
            spec.as_ptr(),
            attrs.as_ptr(),
            ptr::null(),
            Some(output_callback),
            refcon,
            &mut session,
        );
        check("VTCompressionSessionCreate", st)?;
        if session.is_null() {
            return Err(CodecError::new("VTCompressionSessionCreate returned null session"));
        }
        Ok(session)
    }

    impl VideoEncoder {
        /// Create and configure a compression session.
        pub fn new(config: VideoEncoderConfig) -> Result<Self> {
            if config.width == 0 || config.height == 0 {
                return Err(CodecError::new("width and height must be non-zero"));
            }
            let codec_type = match (config.codec, config.alpha) {
                (VideoCodec::Avc, false) => kCMVideoCodecType_H264,
                (VideoCodec::Avc, true) => {
                    return Err(CodecError::new("alpha is only supported with HEVC"));
                }
                (VideoCodec::Hevc, false) => kCMVideoCodecType_HEVC,
                (VideoCodec::Hevc, true) => kCMVideoCodecType_HEVCWithAlpha,
            };
            let shared = Arc::new(Inner {
                state: Mutex::new(Shared {
                    in_flight: VecDeque::new(),
                    codec: config.codec,
                    packets: Vec::new(),
                    description: None,
                    error: None,
                }),
                done: Condvar::new(),
            });
            let refcon = Arc::as_ptr(&shared) as *mut c_void;

            unsafe {
                let session = if config.prefer_hardware {
                    match create_session(&config, codec_type, Some(true), refcon) {
                        Ok(s) => s,
                        Err(_) => create_session(&config, codec_type, None, refcon)?,
                    }
                } else {
                    create_session(&config, codec_type, None, refcon)?
                };
                let mut enc = VideoEncoder { session, shared, config, hardware: false };
                enc.configure()?;
                check(
                    "VTCompressionSessionPrepareToEncodeFrames",
                    VTCompressionSessionPrepareToEncodeFrames(enc.session),
                )?;
                let mut v: CFTypeRef = ptr::null();
                if VTSessionCopyProperty(
                    enc.session,
                    kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
                    ptr::null(),
                    &mut v,
                ) == 0
                    && !v.is_null()
                {
                    enc.hardware = cf_bool_value(v).unwrap_or(false);
                    CFRelease(v);
                }
                Ok(enc)
            }
        }

        unsafe fn set(&self, key: CFStringRef, value: CFTypeRef) -> OSStatus {
            VTSessionSetProperty(self.session, key, value)
        }

        unsafe fn configure(&mut self) -> Result<()> {
            let c = self.config.clone();
            // Failures on optional properties are ignored.
            self.set(kVTCompressionPropertyKey_RealTime, cf_bool(c.realtime));
            let st = self.set(kVTCompressionPropertyKey_AllowFrameReordering, cf_bool(false));
            check("set AllowFrameReordering=false", st)?;
            let profile = match c.codec {
                VideoCodec::Avc => kVTProfileLevel_H264_High_AutoLevel,
                VideoCodec::Hevc => kVTProfileLevel_HEVC_Main_AutoLevel,
            };
            if !c.alpha {
                self.set(kVTCompressionPropertyKey_ProfileLevel, profile);
            }
            // Tag the stream as BT.709 so encoder and decoder use the same color matrix.
            self.set(kVTCompressionPropertyKey_ColorPrimaries, kCVImageBufferColorPrimaries_ITU_R_709_2);
            self.set(kVTCompressionPropertyKey_TransferFunction, kCVImageBufferTransferFunction_ITU_R_709_2);
            self.set(kVTCompressionPropertyKey_YCbCrMatrix, kCVImageBufferYCbCrMatrix_ITU_R_709_2);
            if let Some(fps) = c.frame_rate.filter(|f| *f > 0.0) {
                self.set(kVTCompressionPropertyKey_ExpectedFrameRate, cf_f64(fps).as_ptr());
            }
            if let Some(ki) = c.key_frame_interval.filter(|k| *k > 0.0) {
                self.set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, cf_f64(ki).as_ptr());
                if let Some(fps) = c.frame_rate.filter(|f| *f > 0.0) {
                    let frames = (ki * fps).round().max(1.0) as i32;
                    self.set(kVTCompressionPropertyKey_MaxKeyFrameInterval, cf_i32(frames).as_ptr());
                }
            }
            match c.bitrate {
                Some(br) => {
                    let st = self.set(kVTCompressionPropertyKey_AverageBitRate, cf_i64(br as i64).as_ptr());
                    check("set AverageBitRate", st)?;
                }
                None => {
                    let st = self.set(kVTCompressionPropertyKey_Quality, cf_f64(0.8).as_ptr());
                    if st != 0 {
                        // About 0.15 bits per pixel per frame.
                        let fps = c.frame_rate.unwrap_or(30.0).max(1.0);
                        let br = (c.width as f64 * c.height as f64 * fps * 0.15) as i64;
                        self.set(kVTCompressionPropertyKey_AverageBitRate, cf_i64(br).as_ptr());
                    }
                }
            }
            if c.alpha {
                self.set(kVTCompressionPropertyKey_TargetQualityForAlpha, cf_f64(0.9).as_ptr());
            }
            if c.speed_over_quality {
                self.set(kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality, cf_bool(true));
            }
            Ok(())
        }

        fn take_error(&self) -> Result<()> {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            match s.error.take() {
                Some(e) => Err(e),
                None => Ok(()),
            }
        }

        unsafe fn encode_pixel_buffer(
            &mut self,
            pb: CVPixelBufferRef,
            timestamp_us: i64,
            duration_us: i64,
            force_key: bool,
        ) -> Result<()> {
            let mut props = None;
            if force_key {
                let mut d = CfDict::new();
                d.set(kVTEncodeFrameOptionKey_ForceKeyFrame, cf_bool(true));
                props = Some(d);
            }
            let dur = if duration_us > 0 { CMTime::from_us(duration_us) } else { CMTime::INVALID };
            let pts = CMTime::from_us(timestamp_us);
            // Register before submitting: the callback may fire before
            // VTCompressionSessionEncodeFrame returns.
            self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).in_flight.push_back(pts);
            let st = VTCompressionSessionEncodeFrame(
                self.session,
                pb,
                pts,
                dur,
                props.as_ref().map_or(ptr::null(), |d| d.as_ptr()),
                ptr::null_mut(),
                ptr::null_mut(),
            );
            if st != 0 {
                // Rejected, so no callback will come for it.
                let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
                if let Some(i) = s.in_flight.iter().rposition(|q| q.value == pts.value && q.timescale == pts.timescale)
                {
                    s.in_flight.remove(i);
                }
            }
            check("VTCompressionSessionEncodeFrame", st)?;
            self.take_error()
        }

        /// Encode one BGRA frame with `stride` bytes per row.
        ///
        /// With `alpha: true`, VideoToolbox treats alpha as not premultiplied.
        pub fn encode_bgra(
            &mut self,
            data: &[u8],
            stride: usize,
            timestamp_us: i64,
            duration_us: i64,
            force_key: bool,
        ) -> Result<()> {
            self.take_error()?;
            let w = self.config.width as usize;
            let h = self.config.height as usize;
            if stride < w * 4 {
                return Err(CodecError::new(format!("stride {stride} < width*4 ({})", w * 4)));
            }
            if data.len() < stride * (h - 1) + w * 4 {
                return Err(CodecError::new(format!(
                    "frame buffer too small: {} bytes for {w}x{h} stride {stride}",
                    data.len()
                )));
            }
            unsafe {
                let mut pb: CVPixelBufferRef = ptr::null_mut();
                let pool = VTCompressionSessionGetPixelBufferPool(self.session);
                if !pool.is_null() {
                    check(
                        "CVPixelBufferPoolCreatePixelBuffer",
                        CVPixelBufferPoolCreatePixelBuffer(ptr::null(), pool, &mut pb),
                    )?;
                } else {
                    let iosurf = CfDict::new();
                    let mut attrs = CfDict::new();
                    attrs.set(kCVPixelBufferIOSurfacePropertiesKey, iosurf.as_ptr());
                    check(
                        "CVPixelBufferCreate",
                        CVPixelBufferCreate(ptr::null(), w, h, kCVPixelFormatType_32BGRA, attrs.as_ptr(), &mut pb),
                    )?;
                }
                let pb_owned = CfOwned(pb as CFTypeRef);
                check("CVPixelBufferLockBaseAddress", CVPixelBufferLockBaseAddress(pb, 0))?;
                let base = CVPixelBufferGetBaseAddress(pb) as *mut u8;
                let dst_stride = CVPixelBufferGetBytesPerRow(pb);
                let rows = h.min(CVPixelBufferGetHeight(pb));
                let row_bytes = (w * 4).min(dst_stride);
                if !base.is_null() {
                    for y in 0..rows {
                        ptr::copy_nonoverlapping(data.as_ptr().add(y * stride), base.add(y * dst_stride), row_bytes);
                    }
                }
                CVPixelBufferUnlockBaseAddress(pb, 0);
                if base.is_null() {
                    return Err(CodecError::new("CVPixelBufferGetBaseAddress returned null"));
                }
                let r = self.encode_pixel_buffer(pb, timestamp_us, duration_us, force_key);
                drop(pb_owned);
                r
            }
        }

        /// Encode a BGRA `IOSurfaceRef` without copying its pixels.
        ///
        /// Do not modify the surface until the frame is encoded. With a ring
        /// of N surfaces, call [`wait_in_flight`](Self::wait_in_flight)`(N - 1)`
        /// before reusing one.
        ///
        /// # Safety
        /// `iosurface` must be a valid BGRA `IOSurfaceRef` with the encoder's
        /// dimensions.
        pub unsafe fn encode_iosurface(
            &mut self,
            iosurface: *mut c_void,
            timestamp_us: i64,
            duration_us: i64,
            force_key: bool,
        ) -> Result<()> {
            self.take_error()?;
            if iosurface.is_null() {
                return Err(CodecError::new("null IOSurfaceRef"));
            }
            let mut pb: CVPixelBufferRef = ptr::null_mut();
            check(
                "CVPixelBufferCreateWithIOSurface",
                CVPixelBufferCreateWithIOSurface(ptr::null(), iosurface, ptr::null(), &mut pb),
            )?;
            let pb_owned = CfOwned(pb as CFTypeRef);
            let r = self.encode_pixel_buffer(pb, timestamp_us, duration_us, force_key);
            drop(pb_owned);
            r
        }

        /// Number of submitted frames that have not finished encoding.
        pub fn in_flight(&self) -> usize {
            self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).in_flight.len()
        }

        /// Block until at most `max` frames are in flight.
        ///
        /// If the encoder stops making progress, it is told to finish the
        /// needed frames. Encoding continues normally afterwards.
        pub fn wait_in_flight(&mut self, max: usize) -> Result<()> {
            /// How long to wait for a callback before forcing completion.
            const STALL: Duration = Duration::from_millis(50);
            let until = {
                let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
                loop {
                    let n = s.in_flight.len();
                    if n <= max || s.error.is_some() {
                        break None;
                    }
                    let target = s.in_flight[n - max - 1];
                    let (g, res) = self.shared.done.wait_timeout(s, STALL).unwrap_or_else(|p| p.into_inner());
                    s = g;
                    if res.timed_out() && s.in_flight.len() == n {
                        break Some(target);
                    }
                }
            };
            if let Some(t) = until {
                unsafe {
                    check("VTCompressionSessionCompleteFrames", VTCompressionSessionCompleteFrames(self.session, t))?;
                }
            }
            self.take_error()
        }

        /// Block until every submitted frame has been emitted.
        pub fn flush(&mut self) -> Result<()> {
            unsafe {
                check(
                    "VTCompressionSessionCompleteFrames",
                    VTCompressionSessionCompleteFrames(self.session, CMTime::INVALID),
                )?;
            }
            self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).in_flight.clear();
            self.take_error()
        }

        /// Take the encoded packets so far.
        pub fn take_packets(&mut self) -> Vec<EncodedVideoPacket> {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            std::mem::take(&mut s.packets)
        }

        /// The avcC or hvcC record, available after the first packet.
        pub fn description(&self) -> Option<Vec<u8>> {
            let s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            s.description.clone()
        }

        /// Whether VideoToolbox reports a hardware encoder for this session.
        pub fn is_hardware_accelerated(&self) -> bool {
            self.hardware
        }

        /// The configuration this encoder was created with.
        pub fn config(&self) -> &VideoEncoderConfig {
            &self.config
        }
    }

    impl Drop for VideoEncoder {
        fn drop(&mut self) {
            unsafe {
                VTCompressionSessionCompleteFrames(self.session, CMTime::INVALID);
                VTCompressionSessionInvalidate(self.session);
                CFRelease(self.session as CFTypeRef);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::VideoEncoder;

#[cfg(not(target_os = "macos"))]
mod stub {
    use super::*;
    use crate::error::unsupported;

    /// Unsupported-platform stub.
    pub struct VideoEncoder {
        _private: (),
    }

    impl VideoEncoder {
        pub fn new(_config: VideoEncoderConfig) -> Result<Self> {
            unsupported()
        }
        pub fn encode_bgra(&mut self, _: &[u8], _: usize, _: i64, _: i64, _: bool) -> Result<()> {
            unsupported()
        }
        /// # Safety
        /// Never callable, since no instance can exist.
        pub unsafe fn encode_iosurface(&mut self, _: *mut std::ffi::c_void, _: i64, _: i64, _: bool) -> Result<()> {
            unsupported()
        }
        pub fn flush(&mut self) -> Result<()> {
            unsupported()
        }
        pub fn in_flight(&self) -> usize {
            0
        }
        pub fn wait_in_flight(&mut self, _max: usize) -> Result<()> {
            unsupported()
        }
        pub fn take_packets(&mut self) -> Vec<EncodedVideoPacket> {
            Vec::new()
        }
        pub fn description(&self) -> Option<Vec<u8>> {
            None
        }
        pub fn is_hardware_accelerated(&self) -> bool {
            false
        }
    }
}
