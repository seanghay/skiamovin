//! GPU contexts and GPU surfaces. Metal on macOS (feature `metal`), WebGL2 on the web (feature `gl`).
//! Without either feature, every context function returns nothing and rendering uses the CPU.
#![cfg_attr(not(any(feature = "metal", feature = "gl")), allow(unused_imports, dead_code))]

use crate::api::surface::wrap_surface;
use crate::convert::{color_space, color_type};
use crate::handles::{get, put};
use crate::R;
use skia_safe::{ISize, Image, ImageInfo};

#[cfg(any(feature = "metal", feature = "gl"))]
use skia_safe::gpu::{self, DirectContext};

thread_local! {
    /// The most recently created GPU context on this thread, used to copy GPU images to the CPU.
    static CURRENT: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// Runs `f` with the current direct context (if any GPU context exists on this thread).
pub fn with_current_context<T>(f: impl FnOnce(Option<&mut skia_safe::gpu::DirectContext>) -> T) -> Option<T> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    {
        let h = CURRENT.with(|c| c.get());
        if h != 0 {
            if let Ok(c) = get::<ContextObj>(h) {
                let mut c = c.borrow_mut();
                return Some(f(Some(&mut c.ctx)));
            }
        }
    }
    Some(f(None))
}

fn make_current(h: u32) -> u32 {
    CURRENT.with(|c| c.set(h));
    h
}

pub struct ContextObj {
    #[cfg(any(feature = "metal", feature = "gl"))]
    pub ctx: DirectContext,
    pub backend: &'static str,
    #[cfg(feature = "metal")]
    pub metal: crate::api::gpu::metal::MetalDevice,
}

#[cfg(feature = "metal")]
pub mod metal {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_metal::{MTLCommandQueue, MTLCreateSystemDefaultDevice, MTLDevice};

    pub struct MetalDevice {
        pub device: Retained<ProtocolObject<dyn MTLDevice>>,
        pub queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
    }

    pub fn create() -> Option<MetalDevice> {
        let device = MTLCreateSystemDefaultDevice()?;
        let queue = device.newCommandQueue()?;
        Some(MetalDevice { device, queue })
    }

    pub fn name(d: &MetalDevice) -> String {
        d.device.name().to_string()
    }

    use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString};
    use objc2_io_surface::{
        kIOSurfaceBytesPerElement, kIOSurfaceHeight, kIOSurfacePixelFormat, kIOSurfaceWidth, IOSurfaceRef,
    };
    use objc2_metal::{MTLPixelFormat, MTLStorageMode, MTLTexture, MTLTextureDescriptor, MTLTextureUsage};

    /// An IOSurface and a Metal texture that shares its memory.
    pub struct IOSurfaceTexture {
        pub surface: CFRetained<IOSurfaceRef>,
        pub texture: Retained<ProtocolObject<dyn MTLTexture>>,
    }

    /// Creates a BGRA IOSurface (what VideoToolbox reads without conversion).
    pub fn create_iosurface(width: i32, height: i32) -> Option<CFRetained<IOSurfaceRef>> {
        let keys: [&CFString; 4] =
            unsafe { [kIOSurfaceWidth, kIOSurfaceHeight, kIOSurfaceBytesPerElement, kIOSurfacePixelFormat] };
        let values = [
            CFNumber::new_i32(width),
            CFNumber::new_i32(height),
            CFNumber::new_i32(4),
            CFNumber::new_i32(0x42475241 /* 'BGRA' */),
        ];
        let vals: Vec<&CFNumber> = values.iter().map(|v| &**v).collect();
        let dict = CFDictionary::from_slices(&keys, &vals);
        unsafe { IOSurfaceRef::new(dict.as_opaque()) }
    }

    /// A Metal texture that shares the memory of `surface`.
    pub fn texture_for(
        device: &ProtocolObject<dyn MTLDevice>,
        surface: &IOSurfaceRef,
        width: usize,
        height: usize,
        render_target: bool,
    ) -> Option<Retained<ProtocolObject<dyn MTLTexture>>> {
        let desc = unsafe {
            MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                MTLPixelFormat::BGRA8Unorm,
                width,
                height,
                false,
            )
        };
        let mut usage = MTLTextureUsage::ShaderRead;
        if render_target {
            usage |= MTLTextureUsage::RenderTarget;
        }
        desc.setUsage(usage);
        desc.setStorageMode(MTLStorageMode::Shared);
        device.newTextureWithDescriptor_iosurface_plane(&desc, surface, 0)
    }
}

/// GPU surface backed by an IOSurface, so the video encoder can read it without a copy.
/// Returns 0 when Metal is not available.
pub fn gpu_surface_iosurface(h: u32, width: i32, height: i32, color_space_code: u32) -> R<u32> {
    #[cfg(feature = "metal")]
    {
        let c = get::<ContextObj>(h)?;
        let mut c = c.borrow_mut();
        let Some(surface) = metal::create_iosurface(width, height) else { return Ok(0) };
        let Some(texture) = metal::texture_for(&c.metal.device, &surface, width as usize, height as usize, true) else {
            return Ok(0);
        };
        let info = unsafe { gpu::mtl::TextureInfo::new(objc2::rc::Retained::as_ptr(&texture) as gpu::mtl::Handle) };
        let bt = unsafe {
            gpu::backend_textures::make_mtl((width, height), gpu::Mipmapped::No, &info, "skiamovin-iosurface")
        };
        let Some(s) = gpu::surfaces::wrap_backend_texture(
            &mut c.ctx,
            &bt,
            gpu::SurfaceOrigin::TopLeft,
            None,
            skia_safe::ColorType::BGRA8888,
            color_space(color_space_code),
            None,
        ) else {
            return Ok(0);
        };
        let ptr = objc2_core_foundation::CFRetained::as_ptr(&surface).as_ptr() as usize;
        drop(c);
        return Ok(crate::api::surface::wrap_surface_native(
            s,
            Some(Box::new(metal::IOSurfaceTexture { surface, texture })),
            ptr,
        ));
    }
    #[allow(unreachable_code)]
    {
        let _ = (h, width, height, color_space_code);
        Ok(0)
    }
}

/// Wraps a BGRA IOSurface, such as a decoded video frame, as a GPU image without copying. The caller
/// must keep the frame alive while the image is in use. Returns 0 if unsupported.
pub fn image_from_iosurface(h: u32, iosurface: f64, width: i32, height: i32) -> R<u32> {
    #[cfg(feature = "metal")]
    {
        if iosurface == 0.0 {
            return Ok(0);
        }
        let c = get::<ContextObj>(h)?;
        let mut c = c.borrow_mut();
        let surface: &objc2_io_surface::IOSurfaceRef =
            unsafe { &*(iosurface as usize as *const objc2_io_surface::IOSurfaceRef) };
        let Some(texture) = metal::texture_for(&c.metal.device, surface, width as usize, height as usize, false) else {
            return Ok(0);
        };
        let info = unsafe { gpu::mtl::TextureInfo::new(objc2::rc::Retained::as_ptr(&texture) as gpu::mtl::Handle) };
        let bt =
            unsafe { gpu::backend_textures::make_mtl((width, height), gpu::Mipmapped::No, &info, "skiamovin-frame") };
        let img = gpu::images::adopt_texture_from(
            &mut c.ctx,
            &bt,
            gpu::SurfaceOrigin::TopLeft,
            skia_safe::ColorType::BGRA8888,
            skia_safe::AlphaType::Premul,
            None,
        );
        return Ok(img.map(put).unwrap_or(0));
    }
    #[allow(unreachable_code)]
    {
        let _ = (h, iosurface, width, height);
        Ok(0)
    }
}

/// Which backend `gpu_make_default_context` would pick: "metal", "webgl2" or "raster".
pub fn gpu_default_backend() -> String {
    if cfg!(feature = "metal") {
        "metal".into()
    } else if cfg!(feature = "gl") {
        "webgl2".into()
    } else {
        "raster".into()
    }
}

/// Creates a Metal context (macOS). Returns 0 if Metal is unavailable.
pub fn gpu_make_metal_context(resource_cache_limit: f64) -> R<u32> {
    #[cfg(feature = "metal")]
    {
        use skia_safe::gpu::mtl;
        let Some(dev) = metal::create() else { return Ok(0) };
        let backend = unsafe {
            mtl::BackendContext::new(
                objc2::rc::Retained::as_ptr(&dev.device) as mtl::Handle,
                objc2::rc::Retained::as_ptr(&dev.queue) as mtl::Handle,
            )
        };
        let Some(mut ctx) = gpu::direct_contexts::make_metal(&backend, None) else { return Ok(0) };
        if resource_cache_limit > 0.0 {
            ctx.set_resource_cache_limit(resource_cache_limit as usize);
        }
        return Ok(make_current(put(ContextObj { ctx, backend: "metal", metal: dev })));
    }
    #[allow(unreachable_code)]
    {
        let _ = resource_cache_limit;
        Ok(0)
    }
}

/// Creates a GL context from the GL context that is current on this thread (WebGL2 on the web).
/// Returns 0 on failure.
pub fn gpu_make_gl_context(resource_cache_limit: f64) -> R<u32> {
    #[cfg(feature = "gl")]
    {
        let Some(interface) = gpu::gl::Interface::new_native() else { return Ok(0) };
        let Some(mut ctx) = gpu::direct_contexts::make_gl(interface, None) else { return Ok(0) };
        if resource_cache_limit > 0.0 {
            ctx.set_resource_cache_limit(resource_cache_limit as usize);
        }
        return Ok(make_current(put(ContextObj { ctx, backend: "webgl2" })));
    }
    #[allow(unreachable_code)]
    {
        let _ = resource_cache_limit;
        Ok(0)
    }
}

pub fn gpu_context_backend(h: u32) -> R<String> {
    Ok(get::<ContextObj>(h)?.borrow().backend.to_string())
}

/// Device name, if known.
pub fn gpu_context_device_name(h: u32) -> R<String> {
    let _c = get::<ContextObj>(h)?;
    #[cfg(feature = "metal")]
    {
        return Ok(metal::name(&_c.borrow().metal));
    }
    #[allow(unreachable_code)]
    Ok(String::new())
}

/// GPU render target. sample_count 1 = no MSAA.
pub fn gpu_surface_render_target(
    h: u32,
    width: i32,
    height: i32,
    sample_count: u32,
    color_type_code: u32,
    color_space_code: u32,
) -> R<u32> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    {
        let c = get::<ContextObj>(h)?;
        let mut c = c.borrow_mut();
        let info = ImageInfo::new(
            ISize::new(width, height),
            color_type(color_type_code),
            skia_safe::AlphaType::Premul,
            color_space(color_space_code),
        );
        let s = gpu::surfaces::render_target(
            &mut c.ctx,
            gpu::Budgeted::Yes,
            &info,
            Some(sample_count.max(1) as usize),
            gpu::SurfaceOrigin::TopLeft,
            None,
            false,
            None,
        )
        .ok_or_else(|| format!("could not create a {width}x{height} GPU render target"))?;
        return Ok(wrap_surface(s));
    }
    #[allow(unreachable_code)]
    {
        let _ = (h, width, height, sample_count, color_type_code, color_space_code);
        Err("GPU support is not compiled in".into())
    }
}

/// Wraps the currently bound GL framebuffer `fbo` (0 = the canvas) as a surface (web).
pub fn gpu_surface_wrap_gl_framebuffer(
    h: u32,
    width: i32,
    height: i32,
    fbo: u32,
    samples: u32,
    stencil: u32,
) -> R<u32> {
    #[cfg(feature = "gl")]
    {
        use skia_safe::gpu::gl::FramebufferInfo;
        let c = get::<ContextObj>(h)?;
        let mut c = c.borrow_mut();
        let fb = FramebufferInfo { fboid: fbo, format: 0x8058 /* GL_RGBA8 */, ..Default::default() };
        let rt = gpu::backend_render_targets::make_gl((width, height), samples as usize, stencil as usize, fb);
        let s = gpu::surfaces::wrap_backend_render_target(
            &mut c.ctx,
            &rt,
            gpu::SurfaceOrigin::BottomLeft,
            skia_safe::ColorType::RGBA8888,
            None,
            None,
        )
        .ok_or("could not wrap the WebGL framebuffer")?;
        return Ok(wrap_surface(s));
    }
    #[allow(unreachable_code)]
    {
        let _ = (h, width, height, fbo, samples, stencil);
        Err("GL support is not compiled in".into())
    }
}

pub fn gpu_context_flush_and_submit(h: u32, sync_cpu: bool) -> R<()> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    {
        let c = get::<ContextObj>(h)?;
        let mut c = c.borrow_mut();
        let _ = c.ctx.flush_and_submit();
        if sync_cpu {
            c.ctx.submit(gpu::SyncCpu::Yes);
        }
    }
    let _ = (h, sync_cpu);
    Ok(())
}

pub fn gpu_context_free_gpu_resources(h: u32) -> R<()> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    get::<ContextObj>(h)?.borrow_mut().ctx.free_gpu_resources();
    let _ = h;
    Ok(())
}

pub fn gpu_context_perform_deferred_cleanup(h: u32, ms: f64) -> R<()> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    get::<ContextObj>(h)?.borrow_mut().ctx.perform_deferred_cleanup(std::time::Duration::from_millis(ms as u64), None);
    let _ = (h, ms);
    Ok(())
}

/// `[resourceCount, bytes]`.
pub fn gpu_context_resource_cache_usage(h: u32) -> R<Vec<f64>> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    {
        let c = get::<ContextObj>(h)?;
        let u = c.borrow().ctx.resource_cache_usage();
        return Ok(vec![u.resource_count as f64, u.resource_bytes as f64]);
    }
    #[allow(unreachable_code)]
    {
        let _ = h;
        Ok(vec![0.0, 0.0])
    }
}

pub fn gpu_context_is_abandoned(h: u32) -> R<bool> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    return Ok(get::<ContextObj>(h)?.borrow_mut().ctx.abandoned());
    #[allow(unreachable_code)]
    {
        let _ = h;
        Ok(false)
    }
}

pub fn gpu_context_abandon(h: u32) -> R<()> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    get::<ContextObj>(h)?.borrow_mut().ctx.abandon();
    let _ = h;
    Ok(())
}

pub(crate) fn make_texture_image(img: &Image, ctx: u32, mipmapped: bool) -> R<Image> {
    #[cfg(any(feature = "metal", feature = "gl"))]
    {
        let c = get::<ContextObj>(ctx)?;
        let mut c = c.borrow_mut();
        let mm = if mipmapped { gpu::Mipmapped::Yes } else { gpu::Mipmapped::No };
        return gpu::images::texture_from_image(&mut c.ctx, img, mm, gpu::Budgeted::Yes)
            .ok_or_else(|| "texture upload failed".into());
    }
    #[allow(unreachable_code)]
    {
        let _ = (img, ctx, mipmapped);
        Err("GPU support is not compiled in".into())
    }
}
