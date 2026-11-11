//! AAC and MP3 decoder using AudioToolbox's `AudioConverter`.
//!
//! Output is interleaved Float32 PCM. Timestamps count up from the first
//! packet after creation or flush. Encoder priming is not trimmed.

use crate::{AudioCodec, Result};

/// A chunk of decoded audio.
#[derive(Clone, Debug)]
pub struct DecodedAudio {
    /// Interleaved Float32 samples (`frames * channels` values).
    pub samples: Vec<f32>,
    pub frames: usize,
    pub channels: u32,
    pub sample_rate: u32,
    pub timestamp_us: i64,
}

#[cfg(target_os = "macos")]
pub use imp::AudioDecoder;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::aac::esds_cookie;
    use crate::error::check;
    use crate::ffi::*;
    use crate::CodecError;
    use std::ffi::c_void;
    use std::ptr;

    const NO_DATA: OSStatus = fourcc(b"nodt") as OSStatus;
    /// Output chunk capacity in frames per FillComplexBuffer call.
    const OUT_FRAMES: usize = 4096;

    struct Input {
        packet: Vec<u8>,
        desc: AudioStreamPacketDescription,
        has_packet: bool,
        eos: bool,
    }

    unsafe extern "C" fn input_proc(
        _conv: AudioConverterRef,
        io_packets: *mut u32,
        io_data: *mut AudioBufferList,
        out_desc: *mut *mut AudioStreamPacketDescription,
        user: *mut c_void,
    ) -> OSStatus {
        let st = &mut *(user as *mut Input);
        let abl = &mut *io_data;
        if !st.has_packet {
            *io_packets = 0;
            abl.buffers[0].data = ptr::null_mut();
            abl.buffers[0].data_byte_size = 0;
            return if st.eos { 0 } else { NO_DATA };
        }
        st.has_packet = false;
        st.desc = AudioStreamPacketDescription {
            start_offset: 0,
            variable_frames_in_packet: 0,
            data_byte_size: st.packet.len() as u32,
        };
        abl.buffers[0].data = st.packet.as_mut_ptr() as *mut c_void;
        abl.buffers[0].data_byte_size = st.packet.len() as u32;
        if !out_desc.is_null() {
            *out_desc = &mut st.desc;
        }
        *io_packets = 1;
        0
    }

    /// AAC / MP3 decoder producing interleaved Float32.
    pub struct AudioDecoder {
        conv: AudioConverterRef,
        input: Box<Input>,
        channels: u32,
        sample_rate: u32,
        base_ts: Option<i64>,
        frames_out: u64,
        out: Vec<DecodedAudio>,
    }

    unsafe impl Send for AudioDecoder {}

    impl AudioDecoder {
        /// Create a decoder. For AAC, `description` is the AudioSpecificConfig
        /// or an esds descriptor; if missing, one is built from the rate and
        /// channels. MP3 needs no description.
        pub fn new(codec: AudioCodec, sample_rate: u32, channels: u32, description: Option<&[u8]>) -> Result<Self> {
            if sample_rate == 0 || channels == 0 {
                return Err(CodecError::new("sample_rate and channels must be non-zero"));
            }
            let (format_id, frames_per_packet) = match codec {
                AudioCodec::Aac => (kAudioFormatMPEG4AAC, 1024),
                AudioCodec::Mp3 => (kAudioFormatMPEGLayer3, if sample_rate >= 32000 { 1152 } else { 576 }),
            };
            let src = AudioStreamBasicDescription {
                sample_rate: sample_rate as f64,
                format_id,
                frames_per_packet,
                channels_per_frame: channels,
                ..Default::default()
            };
            let dst = AudioStreamBasicDescription {
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
            unsafe {
                let mut conv: AudioConverterRef = ptr::null_mut();
                check("AudioConverterNew (decode)", AudioConverterNew(&src, &dst, &mut conv))?;
                let dec = AudioDecoder {
                    conv,
                    input: Box::new(Input {
                        packet: Vec::new(),
                        desc: AudioStreamPacketDescription::default(),
                        has_packet: false,
                        eos: false,
                    }),
                    channels,
                    sample_rate,
                    base_ts: None,
                    frames_out: 0,
                    out: Vec::new(),
                };
                if codec == AudioCodec::Aac {
                    let cookie = match description {
                        Some(d) if d.first() == Some(&0x03) => d.to_vec(), // already an ES_Descriptor
                        Some(d) if !d.is_empty() => esds_cookie(d),
                        _ => esds_cookie(&crate::aac::build_asc(sample_rate, channels)),
                    };
                    check(
                        "set kAudioConverterDecompressionMagicCookie",
                        AudioConverterSetProperty(
                            conv,
                            kAudioConverterDecompressionMagicCookie,
                            cookie.len() as u32,
                            cookie.as_ptr() as *const c_void,
                        ),
                    )?;
                }
                Ok(dec)
            }
        }

        /// Run the converter until it has no more input.
        fn pump(&mut self) -> Result<()> {
            let ch = self.channels as usize;
            loop {
                let mut buf = vec![0f32; OUT_FRAMES * ch];
                let mut abl = AudioBufferList {
                    number_buffers: 1,
                    buffers: [AudioBuffer {
                        number_channels: self.channels,
                        data_byte_size: (buf.len() * 4) as u32,
                        data: buf.as_mut_ptr() as *mut c_void,
                    }],
                };
                let mut n_frames = OUT_FRAMES as u32;
                let st = unsafe {
                    AudioConverterFillComplexBuffer(
                        self.conv,
                        Some(input_proc),
                        &mut *self.input as *mut Input as *mut c_void,
                        &mut n_frames,
                        &mut abl,
                        ptr::null_mut(),
                    )
                };
                if st != 0 && st != NO_DATA {
                    return Err(CodecError::os("AudioConverterFillComplexBuffer (decode)", st));
                }
                if n_frames > 0 {
                    buf.truncate(n_frames as usize * ch);
                    let base = self.base_ts.unwrap_or(0);
                    let ts = base + ((self.frames_out as i128 * 1_000_000) / self.sample_rate as i128) as i64;
                    self.frames_out += n_frames as u64;
                    self.out.push(DecodedAudio {
                        samples: buf,
                        frames: n_frames as usize,
                        channels: self.channels,
                        sample_rate: self.sample_rate,
                        timestamp_us: ts,
                    });
                }
                if st == NO_DATA || n_frames == 0 {
                    return Ok(());
                }
            }
        }

        /// Decode one compressed packet (raw AAC access unit or one MP3 frame).
        pub fn decode(&mut self, packet: &[u8], timestamp_us: i64) -> Result<()> {
            if self.input.eos {
                unsafe { AudioConverterReset(self.conv) };
                self.input.eos = false;
            }
            if self.base_ts.is_none() {
                self.base_ts = Some(timestamp_us);
                self.frames_out = 0;
            }
            if packet.is_empty() {
                return Ok(());
            }
            self.input.packet.clear();
            self.input.packet.extend_from_slice(packet);
            self.input.has_packet = true;
            self.pump()
        }

        /// Output any delayed audio and reset. Use after seeking.
        pub fn flush(&mut self) -> Result<()> {
            if self.base_ts.is_some() && !self.input.eos {
                self.input.eos = true;
                self.input.has_packet = false;
                self.pump()?;
            }
            self.base_ts = None;
            Ok(())
        }

        /// Take the decoded audio so far.
        pub fn take_audio(&mut self) -> Vec<DecodedAudio> {
            std::mem::take(&mut self.out)
        }
    }

    impl Drop for AudioDecoder {
        fn drop(&mut self) {
            unsafe {
                AudioConverterDispose(self.conv);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::AudioDecoder;

#[cfg(not(target_os = "macos"))]
mod stub {
    use super::*;
    use crate::error::unsupported;

    /// Unsupported-platform stub.
    pub struct AudioDecoder {
        _private: (),
    }

    impl AudioDecoder {
        pub fn new(_: AudioCodec, _: u32, _: u32, _: Option<&[u8]>) -> Result<Self> {
            unsupported()
        }
        pub fn decode(&mut self, _: &[u8], _: i64) -> Result<()> {
            unsupported()
        }
        pub fn flush(&mut self) -> Result<()> {
            unsupported()
        }
        pub fn take_audio(&mut self) -> Vec<DecodedAudio> {
            Vec::new()
        }
    }
}
