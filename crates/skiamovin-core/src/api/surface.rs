use crate::api::canvas::CanvasRef;
use crate::convert::{alpha_type, color_space, color_type};
use crate::handles::{get, put};
use crate::R;
use skia_safe::{surfaces, EncodedImageFormat, IPoint, ISize, ImageInfo, Surface};

/// A surface plus the handle of its canvas object (created lazily, owned by the surface).
pub struct SurfaceObj {
    pub surface: Surface,
    pub canvas_handle: u32,
    /// Platform resources behind the surface, such as an IOSurface and Metal texture.
    pub native: Option<Box<dyn std::any::Any>>,
    /// The IOSurfaceRef pointer on macOS, or 0.
    pub iosurface: usize,
}

impl Drop for SurfaceObj {
    fn drop(&mut self) {
        if self.canvas_handle != 0 {
            crate::handles::remove(self.canvas_handle);
        }
    }
}

pub fn wrap_surface(surface: Surface) -> u32 {
    wrap_surface_native(surface, None, 0)
}

pub fn wrap_surface_native(surface: Surface, native: Option<Box<dyn std::any::Any>>, iosurface: usize) -> u32 {
    let h = put(SurfaceObj { surface, canvas_handle: 0, native, iosurface });
    let c = put(CanvasRef::Surface(h));
    get::<SurfaceObj>(h).unwrap().borrow_mut().canvas_handle = c;
    h
}

pub fn surface_raster(
    width: i32,
    height: i32,
    color_type_code: u32,
    alpha_type_code: u32,
    color_space_code: u32,
) -> R<u32> {
    let info = ImageInfo::new(
        ISize::new(width, height),
        color_type(color_type_code),
        alpha_type(alpha_type_code),
        color_space(color_space_code),
    );
    let s = surfaces::raster(&info, None, None)
        .ok_or_else(|| format!("could not create a {width}x{height} raster surface"))?;
    Ok(wrap_surface(s))
}

pub fn surface_raster_n32_premul(width: i32, height: i32) -> R<u32> {
    let s = surfaces::raster_n32_premul((width, height))
        .ok_or_else(|| format!("could not create a {width}x{height} raster surface"))?;
    Ok(wrap_surface(s))
}

pub fn surface_null(width: i32, height: i32) -> R<u32> {
    let s = surfaces::null((width, height)).ok_or("could not create a null surface")?;
    Ok(wrap_surface(s))
}

pub fn surface_canvas(surface: u32) -> R<u32> {
    Ok(get::<SurfaceObj>(surface)?.borrow().canvas_handle)
}

pub fn surface_width(surface: u32) -> R<i32> {
    Ok(get::<SurfaceObj>(surface)?.borrow().surface.width())
}

pub fn surface_height(surface: u32) -> R<i32> {
    Ok(get::<SurfaceObj>(surface)?.borrow().surface.height())
}

/// `[colorType, alphaType]` codes (see convert.rs).
pub fn surface_image_info(surface: u32) -> R<Vec<u32>> {
    let s = get::<SurfaceObj>(surface)?;
    let info = s.borrow().surface.image_info();
    Ok(vec![color_type_code(info.color_type()), alpha_type_code(info.alpha_type())])
}

pub fn surface_image_snapshot(surface: u32) -> R<u32> {
    let s = get::<SurfaceObj>(surface)?;
    let img = s.borrow_mut().surface.image_snapshot();
    Ok(put(img))
}

pub fn surface_is_gpu(surface: u32) -> R<bool> {
    Ok(get::<SurfaceObj>(surface)?.borrow().surface.recording_context().is_some())
}

/// Reads pixels into a new buffer. `color_type_code`: 0 RGBA8888, 1 BGRA8888, 3 RGBA_F16 ...; alpha 2 premul, 3 unpremul.
pub fn surface_read_pixels(
    surface: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    color_type_code: u32,
    alpha_type_code: u32,
) -> R<Vec<u8>> {
    let s = get::<SurfaceObj>(surface)?;
    let mut s = s.borrow_mut();
    let cs = s.surface.image_info().color_space();
    let info = ImageInfo::new(ISize::new(width, height), color_type(color_type_code), alpha_type(alpha_type_code), cs);
    let row_bytes = info.min_row_bytes();
    let mut out = vec![0u8; row_bytes * height as usize];
    if !s.surface.read_pixels(&info, &mut out, row_bytes, IPoint::new(x, y)) {
        return Err("surface.readPixels failed".into());
    }
    Ok(out)
}

/// Writes RGBA/BGRA pixels into the surface at (x, y).
pub fn surface_write_pixels(
    surface: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    color_type_code: u32,
    alpha_type_code: u32,
    pixels: &[u8],
) -> R<()> {
    let s = get::<SurfaceObj>(surface)?;
    let mut s = s.borrow_mut();
    let info =
        ImageInfo::new(ISize::new(width, height), color_type(color_type_code), alpha_type(alpha_type_code), None);
    let row_bytes = info.min_row_bytes();
    if pixels.len() < row_bytes * height as usize {
        return Err("pixel buffer too small".into());
    }
    let mut copy = pixels[..row_bytes * height as usize].to_vec();
    let pm = skia_safe::Pixmap::new(&info, &mut copy, row_bytes).ok_or("invalid pixmap")?;
    s.surface.write_pixels_from_pixmap(&pm, IPoint::new(x, y));
    Ok(())
}

/// Format codes: 0 PNG, 1 JPEG, 2 WEBP.
pub fn surface_encode(surface: u32, format: u32, quality: u32) -> R<Vec<u8>> {
    let s = get::<SurfaceObj>(surface)?;
    let img = s.borrow_mut().surface.image_snapshot();
    crate::api::image::encode_image(&img, format, quality)
}

/// The IOSurfaceRef pointer of a GPU surface on macOS, or 0.
pub fn surface_iosurface(surface: u32) -> R<f64> {
    Ok(get::<SurfaceObj>(surface)?.borrow().iosurface as f64)
}

/// Flushes the surface and waits for the GPU to finish, so other APIs can read its memory.
pub fn surface_flush_sync(surface: u32) -> R<()> {
    #[cfg(feature = "ganesh")]
    {
        let s = get::<SurfaceObj>(surface)?;
        let mut s = s.borrow_mut();
        if let Some(mut ctx) = s.surface.direct_context() {
            let _ = ctx.flush_and_submit_surface(&mut s.surface, None);
            ctx.submit(skia_safe::gpu::SyncCpu::Yes);
        }
    }
    #[cfg(not(feature = "ganesh"))]
    get::<SurfaceObj>(surface)?;
    Ok(())
}

pub fn surface_flush_and_submit(surface: u32) -> R<()> {
    #[cfg(feature = "ganesh")]
    {
        let s = get::<SurfaceObj>(surface)?;
        let mut s = s.borrow_mut();
        if let Some(mut ctx) = s.surface.direct_context() {
            let _ = ctx.flush_and_submit_surface(&mut s.surface, None);
        }
    }
    #[cfg(not(feature = "ganesh"))]
    get::<SurfaceObj>(surface)?;
    Ok(())
}

pub fn encoded_format(code: u32) -> EncodedImageFormat {
    match code {
        1 => EncodedImageFormat::JPEG,
        2 => EncodedImageFormat::WEBP,
        _ => EncodedImageFormat::PNG,
    }
}

pub fn color_type_code(ct: skia_safe::ColorType) -> u32 {
    use skia_safe::ColorType as C;
    match ct {
        C::RGBA8888 => 0,
        C::BGRA8888 => 1,
        C::RGBAF16 => 3,
        C::RGBA1010102 => 4,
        C::Alpha8 => 5,
        C::Gray8 => 6,
        C::RGB565 => 7,
        C::RGBAF32 => 8,
        _ => 2,
    }
}

pub fn alpha_type_code(at: skia_safe::AlphaType) -> u32 {
    use skia_safe::AlphaType as A;
    match at {
        A::Opaque => 1,
        A::Premul => 2,
        A::Unpremul => 3,
        _ => 0,
    }
}
