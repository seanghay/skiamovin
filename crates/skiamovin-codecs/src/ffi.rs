//! FFI declarations for the parts of Apple's media frameworks this crate uses.

#![allow(non_upper_case_globals, non_camel_case_types, non_snake_case, dead_code)]

use std::ffi::{c_char, c_void};

pub type OSStatus = i32;
pub type Boolean = u8;
pub type CFIndex = isize;
pub type CFTypeRef = *const c_void;
pub type CFAllocatorRef = *const c_void;
pub type CFStringRef = *const c_void;
pub type CFDictionaryRef = *const c_void;
pub type CFMutableDictionaryRef = *mut c_void;
pub type CFArrayRef = *const c_void;
pub type CFDataRef = *const c_void;
pub type CFNumberRef = *const c_void;
pub type CFBooleanRef = *const c_void;
pub type CFTypeID = usize;

/// The real struct has 6 pointer-sized fields. Only its address is used.
#[repr(C)]
pub struct CFDictionaryKeyCallBacks([usize; 6]);
/// The real struct has 5 pointer-sized fields. Only its address is used.
#[repr(C)]
pub struct CFDictionaryValueCallBacks([usize; 5]);

pub const kCFNumberSInt32Type: CFIndex = 3;
pub const kCFNumberSInt64Type: CFIndex = 4;
pub const kCFNumberFloat64Type: CFIndex = 6;
pub const kCFStringEncodingUTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    pub static kCFTypeDictionaryKeyCallBacks: CFDictionaryKeyCallBacks;
    pub static kCFTypeDictionaryValueCallBacks: CFDictionaryValueCallBacks;
    pub static kCFBooleanTrue: CFBooleanRef;
    pub static kCFBooleanFalse: CFBooleanRef;

    pub fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    pub fn CFRelease(cf: CFTypeRef);
    pub fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
    pub fn CFBooleanGetTypeID() -> CFTypeID;
    pub fn CFDataGetTypeID() -> CFTypeID;
    pub fn CFDictionaryGetTypeID() -> CFTypeID;
    pub fn CFBooleanGetValue(b: CFBooleanRef) -> Boolean;

    pub fn CFDictionaryCreateMutable(
        allocator: CFAllocatorRef,
        capacity: CFIndex,
        key_callbacks: *const CFDictionaryKeyCallBacks,
        value_callbacks: *const CFDictionaryValueCallBacks,
    ) -> CFMutableDictionaryRef;
    pub fn CFDictionarySetValue(dict: CFMutableDictionaryRef, key: *const c_void, value: *const c_void);
    pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;

    pub fn CFNumberCreate(allocator: CFAllocatorRef, the_type: CFIndex, value_ptr: *const c_void) -> CFNumberRef;
    pub fn CFStringCreateWithCString(alloc: CFAllocatorRef, c_str: *const c_char, encoding: u32) -> CFStringRef;

    pub fn CFDataCreate(allocator: CFAllocatorRef, bytes: *const u8, length: CFIndex) -> CFDataRef;
    pub fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
    pub fn CFDataGetLength(data: CFDataRef) -> CFIndex;

    pub fn CFShow(obj: CFTypeRef);
    pub fn CFArrayGetCount(arr: CFArrayRef) -> CFIndex;
    pub fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: CFIndex) -> *const c_void;
}

// ---------------------------------------------------------------------------
// CoreMedia
// ---------------------------------------------------------------------------

pub type CMSampleBufferRef = *mut c_void;
pub type CMBlockBufferRef = *mut c_void;
pub type CMFormatDescriptionRef = *mut c_void;
pub type CMVideoFormatDescriptionRef = *mut c_void;
pub type CMVideoCodecType = u32;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CMTime {
    pub value: i64,
    pub timescale: i32,
    pub flags: u32,
    pub epoch: i64,
}

pub const kCMTimeFlags_Valid: u32 = 1;

impl CMTime {
    pub const INVALID: CMTime = CMTime { value: 0, timescale: 0, flags: 0, epoch: 0 };

    /// A CMTime in microseconds.
    pub fn from_us(us: i64) -> CMTime {
        CMTime { value: us, timescale: 1_000_000, flags: kCMTimeFlags_Valid, epoch: 0 }
    }

    pub fn is_valid(self) -> bool {
        self.flags & kCMTimeFlags_Valid != 0 && self.timescale > 0
    }

    /// Convert to microseconds (0 if invalid).
    pub fn to_us(self) -> i64 {
        if !self.is_valid() {
            return 0;
        }
        ((self.value as i128 * 1_000_000) / self.timescale as i128) as i64
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct CMSampleTimingInfo {
    pub duration: CMTime,
    pub presentation_time_stamp: CMTime,
    pub decode_time_stamp: CMTime,
}

pub const kCMBlockBufferAssureMemoryNowFlag: u32 = 1;

pub const kCMVideoCodecType_H264: CMVideoCodecType = u32::from_be_bytes(*b"avc1");
pub const kCMVideoCodecType_HEVC: CMVideoCodecType = u32::from_be_bytes(*b"hvc1");
pub const kCMVideoCodecType_HEVCWithAlpha: CMVideoCodecType = u32::from_be_bytes(*b"muxa");

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    pub static kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms: CFStringRef;
    pub static kCMSampleAttachmentKey_NotSync: CFStringRef;

    pub fn CMSampleBufferGetDataBuffer(sbuf: CMSampleBufferRef) -> CMBlockBufferRef;
    pub fn CMSampleBufferGetFormatDescription(sbuf: CMSampleBufferRef) -> CMFormatDescriptionRef;
    pub fn CMSampleBufferGetPresentationTimeStamp(sbuf: CMSampleBufferRef) -> CMTime;
    pub fn CMSampleBufferGetDuration(sbuf: CMSampleBufferRef) -> CMTime;
    pub fn CMSampleBufferGetSampleAttachmentsArray(sbuf: CMSampleBufferRef, create_if_necessary: Boolean)
        -> CFArrayRef;
    pub fn CMSampleBufferCreateReady(
        allocator: CFAllocatorRef,
        data_buffer: CMBlockBufferRef,
        format_description: CMFormatDescriptionRef,
        num_samples: CFIndex,
        num_sample_timing_entries: CFIndex,
        sample_timing_array: *const CMSampleTimingInfo,
        num_sample_size_entries: CFIndex,
        sample_size_array: *const usize,
        sample_buffer_out: *mut CMSampleBufferRef,
    ) -> OSStatus;

    pub fn CMBlockBufferGetDataLength(buf: CMBlockBufferRef) -> usize;
    pub fn CMBlockBufferCopyDataBytes(buf: CMBlockBufferRef, offset: usize, len: usize, dest: *mut c_void) -> OSStatus;
    pub fn CMBlockBufferCreateWithMemoryBlock(
        structure_allocator: CFAllocatorRef,
        memory_block: *mut c_void,
        block_length: usize,
        block_allocator: CFAllocatorRef,
        custom_block_source: *const c_void,
        offset_to_data: usize,
        data_length: usize,
        flags: u32,
        block_buffer_out: *mut CMBlockBufferRef,
    ) -> OSStatus;
    pub fn CMBlockBufferReplaceDataBytes(
        source_bytes: *const c_void,
        destination_buffer: CMBlockBufferRef,
        offset_into_destination: usize,
        data_length: usize,
    ) -> OSStatus;

    pub fn CMFormatDescriptionGetExtension(desc: CMFormatDescriptionRef, key: CFStringRef) -> CFTypeRef;
    pub fn CMVideoFormatDescriptionCreate(
        allocator: CFAllocatorRef,
        codec_type: CMVideoCodecType,
        width: i32,
        height: i32,
        extensions: CFDictionaryRef,
        format_description_out: *mut CMVideoFormatDescriptionRef,
    ) -> OSStatus;
    pub fn CMFormatDescriptionGetExtensions(desc: CMFormatDescriptionRef) -> CFDictionaryRef;
    pub fn CMVideoFormatDescriptionCreateFromH264ParameterSets(
        allocator: CFAllocatorRef,
        parameter_set_count: usize,
        parameter_set_pointers: *const *const u8,
        parameter_set_sizes: *const usize,
        nal_unit_header_length: i32,
        format_description_out: *mut CMFormatDescriptionRef,
    ) -> OSStatus;
    pub fn CMVideoFormatDescriptionCreateFromHEVCParameterSets(
        allocator: CFAllocatorRef,
        parameter_set_count: usize,
        parameter_set_pointers: *const *const u8,
        parameter_set_sizes: *const usize,
        nal_unit_header_length: i32,
        extensions: CFDictionaryRef,
        format_description_out: *mut CMFormatDescriptionRef,
    ) -> OSStatus;
    pub fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        desc: CMFormatDescriptionRef,
        index: usize,
        param_ptr: *mut *const u8,
        param_size: *mut usize,
        param_count: *mut usize,
        nal_header_length: *mut i32,
    ) -> OSStatus;
}

// ---------------------------------------------------------------------------
// CoreVideo
// ---------------------------------------------------------------------------

pub type CVReturn = i32;
pub type CVPixelBufferRef = *mut c_void;
pub type CVImageBufferRef = *mut c_void;
pub type CVPixelBufferPoolRef = *mut c_void;

pub const kCVPixelFormatType_32BGRA: u32 = u32::from_be_bytes(*b"BGRA");
pub const kCVPixelBufferLock_ReadOnly: u64 = 1;

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    pub static kCVPixelBufferPixelFormatTypeKey: CFStringRef;
    pub static kCVPixelBufferWidthKey: CFStringRef;
    pub static kCVPixelBufferHeightKey: CFStringRef;
    pub static kCVPixelBufferIOSurfacePropertiesKey: CFStringRef;
    pub static kCVPixelBufferMetalCompatibilityKey: CFStringRef;
    pub static kCVImageBufferColorPrimaries_ITU_R_709_2: CFStringRef;
    pub static kCVImageBufferTransferFunction_ITU_R_709_2: CFStringRef;
    pub static kCVImageBufferYCbCrMatrix_ITU_R_709_2: CFStringRef;

    pub fn CVPixelBufferPoolCreatePixelBuffer(
        allocator: CFAllocatorRef,
        pool: CVPixelBufferPoolRef,
        out: *mut CVPixelBufferRef,
    ) -> CVReturn;
    pub fn CVPixelBufferCreate(
        allocator: CFAllocatorRef,
        width: usize,
        height: usize,
        pixel_format: u32,
        attrs: CFDictionaryRef,
        out: *mut CVPixelBufferRef,
    ) -> CVReturn;
    pub fn CVPixelBufferCreateWithIOSurface(
        allocator: CFAllocatorRef,
        surface: *const c_void,
        attrs: CFDictionaryRef,
        out: *mut CVPixelBufferRef,
    ) -> CVReturn;
    pub fn CVPixelBufferLockBaseAddress(pb: CVPixelBufferRef, flags: u64) -> CVReturn;
    pub fn CVPixelBufferUnlockBaseAddress(pb: CVPixelBufferRef, flags: u64) -> CVReturn;
    pub fn CVPixelBufferGetBaseAddress(pb: CVPixelBufferRef) -> *mut c_void;
    pub fn CVPixelBufferGetBytesPerRow(pb: CVPixelBufferRef) -> usize;
    pub fn CVPixelBufferGetWidth(pb: CVPixelBufferRef) -> usize;
    pub fn CVPixelBufferGetHeight(pb: CVPixelBufferRef) -> usize;
    pub fn CVPixelBufferGetPixelFormatType(pb: CVPixelBufferRef) -> u32;
    /// The returned IOSurfaceRef is not retained.
    pub fn CVPixelBufferGetIOSurface(pb: CVPixelBufferRef) -> IOSurfaceRef;
}

// ---------------------------------------------------------------------------
// IOSurface
// ---------------------------------------------------------------------------

pub type IOSurfaceRef = *mut c_void;
pub const kIOSurfaceLockReadOnly: u32 = 1;

#[link(name = "IOSurface", kind = "framework")]
extern "C" {
    pub static kIOSurfaceWidth: CFStringRef;
    pub static kIOSurfaceHeight: CFStringRef;
    pub static kIOSurfaceBytesPerElement: CFStringRef;
    pub static kIOSurfacePixelFormat: CFStringRef;

    pub fn IOSurfaceCreate(properties: CFDictionaryRef) -> IOSurfaceRef;
    pub fn IOSurfaceLock(surface: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceUnlock(surface: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceGetBaseAddress(surface: IOSurfaceRef) -> *mut c_void;
    pub fn IOSurfaceGetBytesPerRow(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetWidth(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetHeight(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetAllocSize(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceIsInUse(surface: IOSurfaceRef) -> Boolean;
}

// ---------------------------------------------------------------------------
// VideoToolbox
// ---------------------------------------------------------------------------

pub type VTSessionRef = *mut c_void;
pub type VTCompressionSessionRef = *mut c_void;
pub type VTDecompressionSessionRef = *mut c_void;

pub type VTCompressionOutputCallback = Option<
    unsafe extern "C" fn(
        output_callback_ref_con: *mut c_void,
        source_frame_ref_con: *mut c_void,
        status: OSStatus,
        info_flags: u32,
        sample_buffer: CMSampleBufferRef,
    ),
>;

pub type VTDecompressionOutputCallback = Option<
    unsafe extern "C" fn(
        decompression_output_ref_con: *mut c_void,
        source_frame_ref_con: *mut c_void,
        status: OSStatus,
        info_flags: u32,
        image_buffer: CVImageBufferRef,
        presentation_time_stamp: CMTime,
        presentation_duration: CMTime,
    ),
>;

#[repr(C)]
pub struct VTDecompressionOutputCallbackRecord {
    pub decompression_output_callback: VTDecompressionOutputCallback,
    pub decompression_output_ref_con: *mut c_void,
}

pub const kVTDecodeInfo_FrameDropped: u32 = 1 << 1;
pub const kVTDecodeInfo_Asynchronous: u32 = 1 << 0;
pub const kVTDecodeFrame_EnableAsynchronousDecompression: u32 = 1 << 0;
pub const kVTDecodeFrame_1xRealTimePlayback: u32 = 1 << 2;
pub const kVTEncodeInfo_FrameDropped: u32 = 1 << 1;

#[link(name = "VideoToolbox", kind = "framework")]
extern "C" {
    pub static kVTCompressionPropertyKey_RealTime: CFStringRef;
    pub static kVTCompressionPropertyKey_AllowFrameReordering: CFStringRef;
    pub static kVTCompressionPropertyKey_AverageBitRate: CFStringRef;
    pub static kVTCompressionPropertyKey_ExpectedFrameRate: CFStringRef;
    pub static kVTCompressionPropertyKey_MaxKeyFrameInterval: CFStringRef;
    pub static kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: CFStringRef;
    pub static kVTCompressionPropertyKey_ProfileLevel: CFStringRef;
    pub static kVTCompressionPropertyKey_Quality: CFStringRef;
    pub static kVTCompressionPropertyKey_TargetQualityForAlpha: CFStringRef;
    pub static kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder: CFStringRef;
    pub static kVTCompressionPropertyKey_ColorPrimaries: CFStringRef;
    pub static kVTCompressionPropertyKey_TransferFunction: CFStringRef;
    pub static kVTCompressionPropertyKey_YCbCrMatrix: CFStringRef;
    pub static kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality: CFStringRef;
    pub static kVTCompressionPropertyKey_MaximizePowerEfficiency: CFStringRef;
    pub static kVTEncodeFrameOptionKey_ForceKeyFrame: CFStringRef;
    pub static kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: CFStringRef;
    pub static kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: CFStringRef;
    pub static kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder: CFStringRef;
    pub static kVTDecompressionPropertyKey_PixelTransferProperties: CFStringRef;
    pub static kVTPixelTransferPropertyKey_DestinationColorPrimaries: CFStringRef;
    pub static kVTPixelTransferPropertyKey_DestinationTransferFunction: CFStringRef;
    pub static kVTPixelTransferPropertyKey_DestinationYCbCrMatrix: CFStringRef;
    pub static kVTProfileLevel_H264_High_AutoLevel: CFStringRef;
    pub static kVTProfileLevel_HEVC_Main_AutoLevel: CFStringRef;

    pub fn VTSessionSetProperty(session: VTSessionRef, key: CFStringRef, value: CFTypeRef) -> OSStatus;
    pub fn VTSessionCopyProperty(
        session: VTSessionRef,
        key: CFStringRef,
        allocator: CFAllocatorRef,
        value_out: *mut CFTypeRef,
    ) -> OSStatus;

    pub fn VTCompressionSessionCreate(
        allocator: CFAllocatorRef,
        width: i32,
        height: i32,
        codec_type: CMVideoCodecType,
        encoder_specification: CFDictionaryRef,
        source_image_buffer_attributes: CFDictionaryRef,
        compressed_data_allocator: CFAllocatorRef,
        output_callback: VTCompressionOutputCallback,
        output_callback_ref_con: *mut c_void,
        compression_session_out: *mut VTCompressionSessionRef,
    ) -> OSStatus;
    pub fn VTCompressionSessionPrepareToEncodeFrames(session: VTCompressionSessionRef) -> OSStatus;
    pub fn VTCompressionSessionGetPixelBufferPool(session: VTCompressionSessionRef) -> CVPixelBufferPoolRef;
    pub fn VTCompressionSessionEncodeFrame(
        session: VTCompressionSessionRef,
        image_buffer: CVImageBufferRef,
        presentation_time_stamp: CMTime,
        duration: CMTime,
        frame_properties: CFDictionaryRef,
        source_frame_ref_con: *mut c_void,
        info_flags_out: *mut u32,
    ) -> OSStatus;
    pub fn VTCompressionSessionCompleteFrames(session: VTCompressionSessionRef, complete_until: CMTime) -> OSStatus;
    pub fn VTCompressionSessionInvalidate(session: VTCompressionSessionRef);

    pub fn VTDecompressionSessionCreate(
        allocator: CFAllocatorRef,
        video_format_description: CMVideoFormatDescriptionRef,
        video_decoder_specification: CFDictionaryRef,
        destination_image_buffer_attributes: CFDictionaryRef,
        output_callback: *const VTDecompressionOutputCallbackRecord,
        decompression_session_out: *mut VTDecompressionSessionRef,
    ) -> OSStatus;
    pub fn VTDecompressionSessionDecodeFrame(
        session: VTDecompressionSessionRef,
        sample_buffer: CMSampleBufferRef,
        decode_flags: u32,
        source_frame_ref_con: *mut c_void,
        info_flags_out: *mut u32,
    ) -> OSStatus;
    pub fn VTDecompressionSessionFinishDelayedFrames(session: VTDecompressionSessionRef) -> OSStatus;
    pub fn VTDecompressionSessionWaitForAsynchronousFrames(session: VTDecompressionSessionRef) -> OSStatus;
    pub fn VTDecompressionSessionInvalidate(session: VTDecompressionSessionRef);

    pub fn VTIsHardwareDecodeSupported(codec_type: CMVideoCodecType) -> Boolean;
}

// ---------------------------------------------------------------------------
// AudioToolbox
// ---------------------------------------------------------------------------

pub type AudioConverterRef = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct AudioStreamBasicDescription {
    pub sample_rate: f64,
    pub format_id: u32,
    pub format_flags: u32,
    pub bytes_per_packet: u32,
    pub frames_per_packet: u32,
    pub bytes_per_frame: u32,
    pub channels_per_frame: u32,
    pub bits_per_channel: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AudioBuffer {
    pub number_channels: u32,
    pub data_byte_size: u32,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct AudioBufferList {
    pub number_buffers: u32,
    pub buffers: [AudioBuffer; 1],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct AudioStreamPacketDescription {
    pub start_offset: i64,
    pub variable_frames_in_packet: u32,
    pub data_byte_size: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct AudioConverterPrimeInfo {
    pub leading_frames: u32,
    pub trailing_frames: u32,
}

pub type AudioConverterComplexInputDataProc = Option<
    unsafe extern "C" fn(
        converter: AudioConverterRef,
        io_number_data_packets: *mut u32,
        io_data: *mut AudioBufferList,
        out_data_packet_description: *mut *mut AudioStreamPacketDescription,
        in_user_data: *mut c_void,
    ) -> OSStatus,
>;

pub const fn fourcc(s: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*s)
}

pub const kAudioFormatLinearPCM: u32 = fourcc(b"lpcm");
pub const kAudioFormatMPEG4AAC: u32 = fourcc(b"aac ");
pub const kAudioFormatMPEGLayer3: u32 = fourcc(b".mp3");
pub const kAudioFormatFlagIsFloat: u32 = 1 << 0;
pub const kAudioFormatFlagIsPacked: u32 = 1 << 3;

pub const kAudioConverterEncodeBitRate: u32 = fourcc(b"brat");
pub const kAudioConverterCompressionMagicCookie: u32 = fourcc(b"cmgc");
pub const kAudioConverterDecompressionMagicCookie: u32 = fourcc(b"dmgc");
pub const kAudioConverterPrimeInfo: u32 = fourcc(b"prim");
pub const kAudioConverterPropertyMaximumOutputPacketSize: u32 = fourcc(b"xops");

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    pub fn AudioConverterNew(
        in_source_format: *const AudioStreamBasicDescription,
        in_destination_format: *const AudioStreamBasicDescription,
        out_audio_converter: *mut AudioConverterRef,
    ) -> OSStatus;
    pub fn AudioConverterDispose(converter: AudioConverterRef) -> OSStatus;
    pub fn AudioConverterReset(converter: AudioConverterRef) -> OSStatus;
    pub fn AudioConverterSetProperty(
        converter: AudioConverterRef,
        property_id: u32,
        size: u32,
        data: *const c_void,
    ) -> OSStatus;
    pub fn AudioConverterGetPropertyInfo(
        converter: AudioConverterRef,
        property_id: u32,
        out_size: *mut u32,
        out_writable: *mut Boolean,
    ) -> OSStatus;
    pub fn AudioConverterGetProperty(
        converter: AudioConverterRef,
        property_id: u32,
        io_size: *mut u32,
        out_data: *mut c_void,
    ) -> OSStatus;
    pub fn AudioConverterFillComplexBuffer(
        converter: AudioConverterRef,
        input_proc: AudioConverterComplexInputDataProc,
        input_proc_user_data: *mut c_void,
        io_output_data_packet_size: *mut u32,
        out_output_data: *mut AudioBufferList,
        out_packet_description: *mut AudioStreamPacketDescription,
    ) -> OSStatus;
}
