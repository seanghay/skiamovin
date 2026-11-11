//! H.264 and HEVC decoder using `VTDecompressionSession`.
//!
//! VideoToolbox outputs frames in decode order. Frames are held in a small
//! buffer and returned in presentation order. The buffer grows when the
//! stream needs it; see [`VideoDecoder::set_reorder_depth`].
//!
//! With [`VideoDecoder::set_zero_copy`]`(true)`, frames are returned without
//! a copy as [`DecodedSurface`] values by [`VideoDecoder::take_surfaces`].

use crate::{Result, VideoCodec};

/// Default number of frames held back to restore presentation order.
pub const DEFAULT_REORDER_DEPTH: usize = 4;

/// One decoded frame as BGRA8 (top-left origin).
#[derive(Clone, Debug)]
pub struct DecodedVideoFrame {
    pub width: u32,
    pub height: u32,
    /// Bytes per row in `bgra` (always `width * 4`).
    pub stride: usize,
    pub bgra: Vec<u8>,
    pub timestamp_us: i64,
    pub duration_us: i64,
}

/// A decoded frame that holds the decoder's BGRA `CVPixelBuffer` instead of a copy.
///
/// Each one keeps a decoder buffer alive, so drop them promptly.
#[derive(Debug)]
pub struct DecodedSurface {
    pub width: u32,
    pub height: u32,
    pub timestamp_us: i64,
    pub duration_us: i64,
    /// Retained (+1) CVPixelBufferRef.
    pixel_buffer: *mut std::ffi::c_void,
}

// CVPixelBuffer/IOSurface are thread-safe, reference-counted CF objects.
unsafe impl Send for DecodedSurface {}

#[cfg(target_os = "macos")]
pub use imp::VideoDecoder;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::cf::*;
    use crate::error::check;
    use crate::ffi::*;
    use crate::CodecError;
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::ptr;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    enum Out {
        Frame(DecodedVideoFrame),
        Surface(DecodedSurface),
    }

    impl Out {
        fn timestamp_us(&self) -> i64 {
            match self {
                Out::Frame(f) => f.timestamp_us,
                Out::Surface(s) => s.timestamp_us,
            }
        }
    }

    /// State shared with the output callback, which may run on other threads
    /// in async mode.
    struct Inner {
        state: Mutex<Shared>,
        emitted: Condvar,
    }

    struct Shared {
        /// Ids of submitted frames whose output callback has not fired yet.
        outstanding: HashSet<usize>,
        pending: Vec<Out>,
        ready: Vec<DecodedVideoFrame>,
        ready_surfaces: Vec<DecodedSurface>,
        zero_copy: bool,
        reorder_depth: usize,
        error: Option<CodecError>,
    }

    impl Shared {
        fn push_ready(&mut self, o: Out) {
            match o {
                Out::Frame(f) => self.ready.push(f),
                Out::Surface(s) => self.ready_surfaces.push(s),
            }
        }
        fn release_excess(&mut self) {
            while self.pending.len() > self.reorder_depth {
                self.release_min();
            }
        }
        fn release_min(&mut self) {
            if let Some((idx, _)) = self.pending.iter().enumerate().min_by_key(|(_, f)| f.timestamp_us()) {
                let f = self.pending.remove(idx);
                self.push_ready(f);
            }
        }
        fn release_all(&mut self) {
            self.pending.sort_by_key(|f| f.timestamp_us());
            for o in std::mem::take(&mut self.pending) {
                self.push_ready(o);
            }
        }
    }

    /// Copy a BGRA CVPixelBuffer into a tightly packed frame.
    unsafe fn copy_bgra(image: CVPixelBufferRef, timestamp_us: i64, duration_us: i64) -> Result<DecodedVideoFrame> {
        if CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly) != 0 {
            return Err(CodecError::new("CVPixelBufferLockBaseAddress failed on decoded frame"));
        }
        let w = CVPixelBufferGetWidth(image);
        let h = CVPixelBufferGetHeight(image);
        let src_stride = CVPixelBufferGetBytesPerRow(image);
        let base = CVPixelBufferGetBaseAddress(image) as *const u8;
        let stride = w * 4;
        let mut bgra = vec![0u8; stride * h];
        if !base.is_null() {
            let n = stride.min(src_stride);
            for y in 0..h {
                ptr::copy_nonoverlapping(base.add(y * src_stride), bgra.as_mut_ptr().add(y * stride), n);
            }
        }
        CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
        Ok(DecodedVideoFrame { width: w as u32, height: h as u32, stride, bgra, timestamp_us, duration_us })
    }

    impl DecodedSurface {
        /// The `IOSurfaceRef` behind the frame, valid while this object lives.
        /// Null if the buffer has no IOSurface.
        pub fn iosurface(&self) -> *mut c_void {
            unsafe { CVPixelBufferGetIOSurface(self.pixel_buffer) }
        }

        /// The retained `CVPixelBufferRef` (valid as long as this object lives).
        pub fn pixel_buffer(&self) -> *mut c_void {
            self.pixel_buffer
        }

        /// Copy the pixels into a BGRA frame.
        pub fn to_bgra(&self) -> DecodedVideoFrame {
            unsafe {
                copy_bgra(self.pixel_buffer, self.timestamp_us, self.duration_us).unwrap_or_else(|_| {
                    DecodedVideoFrame {
                        width: self.width,
                        height: self.height,
                        stride: self.width as usize * 4,
                        bgra: vec![0; self.width as usize * 4 * self.height as usize],
                        timestamp_us: self.timestamp_us,
                        duration_us: self.duration_us,
                    }
                })
            }
        }
    }

    impl Drop for DecodedSurface {
        fn drop(&mut self) {
            if !self.pixel_buffer.is_null() {
                unsafe { CFRelease(self.pixel_buffer as CFTypeRef) }
            }
        }
    }

    /// Hardware-accelerated (when available) H.264/HEVC decoder.
    pub struct VideoDecoder {
        session: VTDecompressionSessionRef,
        format: CMVideoFormatDescriptionRef,
        shared: Arc<Inner>,
        async_mode: bool,
        next_id: usize,
        /// Recent input timestamps, used to estimate the reorder depth.
        submitted: Vec<i64>,
        hardware_hint: bool,
    }

    unsafe impl Send for VideoDecoder {}

    unsafe extern "C" fn output_callback(
        refcon: *mut c_void,
        frame_refcon: *mut c_void,
        status: OSStatus,
        info_flags: u32,
        image: CVImageBufferRef,
        pts: CMTime,
        duration: CMTime,
    ) {
        let inner = &*(refcon as *const Inner);
        // Copy pixels outside the lock so other callbacks are not blocked.
        let zero_copy = inner.state.lock().unwrap_or_else(|p| p.into_inner()).zero_copy;
        let out: Option<Result<Out>> = if status != 0 {
            Some(Err(CodecError::os("VideoToolbox decode (callback)", status)))
        } else if image.is_null() || info_flags & kVTDecodeInfo_FrameDropped != 0 {
            None
        } else {
            let (ts, dur) = (pts.to_us(), duration.to_us());
            Some(if zero_copy {
                CFRetain(image as CFTypeRef);
                Ok(Out::Surface(DecodedSurface {
                    width: CVPixelBufferGetWidth(image) as u32,
                    height: CVPixelBufferGetHeight(image) as u32,
                    timestamp_us: ts,
                    duration_us: dur,
                    pixel_buffer: image,
                }))
            } else {
                copy_bgra(image, ts, dur).map(Out::Frame)
            })
        };
        let mut s = inner.state.lock().unwrap_or_else(|p| p.into_inner());
        match out {
            Some(Ok(o)) => {
                s.pending.push(o);
                s.release_excess();
            }
            Some(Err(e)) => s.error = Some(e),
            None => {}
        }
        s.outstanding.remove(&(frame_refcon as usize));
        drop(s);
        inner.emitted.notify_all();
    }

    /// Build the format description from the parameter sets when possible, so
    /// CoreMedia records the color info the YUV to BGRA conversion needs.
    /// Falls back to the raw avcC/hvcC atom.
    unsafe fn create_format_description(
        codec: VideoCodec,
        codec_type: CMVideoCodecType,
        atom: &str,
        description: &[u8],
        coded_width: u32,
        coded_height: u32,
    ) -> Result<CMVideoFormatDescriptionRef> {
        let ps = match codec {
            VideoCodec::Avc => crate::nal::parse_avcc(description),
            VideoCodec::Hevc => crate::nal::parse_hvcc(description),
        };
        if let Some(ps) = ps.filter(|p| p.nal_units.len() >= 2) {
            let ptrs: Vec<*const u8> = ps.nal_units.iter().map(|n| n.as_ptr()).collect();
            let sizes: Vec<usize> = ps.nal_units.iter().map(|n| n.len()).collect();
            let mut format: CMFormatDescriptionRef = ptr::null_mut();
            let st = match codec {
                VideoCodec::Avc => CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    ptr::null(),
                    ptrs.len(),
                    ptrs.as_ptr(),
                    sizes.as_ptr(),
                    ps.nal_length_size as i32,
                    &mut format,
                ),
                VideoCodec::Hevc => CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                    ptr::null(),
                    ptrs.len(),
                    ptrs.as_ptr(),
                    sizes.as_ptr(),
                    ps.nal_length_size as i32,
                    ptr::null(),
                    &mut format,
                ),
            };
            if st == 0 && !format.is_null() {
                return Ok(format);
            }
        }
        let data = cf_data(description);
        let atom_key = cf_str(atom);
        let mut atoms = CfDict::new();
        atoms.set(atom_key.as_ptr(), data.as_ptr());
        let mut ext = CfDict::new();
        ext.set(kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms, atoms.as_ptr());
        let mut format: CMVideoFormatDescriptionRef = ptr::null_mut();
        check(
            "CMVideoFormatDescriptionCreate",
            CMVideoFormatDescriptionCreate(
                ptr::null(),
                codec_type,
                coded_width.max(1) as i32,
                coded_height.max(1) as i32,
                ext.as_ptr(),
                &mut format,
            ),
        )?;
        Ok(format)
    }

    impl VideoDecoder {
        /// Create a decoder from the avcC/hvcC record of an MP4 sample entry.
        /// The coded dimensions are only hints.
        pub fn new(codec: VideoCodec, description: &[u8], coded_width: u32, coded_height: u32) -> Result<Self> {
            if description.is_empty() {
                return Err(CodecError::new(
                    "a non-empty avcC/hvcC description is required (Annex-B input is not supported)",
                ));
            }
            let (codec_type, atom) = match codec {
                VideoCodec::Avc => (kCMVideoCodecType_H264, "avcC"),
                VideoCodec::Hevc => (kCMVideoCodecType_HEVC, "hvcC"),
            };
            unsafe {
                let format =
                    create_format_description(codec, codec_type, atom, description, coded_width, coded_height)?;
                let format_owned = CfOwned(format as CFTypeRef);

                let mut spec = CfDict::new();
                spec.set(kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder, cf_bool(true));
                let pixfmt = cf_i32(kCVPixelFormatType_32BGRA as i32);
                let iosurf = CfDict::new();
                let mut attrs = CfDict::new();
                attrs
                    .set(kCVPixelBufferPixelFormatTypeKey, pixfmt.as_ptr())
                    .set(kCVPixelBufferIOSurfacePropertiesKey, iosurf.as_ptr())
                    .set(kCVPixelBufferMetalCompatibilityKey, cf_bool(true));

                let shared = Arc::new(Inner {
                    emitted: Condvar::new(),
                    state: Mutex::new(Shared {
                        outstanding: HashSet::new(),
                        pending: Vec::new(),
                        ready: Vec::new(),
                        ready_surfaces: Vec::new(),
                        zero_copy: false,
                        reorder_depth: DEFAULT_REORDER_DEPTH,
                        error: None,
                    }),
                });
                let record = VTDecompressionOutputCallbackRecord {
                    decompression_output_callback: Some(output_callback),
                    decompression_output_ref_con: Arc::as_ptr(&shared) as *mut c_void,
                };
                let mut session: VTDecompressionSessionRef = ptr::null_mut();
                check(
                    "VTDecompressionSessionCreate",
                    VTDecompressionSessionCreate(
                        ptr::null(),
                        format,
                        spec.as_ptr(),
                        attrs.as_ptr(),
                        &record,
                        &mut session,
                    ),
                )?;
                if std::env::var_os("SKIAMOVIN_CODECS_DEBUG").is_some() {
                    CFShow(CMFormatDescriptionGetExtensions(format));
                }
                std::mem::forget(format_owned); // released in Drop
                Ok(VideoDecoder {
                    session,
                    format,
                    shared,
                    async_mode: false,
                    next_id: 1,
                    submitted: Vec::new(),
                    hardware_hint: VTIsHardwareDecodeSupported(codec_type) != 0,
                })
            }
        }

        fn take_error(&self) -> Result<()> {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            match s.error.take() {
                Some(e) => Err(e),
                None => Ok(()),
            }
        }

        /// Track submitted timestamps and grow the reorder depth if needed.
        fn observe_timestamp(&mut self, ts: i64) {
            const WINDOW: usize = 64;
            let later = self.submitted.iter().filter(|&&t| t > ts).count();
            self.submitted.push(ts);
            if self.submitted.len() > WINDOW {
                self.submitted.remove(0);
            }
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            if later > s.reorder_depth {
                s.reorder_depth = later;
            }
        }

        /// Decode one length-prefixed (AVCC/HVCC) access unit.
        pub fn decode(&mut self, data: &[u8], timestamp_us: i64, duration_us: i64, key: bool) -> Result<()> {
            self.take_error()?;
            if data.is_empty() {
                return Ok(());
            }
            let _ = key; // VideoToolbox detects sync samples from the bitstream itself.
            self.observe_timestamp(timestamp_us);
            unsafe {
                let len = data.len();
                let mut block: CMBlockBufferRef = ptr::null_mut();
                check(
                    "CMBlockBufferCreateWithMemoryBlock",
                    CMBlockBufferCreateWithMemoryBlock(
                        ptr::null(),
                        ptr::null_mut(),
                        len,
                        ptr::null(),
                        ptr::null(),
                        0,
                        len,
                        kCMBlockBufferAssureMemoryNowFlag,
                        &mut block,
                    ),
                )?;
                let block_owned = CfOwned(block as CFTypeRef);
                check(
                    "CMBlockBufferReplaceDataBytes",
                    CMBlockBufferReplaceDataBytes(data.as_ptr() as *const c_void, block, 0, len),
                )?;
                let timing = CMSampleTimingInfo {
                    duration: if duration_us > 0 { CMTime::from_us(duration_us) } else { CMTime::INVALID },
                    presentation_time_stamp: CMTime::from_us(timestamp_us),
                    decode_time_stamp: CMTime::INVALID,
                };
                let mut sample: CMSampleBufferRef = ptr::null_mut();
                check(
                    "CMSampleBufferCreateReady",
                    CMSampleBufferCreateReady(ptr::null(), block, self.format, 1, 1, &timing, 1, &len, &mut sample),
                )?;
                let sample_owned = CfOwned(sample as CFTypeRef);
                let mut info = 0u32;
                // In sync mode the callback usually fires before this returns.
                // Real-time playback is not requested so decoding runs at full speed.
                let flags = if self.async_mode { kVTDecodeFrame_EnableAsynchronousDecompression } else { 0 };
                let id = self.next_id;
                self.next_id = self.next_id.wrapping_add(1).max(1);
                self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).outstanding.insert(id);
                let st = VTDecompressionSessionDecodeFrame(self.session, sample, flags, id as *mut c_void, &mut info);
                // VideoToolbox retains the sample while decoding asynchronously.
                drop(sample_owned);
                drop(block_owned);
                if st != 0 {
                    // The frame was rejected, so nothing is pending for this id.
                    self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).outstanding.remove(&id);
                }
                check("VTDecompressionSessionDecodeFrame", st)?;
            }
            self.take_error()
        }

        /// Wait for all frames and release the whole reorder buffer.
        pub fn flush(&mut self) -> Result<()> {
            unsafe {
                check(
                    "VTDecompressionSessionFinishDelayedFrames",
                    VTDecompressionSessionFinishDelayedFrames(self.session),
                )?;
                check(
                    "VTDecompressionSessionWaitForAsynchronousFrames",
                    VTDecompressionSessionWaitForAsynchronousFrames(self.session),
                )?;
            }
            self.submitted.clear();
            {
                let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
                s.outstanding.clear();
                drop(s);
                self.shared.emitted.notify_all();
            }
            {
                let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
                s.release_all();
            }
            self.take_error()
        }

        /// Take the frames ready for output, in presentation order.
        ///
        /// Returns nothing when [`set_zero_copy`](Self::set_zero_copy) is on;
        /// use [`take_surfaces`](Self::take_surfaces) then.
        pub fn take_frames(&mut self) -> Vec<DecodedVideoFrame> {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            std::mem::take(&mut s.ready)
        }

        /// When `true`, decoded buffers are kept instead of copied and returned
        /// by [`take_surfaces`](Self::take_surfaces). Call before decoding.
        pub fn set_zero_copy(&mut self, enabled: bool) {
            self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).zero_copy = enabled;
        }

        /// Take the uncopied frames ready for output, in presentation order.
        pub fn take_surfaces(&mut self) -> Vec<DecodedSurface> {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            std::mem::take(&mut s.ready_surfaces)
        }

        /// Enable asynchronous decoding, where [`decode`](Self::decode) returns
        /// without waiting for the frame. Call before decoding.
        ///
        /// Use [`wait_pending`](Self::wait_pending) to limit the backlog and
        /// [`flush`](Self::flush) to wait for everything. Callback errors are
        /// returned by the next `decode`, `flush` or `wait_pending`.
        pub fn set_async(&mut self, enabled: bool) {
            self.async_mode = enabled;
        }

        /// Number of submitted frames that have not been output yet.
        pub fn pending(&self) -> usize {
            self.shared.state.lock().unwrap_or_else(|p| p.into_inner()).outstanding.len()
        }

        /// Block until at most `max` frames are [`pending`](Self::pending).
        /// If no frame arrives for a while, waits for all of them instead.
        pub fn wait_pending(&mut self, max: usize) -> Result<()> {
            const STALL: Duration = Duration::from_millis(50);
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            let mut fallback = false;
            while s.outstanding.len() > max && s.error.is_none() {
                let n = s.outstanding.len();
                let (g, res) = self.shared.emitted.wait_timeout(s, STALL).unwrap_or_else(|p| p.into_inner());
                s = g;
                if res.timed_out() && s.outstanding.len() == n {
                    fallback = true;
                    break;
                }
            }
            drop(s); // callbacks need the lock
            if fallback {
                unsafe {
                    check(
                        "VTDecompressionSessionWaitForAsynchronousFrames",
                        VTDecompressionSessionWaitForAsynchronousFrames(self.session),
                    )?;
                }
                // Frames still pending are held by the decoder until more
                // input or a flush, so stop counting them.
                let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
                if s.outstanding.len() > max {
                    s.outstanding.clear();
                }
            }
            self.take_error()
        }

        /// Set the reorder depth. Use 0 for streams without B-frames.
        /// It still grows automatically if needed.
        pub fn set_reorder_depth(&mut self, depth: usize) {
            let mut s = self.shared.state.lock().unwrap_or_else(|p| p.into_inner());
            s.reorder_depth = depth;
            s.release_excess();
        }

        /// Whether the system reports hardware decode support for this codec.
        pub fn is_hardware_accelerated(&self) -> bool {
            self.hardware_hint
        }
    }

    impl Drop for VideoDecoder {
        fn drop(&mut self) {
            unsafe {
                VTDecompressionSessionWaitForAsynchronousFrames(self.session);
                VTDecompressionSessionInvalidate(self.session);
                CFRelease(self.session as CFTypeRef);
                CFRelease(self.format as CFTypeRef);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::VideoDecoder;

#[cfg(not(target_os = "macos"))]
mod stub {
    use super::*;
    use crate::error::unsupported;

    impl DecodedSurface {
        pub fn iosurface(&self) -> *mut std::ffi::c_void {
            std::ptr::null_mut()
        }
        pub fn pixel_buffer(&self) -> *mut std::ffi::c_void {
            self.pixel_buffer
        }
        pub fn to_bgra(&self) -> DecodedVideoFrame {
            DecodedVideoFrame {
                width: self.width,
                height: self.height,
                stride: self.width as usize * 4,
                bgra: vec![0; self.width as usize * 4 * self.height as usize],
                timestamp_us: self.timestamp_us,
                duration_us: self.duration_us,
            }
        }
    }

    /// Unsupported-platform stub.
    pub struct VideoDecoder {
        _private: (),
    }

    impl VideoDecoder {
        pub fn new(_: VideoCodec, _: &[u8], _: u32, _: u32) -> Result<Self> {
            unsupported()
        }
        pub fn decode(&mut self, _: &[u8], _: i64, _: i64, _: bool) -> Result<()> {
            unsupported()
        }
        pub fn flush(&mut self) -> Result<()> {
            unsupported()
        }
        pub fn take_frames(&mut self) -> Vec<DecodedVideoFrame> {
            Vec::new()
        }
        pub fn set_zero_copy(&mut self, _: bool) {}
        pub fn set_async(&mut self, _: bool) {}
        pub fn pending(&self) -> usize {
            0
        }
        pub fn wait_pending(&mut self, _: usize) -> Result<()> {
            unsupported()
        }
        pub fn take_surfaces(&mut self) -> Vec<DecodedSurface> {
            Vec::new()
        }
        pub fn set_reorder_depth(&mut self, _: usize) {}
        pub fn is_hardware_accelerated(&self) -> bool {
            false
        }
    }
}
