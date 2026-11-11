//! A small owned BGRA IOSurface, mainly for tests of
//! [`VideoEncoder::encode_iosurface`](crate::VideoEncoder::encode_iosurface).

use crate::Result;

/// Create a BGRA IOSurface that the CPU can write to.
pub fn create_iosurface_bgra(width: u32, height: u32) -> Result<IOSurfaceHandle> {
    imp::create(width, height)
}

/// An owned (+1) `IOSurfaceRef`, released on drop.
pub struct IOSurfaceHandle {
    ptr: *mut std::ffi::c_void,
    width: u32,
    height: u32,
    bytes_per_row: usize,
}

// IOSurfaces can be used from any thread, and pixel access needs `&mut self`.
unsafe impl Send for IOSurfaceHandle {}

impl IOSurfaceHandle {
    /// The raw `IOSurfaceRef` (not retained; valid while `self` lives).
    pub fn as_ptr(&self) -> *mut std::ffi::c_void {
        self.ptr
    }
    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    /// Row pitch in bytes (may be larger than `width * 4`).
    pub fn bytes_per_row(&self) -> usize {
        self.bytes_per_row
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::cf::*;
    use crate::error::check;
    use crate::ffi::*;
    use crate::CodecError;

    pub(super) fn create(width: u32, height: u32) -> Result<IOSurfaceHandle> {
        if width == 0 || height == 0 {
            return Err(CodecError::new("width and height must be non-zero"));
        }
        unsafe {
            let w = cf_i32(width as i32);
            let h = cf_i32(height as i32);
            let bpe = cf_i32(4);
            let fmt = cf_i32(kCVPixelFormatType_32BGRA as i32);
            let mut d = CfDict::new();
            d.set(kIOSurfaceWidth, w.as_ptr())
                .set(kIOSurfaceHeight, h.as_ptr())
                .set(kIOSurfaceBytesPerElement, bpe.as_ptr())
                .set(kIOSurfacePixelFormat, fmt.as_ptr());
            let s = IOSurfaceCreate(d.as_ptr());
            if s.is_null() {
                return Err(CodecError::new("IOSurfaceCreate failed"));
            }
            Ok(IOSurfaceHandle { ptr: s, width, height, bytes_per_row: IOSurfaceGetBytesPerRow(s) })
        }
    }

    impl IOSurfaceHandle {
        /// Lock the surface for CPU writes and call `f` with its pixel bytes
        /// (`bytes_per_row() * height()` bytes, BGRA8, top-left origin).
        pub fn with_locked_mut<R>(&mut self, f: impl FnOnce(&mut [u8]) -> R) -> Result<R> {
            unsafe {
                check("IOSurfaceLock", IOSurfaceLock(self.ptr, 0, std::ptr::null_mut()))?;
                let base = IOSurfaceGetBaseAddress(self.ptr) as *mut u8;
                if base.is_null() {
                    IOSurfaceUnlock(self.ptr, 0, std::ptr::null_mut());
                    return Err(CodecError::new("IOSurfaceGetBaseAddress returned null"));
                }
                let len = (self.bytes_per_row * self.height as usize).min(IOSurfaceGetAllocSize(self.ptr));
                // Unlock even if `f` panics.
                struct Unlock(IOSurfaceRef);
                impl Drop for Unlock {
                    fn drop(&mut self) {
                        unsafe { IOSurfaceUnlock(self.0, 0, std::ptr::null_mut()) };
                    }
                }
                let _guard = Unlock(self.ptr);
                Ok(f(std::slice::from_raw_parts_mut(base, len)))
            }
        }

        /// Whether anything else, such as VideoToolbox, is still using the surface.
        pub fn is_in_use(&self) -> bool {
            unsafe { IOSurfaceIsInUse(self.ptr) != 0 }
        }
    }

    impl Drop for IOSurfaceHandle {
        fn drop(&mut self) {
            unsafe { CFRelease(self.ptr as CFTypeRef) }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use crate::error::unsupported;

    pub(super) fn create(_: u32, _: u32) -> Result<IOSurfaceHandle> {
        unsupported()
    }

    impl IOSurfaceHandle {
        pub fn with_locked_mut<R>(&mut self, _f: impl FnOnce(&mut [u8]) -> R) -> Result<R> {
            unsupported()
        }
        pub fn is_in_use(&self) -> bool {
            false
        }
    }
}
