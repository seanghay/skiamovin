use crate::api::surface::{alpha_type_code, color_type_code, encoded_format};
use crate::convert::{alpha_type, color_space, color_type, matrix_opt, rect_opt, sampling, tile_mode};
use crate::handles::{cloned, get, put};
use crate::R;
use skia_safe::{codec, images, Data, IPoint, ISize, Image, ImageInfo};

pub fn encode_image(img: &Image, format: u32, quality: u32) -> R<Vec<u8>> {
    let raster = to_raster(img)?;
    let data = raster
        .encode_to_data_with_quality(encoded_format(format), quality.min(100))
        .ok_or("image encoding failed (unsupported format?)")?;
    Ok(data.as_bytes().to_vec())
}

/// Returns a CPU copy of a GPU image using the thread's current GPU context, or the image itself.
pub fn to_raster(img: &Image) -> R<Image> {
    if !img.is_texture_backed() {
        return Ok(img.clone());
    }
    crate::api::gpu::with_current_context(|ctx| img.make_raster_image(ctx, None))
        .flatten()
        .ok_or_else(|| "could not read back a GPU image".into())
}

/// Decodes an encoded image (PNG, JPEG, WebP, GIF, BMP, ICO, WBMP). Decoding happens lazily on first draw.
pub fn image_decode(bytes: &[u8]) -> R<u32> {
    let img = images::deferred_from_encoded_data(Data::new_copy(bytes), None).ok_or("could not decode image")?;
    Ok(put(img))
}

/// Copies raw pixels into a new raster image.
pub fn image_from_pixels(
    width: i32,
    height: i32,
    color_type_code: u32,
    alpha_type_code: u32,
    color_space_code: u32,
    pixels: &[u8],
    row_bytes: u32,
) -> R<u32> {
    let info = ImageInfo::new(
        ISize::new(width, height),
        color_type(color_type_code),
        alpha_type(alpha_type_code),
        color_space(color_space_code),
    );
    let rb = if row_bytes == 0 { info.min_row_bytes() } else { row_bytes as usize };
    if pixels.len() < rb * height as usize {
        return Err(format!("pixel buffer too small: {} < {}", pixels.len(), rb * height as usize));
    }
    let img = images::raster_from_data(&info, Data::new_copy(&pixels[..rb * height as usize]), rb)
        .ok_or("could not create image from pixels")?;
    Ok(put(img))
}

pub fn image_width(h: u32) -> R<i32> {
    Ok(get::<Image>(h)?.borrow().width())
}

pub fn image_height(h: u32) -> R<i32> {
    Ok(get::<Image>(h)?.borrow().height())
}

/// `[colorType, alphaType]` codes.
pub fn image_info(h: u32) -> R<Vec<u32>> {
    let i = get::<Image>(h)?;
    let i = i.borrow();
    Ok(vec![color_type_code(i.color_type()), alpha_type_code(i.alpha_type())])
}

pub fn image_is_texture_backed(h: u32) -> R<bool> {
    Ok(get::<Image>(h)?.borrow().is_texture_backed())
}

/// Format codes: 0 PNG, 1 JPEG, 2 WEBP.
pub fn image_encode(h: u32, format: u32, quality: u32) -> R<Vec<u8>> {
    let img = cloned::<Image>(h)?;
    encode_image(&img, format, quality)
}

pub fn image_read_pixels(
    h: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    color_type_code: u32,
    alpha_type_code: u32,
) -> R<Vec<u8>> {
    let img = cloned::<Image>(h)?;
    let info = ImageInfo::new(
        ISize::new(width, height),
        color_type(color_type_code),
        alpha_type(alpha_type_code),
        img.color_space(),
    );
    let rb = info.min_row_bytes();
    let mut out = vec![0u8; rb * height as usize];
    #[cfg(feature = "ganesh")]
    let ok = if img.is_texture_backed() {
        crate::api::gpu::with_current_context(|ctx| {
            img.read_pixels_with_context(
                ctx,
                &info,
                &mut out,
                rb,
                IPoint::new(x, y),
                skia_safe::image::CachingHint::Allow,
            )
        })
        .unwrap_or(false)
    } else {
        img.read_pixels(&info, &mut out, rb, IPoint::new(x, y), skia_safe::image::CachingHint::Allow)
    };
    #[cfg(not(feature = "ganesh"))]
    let ok = img.read_pixels(&info, &mut out, rb, IPoint::new(x, y), skia_safe::image::CachingHint::Allow);
    if !ok {
        return Err("image.readPixels failed".into());
    }
    Ok(out)
}

/// tile modes x/y, sampling code, local matrix ([] = identity).
pub fn image_make_shader(h: u32, tmx: u32, tmy: u32, sampling_code: u32, m: &[f32]) -> R<u32> {
    let img = cloned::<Image>(h)?;
    let m = matrix_opt(m)?;
    let s = img
        .to_shader((tile_mode(tmx), tile_mode(tmy)), sampling(sampling_code), m.as_ref())
        .ok_or("could not create image shader")?;
    Ok(put(s))
}

pub fn image_make_raster(h: u32) -> R<u32> {
    let img = cloned::<Image>(h)?;
    Ok(put(to_raster(&img)?))
}

/// Uploads to the GPU context `ctx` (a DirectContext handle).
pub fn image_make_texture(h: u32, ctx: u32, mipmapped: bool) -> R<u32> {
    let img = cloned::<Image>(h)?;
    crate::api::gpu::make_texture_image(&img, ctx, mipmapped).map(put)
}

pub fn image_make_subset(h: u32, rect: &[f32]) -> R<u32> {
    let img = cloned::<Image>(h)?;
    let r = rect_opt(rect)?.ok_or("rect required")?.round();
    let src = to_raster(&img)?;
    let s = src.make_subset(None, r, Default::default()).ok_or("makeSubset failed")?;
    Ok(put(s))
}

/// Applies an image filter to the image; returns a new image handle. `subset` = [] for the whole image.
pub fn image_make_with_filter(h: u32, filter: u32, subset: &[f32]) -> R<u32> {
    let img = cloned::<Image>(h)?;
    let f = cloned::<skia_safe::ImageFilter>(filter)?;
    let subset = rect_opt(subset)?.map(|r| r.round()).unwrap_or_else(|| img.bounds());
    let clip = img.bounds();
    let (out, _, _) = images::make_with_filter(to_raster(&img)?, &f, subset, clip).ok_or("makeWithFilter failed")?;
    Ok(put(out))
}

// ---- animated images (GIF / WebP) ----

pub struct CodecObj {
    codec: codec::Codec<'static>,
    data: Data,
}

pub fn codec_new(bytes: &[u8]) -> R<u32> {
    let data = Data::new_copy(bytes);
    let c = codec::Codec::from_data(data.clone()).ok_or("could not create codec")?;
    Ok(put(CodecObj { codec: c, data }))
}

pub fn codec_frame_count(h: u32) -> R<u32> {
    Ok(get::<CodecObj>(h)?.borrow_mut().codec.get_frame_count() as u32)
}

/// Per-frame durations in milliseconds.
pub fn codec_frame_durations(h: u32) -> R<Vec<f32>> {
    let c = get::<CodecObj>(h)?;
    let mut c = c.borrow_mut();
    let n = c.codec.get_frame_count();
    Ok((0..n).map(|i| c.codec.get_frame_info(i).map(|f| f.duration as f32).unwrap_or(0.0)).collect())
}

pub fn codec_repetition_count(h: u32) -> R<i32> {
    Ok(get::<CodecObj>(h)?.borrow_mut().codec.get_repetition_count().map(|c| c as i32).unwrap_or(-1))
}

pub fn codec_dimensions(h: u32) -> R<Vec<f32>> {
    let d = get::<CodecObj>(h)?.borrow().codec.dimensions();
    Ok(vec![d.width as f32, d.height as f32])
}

/// Decodes frame `index` into a new raster image (compositing with required prior frames).
pub fn codec_get_frame(h: u32, index: u32) -> R<u32> {
    let c = get::<CodecObj>(h)?;
    let c = c.borrow();
    // Use the animated-image path for correct frame composition.
    let mut anim = codec::Codec::from_data(c.data.clone()).ok_or("codec reopen failed")?;
    let info = anim.info().with_color_type(skia_safe::ColorType::N32).with_alpha_type(skia_safe::AlphaType::Premul);
    let rb = info.min_row_bytes();
    let mut pixels = vec![0u8; rb * info.height() as usize];
    // Decode frames from the required independent frame up to `index`.
    let mut start = index as usize;
    while start > 0 {
        let Some(fi) = anim.get_frame_info(start) else { break };
        if fi.required_frame < 0 {
            break;
        }
        start = fi.required_frame as usize;
    }
    for i in start..=(index as usize) {
        let opts = codec::Options {
            frame_index: i,
            prior_frame: if i == start { None } else { Some(i - 1) },
            ..Default::default()
        };
        let r = anim.get_pixels_with_options(&info, &mut pixels, rb, Some(&opts));
        if r != codec::Result::Success && r != codec::Result::IncompleteInput {
            return Err(format!("frame decode failed: {r:?}"));
        }
    }
    let img = images::raster_from_data(&info, Data::new_copy(&pixels), rb).ok_or("frame image failed")?;
    Ok(put(img))
}
