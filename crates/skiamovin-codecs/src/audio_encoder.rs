//! AAC-LC encoder using AudioToolbox's `AudioConverter`.
//!
//! Input is interleaved Float32 PCM. Output is one raw AAC packet per 1024
//! input frames, timed from the first input timestamp. The encoder adds
//! [`AudioEncoder::priming_frames`] of silence at the start, which the muxer
//! should signal or the reader should trim.

use crate::Result;

/// One raw AAC access unit.
#[derive(Clone, Debug)]
pub struct EncodedAudioPacket {
    pub data: Vec<u8>,
    pub timestamp_us: i64,
    pub duration_us: i64,
}

#[cfg(target_os = "macos")]
pub use imp::AudioEncoder;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::aac::{asc_from_esds, build_asc};
    use crate::error::check;
    use crate::ffi::*;
    use crate::CodecError;
    use std::ffi::c_void;
    use std::ptr;

    /// Returned from the input callback when no more input is available yet.
    const NO_DATA: OSStatus = fourcc(b"nodt") as OSStatus;
    const AAC_FRAMES: usize = 1024;

    /// State shared with the converter's input callback (boxed for a stable address).
    struct Input {
        channels: usize,
        pending: Vec<f32>,
        /// Buffer currently lent to the converter; must stay alive until the next callback.
        lent: Vec<f32>,
        eos: bool,
    }

    unsafe extern "C" fn input_proc(
        _conv: AudioConverterRef,
        io_packets: *mut u32,
        io_data: *mut AudioBufferList,
        _out_desc: *mut *mut AudioStreamPacketDescription,
        user: *mut c_void,
    ) -> OSStatus {
        let st = &mut *(user as *mut Input);
        let avail = st.pending.len() / st.channels;
        let abl = &mut *io_data;
        if avail == 0 {
            *io_packets = 0;
            abl.buffers[0].data = ptr::null_mut();
            abl.buffers[0].data_byte_size = 0;
            return if st.eos { 0 } else { NO_DATA };
        }
        let frames = (*io_packets as usize).min(avail);
        let n = frames * st.channels;
        st.lent.clear();
        st.lent.extend(st.pending.drain(..n));
        abl.buffers[0].number_channels = st.channels as u32;
        abl.buffers[0].data = st.lent.as_mut_ptr() as *mut c_void;
        abl.buffers[0].data_byte_size = (n * 4) as u32;
        *io_packets = frames as u32;
        0
    }

    /// AAC-LC encoder.
    pub struct AudioEncoder {
        conv: AudioConverterRef,
        input: Box<Input>,
        sample_rate: u32,
        base_ts: Option<i64>,
        packet_index: u64,
        packets: Vec<EncodedAudioPacket>,
        asc: Vec<u8>,
        priming: u32,
        max_packet_size: usize,
    }

    unsafe impl Send for AudioEncoder {}

    impl AudioEncoder {
        /// Create an AAC-LC encoder. `bitrate` is in bits per second.
        pub fn new(sample_rate: u32, channels: u32, bitrate: Option<u32>) -> Result<Self> {
            if sample_rate == 0 || channels == 0 || channels > 8 {
                return Err(CodecError::new(format!("invalid AAC config: {sample_rate} Hz, {channels} channels")));
            }
            let src = AudioStreamBasicDescription {
                sample_rate: sample_rate as f64,
                format_id: kAudioFormatLinearPCM,
                format_flags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                bytes_per_packet: 4 * channels,
                frames_per_packet: 1,
                bytes_per_frame: 4 * channels,
                channels_per_frame: channels,
                bits_per_channel: 32,
                reserved: 0,
            };
            let dst = AudioStreamBasicDescription {
                sample_rate: sample_rate as f64,
                format_id: kAudioFormatMPEG4AAC,
                format_flags: 0, // 0 selects AAC-LC
                frames_per_packet: AAC_FRAMES as u32,
                channels_per_frame: channels,
                ..Default::default()
            };
            unsafe {
                let mut conv: AudioConverterRef = ptr::null_mut();
                check("AudioConverterNew (PCM->AAC)", AudioConverterNew(&src, &dst, &mut conv))?;
                let mut enc = AudioEncoder {
                    conv,
                    input: Box::new(Input {
                        channels: channels as usize,
                        pending: Vec::new(),
                        lent: Vec::new(),
                        eos: false,
                    }),
                    sample_rate,
                    base_ts: None,
                    packet_index: 0,
                    packets: Vec::new(),
                    asc: Vec::new(),
                    priming: 0,
                    max_packet_size: 0,
                };
                if let Some(br) = bitrate {
                    check(
                        "set kAudioConverterEncodeBitRate",
                        AudioConverterSetProperty(
                            conv,
                            kAudioConverterEncodeBitRate,
                            4,
                            &br as *const u32 as *const c_void,
                        ),
                    )?;
                }
                let mut size = 4u32;
                let mut maxp = 0u32;
                AudioConverterGetProperty(
                    conv,
                    kAudioConverterPropertyMaximumOutputPacketSize,
                    &mut size,
                    &mut maxp as *mut u32 as *mut c_void,
                );
                enc.max_packet_size = if maxp > 0 { maxp as usize } else { 6144 * channels as usize };

                let mut prime = AudioConverterPrimeInfo::default();
                let mut size = std::mem::size_of::<AudioConverterPrimeInfo>() as u32;
                if AudioConverterGetProperty(
                    conv,
                    kAudioConverterPrimeInfo,
                    &mut size,
                    &mut prime as *mut _ as *mut c_void,
                ) == 0
                {
                    enc.priming = prime.leading_frames;
                }

                enc.asc = enc.read_cookie_asc().unwrap_or_else(|| build_asc(sample_rate, channels));
                Ok(enc)
            }
        }

        unsafe fn read_cookie_asc(&self) -> Option<Vec<u8>> {
            let mut size = 0u32;
            let mut writable = 0u8;
            if AudioConverterGetPropertyInfo(self.conv, kAudioConverterCompressionMagicCookie, &mut size, &mut writable)
                != 0
                || size == 0
            {
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            if AudioConverterGetProperty(
                self.conv,
                kAudioConverterCompressionMagicCookie,
                &mut size,
                buf.as_mut_ptr() as *mut c_void,
            ) != 0
            {
                return None;
            }
            buf.truncate(size as usize);
            asc_from_esds(&buf).filter(|a| a.len() >= 2)
        }

        fn ts_for_packet(&self, index: u64) -> i64 {
            let base = self.base_ts.unwrap_or(0);
            base + ((index as i128 * AAC_FRAMES as i128 * 1_000_000) / self.sample_rate as i128) as i64
        }

        /// Run the converter until it needs more input.
        fn pump(&mut self) -> Result<()> {
            let mut out = vec![0u8; self.max_packet_size];
            loop {
                if !self.input.eos && self.input.pending.len() / self.input.channels < AAC_FRAMES {
                    return Ok(());
                }
                let mut abl = AudioBufferList {
                    number_buffers: 1,
                    buffers: [AudioBuffer {
                        number_channels: self.input.channels as u32,
                        data_byte_size: out.len() as u32,
                        data: out.as_mut_ptr() as *mut c_void,
                    }],
                };
                let mut n_packets = 1u32;
                let mut desc = AudioStreamPacketDescription::default();
                let st = unsafe {
                    AudioConverterFillComplexBuffer(
                        self.conv,
                        Some(input_proc),
                        &mut *self.input as *mut Input as *mut c_void,
                        &mut n_packets,
                        &mut abl,
                        &mut desc,
                    )
                };
                if st != 0 && st != NO_DATA {
                    return Err(CodecError::os("AudioConverterFillComplexBuffer (AAC encode)", st));
                }
                if n_packets > 0 {
                    let size =
                        if desc.data_byte_size > 0 { desc.data_byte_size } else { abl.buffers[0].data_byte_size };
                    let start = desc.start_offset.max(0) as usize;
                    let data = out[start..start + size as usize].to_vec();
                    let ts = self.ts_for_packet(self.packet_index);
                    let next = self.ts_for_packet(self.packet_index + 1);
                    self.packet_index += 1;
                    self.packets.push(EncodedAudioPacket { data, timestamp_us: ts, duration_us: next - ts });
                }
                if n_packets == 0 || st == NO_DATA {
                    return Ok(());
                }
            }
        }

        /// Queue interleaved Float32 samples. Only the first call's
        /// `timestamp_us` is used, since audio is assumed to be continuous.
        pub fn encode_f32_interleaved(&mut self, samples: &[f32], timestamp_us: i64) -> Result<()> {
            if !samples.len().is_multiple_of(self.input.channels) {
                return Err(CodecError::new("sample count is not a multiple of the channel count"));
            }
            if self.input.eos {
                // Previous flush ended the stream; start a fresh one.
                unsafe { AudioConverterReset(self.conv) };
                self.input.eos = false;
                self.base_ts = None;
                self.packet_index = 0;
            }
            if self.base_ts.is_none() {
                self.base_ts = Some(timestamp_us);
            }
            self.input.pending.extend_from_slice(samples);
            self.pump()
        }

        /// Encode all remaining input. The next `encode_*` call starts a new stream.
        pub fn flush(&mut self) -> Result<()> {
            if self.base_ts.is_none() || self.input.eos {
                return Ok(());
            }
            self.input.eos = true;
            self.pump()
        }

        /// Take the encoded packets so far.
        pub fn take_packets(&mut self) -> Vec<EncodedAudioPacket> {
            std::mem::take(&mut self.packets)
        }

        /// AudioSpecificConfig (e.g. `[0x11, 0x90]` for 48 kHz stereo AAC-LC).
        pub fn description(&self) -> Vec<u8> {
            self.asc.clone()
        }

        /// Encoder delay in frames (typically 2112), or 0 if unknown.
        pub fn priming_frames(&self) -> u32 {
            self.priming
        }
    }

    impl Drop for AudioEncoder {
        fn drop(&mut self) {
            unsafe {
                AudioConverterDispose(self.conv);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::AudioEncoder;

#[cfg(not(target_os = "macos"))]
mod stub {
    use super::*;
    use crate::error::unsupported;

    /// Unsupported-platform stub.
    pub struct AudioEncoder {
        _private: (),
    }

    impl AudioEncoder {
        pub fn new(_: u32, _: u32, _: Option<u32>) -> Result<Self> {
            unsupported()
        }
        pub fn encode_f32_interleaved(&mut self, _: &[f32], _: i64) -> Result<()> {
            unsupported()
        }
        pub fn flush(&mut self) -> Result<()> {
            unsupported()
        }
        pub fn take_packets(&mut self) -> Vec<EncodedAudioPacket> {
            Vec::new()
        }
        pub fn description(&self) -> Vec<u8> {
            Vec::new()
        }
        pub fn priming_frames(&self) -> u32 {
            0
        }
    }
}
