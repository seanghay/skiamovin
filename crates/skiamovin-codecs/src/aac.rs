//! AAC configuration helpers: AudioSpecificConfig and esds (ES_Descriptor)
//! construction/parsing. Platform independent.

/// Index into the MPEG-4 sampling frequency table, if the rate is standard.
pub fn sample_rate_index(rate: u32) -> Option<u8> {
    const RATES: [u32; 13] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    RATES.iter().position(|&r| r == rate).map(|i| i as u8)
}

/// Build a 2-byte (or 5-byte for non-standard rates) AAC-LC AudioSpecificConfig.
pub fn build_asc(sample_rate: u32, channels: u32) -> Vec<u8> {
    let object_type: u32 = 2; // AAC-LC
    let ch = channels.min(7);
    match sample_rate_index(sample_rate) {
        Some(idx) => {
            let v: u16 = ((object_type << 11) | ((idx as u32) << 7) | (ch << 3)) as u16;
            v.to_be_bytes().to_vec()
        }
        None => {
            // objectType(5) | 0xF(4) | rate(24) | channels(4) | 3 bits zero = 40 bits
            let v: u64 = ((object_type as u64) << 35)
                | (0xF << 31)
                | ((sample_rate as u64 & 0xFF_FFFF) << 7)
                | ((ch as u64) << 3);
            v.to_be_bytes()[3..].to_vec()
        }
    }
}

/// Extract the DecoderSpecificInfo (AudioSpecificConfig) from an MPEG-4
/// ES_Descriptor (as returned in AudioToolbox's AAC magic cookie).
pub fn asc_from_esds(cookie: &[u8]) -> Option<Vec<u8>> {
    fn read_desc(b: &[u8], mut i: usize) -> Option<(u8, usize, usize)> {
        let tag = *b.get(i)?;
        i += 1;
        let mut len = 0usize;
        for _ in 0..4 {
            let c = *b.get(i)?;
            i += 1;
            len = (len << 7) | (c & 0x7f) as usize;
            if c & 0x80 == 0 {
                break;
            }
        }
        Some((tag, i, len))
    }
    let (tag, mut i, _) = read_desc(cookie, 0)?;
    if tag == 0x03 {
        i += 2; // ES_ID
        let flags = *cookie.get(i)?;
        i += 1;
        if flags & 0x80 != 0 {
            i += 2;
        }
        if flags & 0x40 != 0 {
            let l = *cookie.get(i)? as usize;
            i += 1 + l;
        }
        if flags & 0x20 != 0 {
            i += 2;
        }
    } else {
        i = 0;
    }
    let (tag, j, _) = read_desc(cookie, i)?;
    if tag != 0x04 {
        return None;
    }
    let (tag, k, len) = read_desc(cookie, j + 13)?;
    if tag != 0x05 {
        return None;
    }
    cookie.get(k..k + len).map(|s| s.to_vec())
}

/// Wrap an AudioSpecificConfig in an MPEG-4 ES_Descriptor (the "esds" style
/// magic cookie AudioToolbox expects for AAC). Same layout as FFmpeg's
/// audiotoolboxdec.
pub fn esds_cookie(asc: &[u8]) -> Vec<u8> {
    fn put_descr(out: &mut Vec<u8>, tag: u8, size: usize) {
        out.push(tag);
        for i in (1..=3).rev() {
            out.push(((size >> (7 * i)) as u8 & 0x7f) | 0x80);
        }
        out.push(size as u8 & 0x7f);
    }
    let mut out = Vec::with_capacity(5 + 3 + 5 + 13 + 5 + asc.len());
    put_descr(&mut out, 0x03, 3 + 5 + 13 + 5 + asc.len());
    out.extend_from_slice(&[0, 0]); // ES_ID
    out.push(0); // flags
    put_descr(&mut out, 0x04, 13 + 5 + asc.len());
    out.push(0x40); // objectTypeIndication: MPEG-4 audio
    out.push(0x15); // streamType: audio
    out.extend_from_slice(&[0, 0, 0]); // bufferSizeDB
    out.extend_from_slice(&[0, 0, 0, 0]); // maxBitrate
    out.extend_from_slice(&[0, 0, 0, 0]); // avgBitrate
    put_descr(&mut out, 0x05, asc.len());
    out.extend_from_slice(asc);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asc_48k_stereo() {
        assert_eq!(build_asc(48000, 2), vec![0x11, 0x90]);
        assert_eq!(build_asc(44100, 2), vec![0x12, 0x10]);
    }

    #[test]
    fn esds_roundtrip() {
        let asc = [0x11u8, 0x90];
        let cookie = esds_cookie(&asc);
        assert_eq!(asc_from_esds(&cookie).unwrap(), asc);
    }
}
