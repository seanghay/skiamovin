//! Helpers for avcC / hvcC decoder configuration records and
//! length-prefixed NAL unit streams.

/// Parsed parameter sets from an avcC or hvcC record.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParameterSets {
    /// Size in bytes of each NAL length prefix (1, 2 or 4).
    pub nal_length_size: usize,
    /// Parameter set NAL units without length prefixes, in record order.
    pub nal_units: Vec<Vec<u8>>,
}

fn take<'a>(d: &'a [u8], i: &mut usize, n: usize) -> Option<&'a [u8]> {
    let s = d.get(*i..*i + n)?;
    *i += n;
    Some(s)
}

fn u16_at(d: &[u8], i: &mut usize) -> Option<usize> {
    let s = take(d, i, 2)?;
    Some(u16::from_be_bytes([s[0], s[1]]) as usize)
}

/// Parse an AVCDecoderConfigurationRecord (avcC).
pub fn parse_avcc(d: &[u8]) -> Option<ParameterSets> {
    if d.len() < 7 || d[0] != 1 {
        return None;
    }
    let nal_length_size = (d[4] & 3) as usize + 1;
    let mut i = 5;
    let mut nal_units = Vec::new();
    let nsps = (take(d, &mut i, 1)?[0] & 0x1f) as usize;
    for _ in 0..nsps {
        let n = u16_at(d, &mut i)?;
        nal_units.push(take(d, &mut i, n)?.to_vec());
    }
    let npps = take(d, &mut i, 1)?[0] as usize;
    for _ in 0..npps {
        let n = u16_at(d, &mut i)?;
        nal_units.push(take(d, &mut i, n)?.to_vec());
    }
    Some(ParameterSets { nal_length_size, nal_units })
}

/// Parse an HEVCDecoderConfigurationRecord (hvcC).
pub fn parse_hvcc(d: &[u8]) -> Option<ParameterSets> {
    if d.len() < 23 || d[0] != 1 {
        return None;
    }
    let nal_length_size = (d[21] & 3) as usize + 1;
    let mut i = 22;
    let narrays = take(d, &mut i, 1)?[0] as usize;
    let mut nal_units = Vec::new();
    for _ in 0..narrays {
        take(d, &mut i, 1)?; // array_completeness | reserved | NAL_unit_type
        let n = u16_at(d, &mut i)?;
        for _ in 0..n {
            let len = u16_at(d, &mut i)?;
            nal_units.push(take(d, &mut i, len)?.to_vec());
        }
    }
    Some(ParameterSets { nal_length_size, nal_units })
}
