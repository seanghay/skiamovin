//! A small software rasterizer with a depth buffer, for 3D scenes where sorting triangles isn't enough (objects
//! that cut through each other). It runs on the CPU, so the result is the same on every platform.

use crate::handles::put;
use crate::R;
use skia_safe::{images, AlphaType, ColorType, Data, ISize, ImageInfo};

/// Draws triangles into a new `width` × `height` image, keeping the nearest surface at each point.
/// `positions` has x, y (pixels) and depth per vertex, three vertices per triangle; `colors` has one ARGB color per
/// vertex, blended across the triangle. Each pixel takes `samples` × `samples` points and averages them for smooth
/// edges. Returns an image handle.
pub fn raster3d_triangles(width: u32, height: u32, positions: &[f32], colors: &[u32], samples: u32) -> R<u32> {
    let (w, h) = (width.max(1) as usize, height.max(1) as usize);
    let s = samples.clamp(1, 4) as usize;
    let count = positions.len() / 9;
    if colors.len() < count * 3 {
        return Err("raster3d: one color per vertex".into());
    }
    let (sw, sh) = (w * s, h * s);
    let mut depth = vec![f32::INFINITY; sw * sh];
    // Premultiplied RGBA per sample, as floats.
    let mut color = vec![[0f32; 4]; sw * sh];
    let unpack = |c: u32| {
        let a = ((c >> 24) & 255) as f32 / 255.0;
        [((c >> 16) & 255) as f32 / 255.0 * a, ((c >> 8) & 255) as f32 / 255.0 * a, (c & 255) as f32 / 255.0 * a, a]
    };
    let k = s as f32;
    for t in 0..count {
        let v = |i: usize| (positions[t * 9 + i * 3] * k, positions[t * 9 + i * 3 + 1] * k, positions[t * 9 + i * 3 + 2]);
        let (a, b, c) = (v(0), v(1), v(2));
        let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        if area.abs() < 1e-9 {
            continue;
        }
        let ca = unpack(colors[t * 3]);
        let cb = unpack(colors[t * 3 + 1]);
        let cc = unpack(colors[t * 3 + 2]);
        let x0 = a.0.min(b.0).min(c.0).floor().max(0.0) as usize;
        let x1 = (a.0.max(b.0).max(c.0).ceil() as isize).clamp(0, sw as isize - 1) as usize;
        let y0 = a.1.min(b.1).min(c.1).floor().max(0.0) as usize;
        let y1 = (a.1.max(b.1).max(c.1).ceil() as isize).clamp(0, sh as isize - 1) as usize;
        if x0 > x1 || y0 > y1 {
            continue;
        }
        for y in y0..=y1 {
            let py = y as f32 + 0.5;
            for x in x0..=x1 {
                let px = x as f32 + 0.5;
                let wa = ((b.0 - px) * (c.1 - py) - (b.1 - py) * (c.0 - px)) / area;
                let wb = ((c.0 - px) * (a.1 - py) - (c.1 - py) * (a.0 - px)) / area;
                let wc = 1.0 - wa - wb;
                if wa < 0.0 || wb < 0.0 || wc < 0.0 {
                    continue;
                }
                let z = wa * a.2 + wb * b.2 + wc * c.2;
                let i = y * sw + x;
                if z >= depth[i] {
                    continue;
                }
                depth[i] = z;
                color[i] = [0, 1, 2, 3].map(|ch| wa * ca[ch] + wb * cb[ch] + wc * cc[ch]);
            }
        }
    }
    let mut pixels = vec![0u8; w * h * 4];
    let n = (s * s) as f32;
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0f32; 4];
            for dy in 0..s {
                for dx in 0..s {
                    let c = color[(y * s + dy) * sw + x * s + dx];
                    for ch in 0..4 {
                        sum[ch] += c[ch];
                    }
                }
            }
            let o = (y * w + x) * 4;
            for ch in 0..4 {
                pixels[o + ch] = (sum[ch] / n * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    let info = ImageInfo::new(ISize::new(w as i32, h as i32), ColorType::RGBA8888, AlphaType::Premul, None);
    let img = images::raster_from_data(&info, Data::new_copy(&pixels), w * 4).ok_or("raster3d: image failed")?;
    Ok(put(img))
}
