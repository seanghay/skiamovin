//! Small RAII helpers around CoreFoundation objects.

use crate::ffi::*;
use std::ffi::{c_void, CString};
use std::ptr;

/// An owned (+1 retained) CoreFoundation reference, released on drop.
pub struct CfOwned(pub CFTypeRef);

impl CfOwned {
    pub fn as_ptr(&self) -> CFTypeRef {
        self.0
    }
}

impl Drop for CfOwned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

pub fn cf_i32(v: i32) -> CfOwned {
    unsafe { CfOwned(CFNumberCreate(ptr::null(), kCFNumberSInt32Type, &v as *const i32 as *const c_void)) }
}

pub fn cf_i64(v: i64) -> CfOwned {
    unsafe { CfOwned(CFNumberCreate(ptr::null(), kCFNumberSInt64Type, &v as *const i64 as *const c_void)) }
}

pub fn cf_f64(v: f64) -> CfOwned {
    unsafe { CfOwned(CFNumberCreate(ptr::null(), kCFNumberFloat64Type, &v as *const f64 as *const c_void)) }
}

pub fn cf_str(s: &str) -> CfOwned {
    let c = CString::new(s).expect("no NUL in CF string");
    unsafe { CfOwned(CFStringCreateWithCString(ptr::null(), c.as_ptr(), kCFStringEncodingUTF8)) }
}

pub fn cf_data(bytes: &[u8]) -> CfOwned {
    unsafe { CfOwned(CFDataCreate(ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex)) }
}

pub fn cf_bool(b: bool) -> CFBooleanRef {
    unsafe {
        if b {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        }
    }
}

/// Copy the bytes of a CFData (borrowed reference).
///
/// # Safety
/// `data` must be a valid CFDataRef.
pub unsafe fn cf_data_bytes(data: CFDataRef) -> Vec<u8> {
    let len = CFDataGetLength(data) as usize;
    let p = CFDataGetBytePtr(data);
    if p.is_null() || len == 0 {
        return Vec::new();
    }
    std::slice::from_raw_parts(p, len).to_vec()
}

/// Mutable CFDictionary with CFType callbacks.
pub struct CfDict(CfOwned);

impl CfDict {
    pub fn new() -> CfDict {
        unsafe {
            CfDict(CfOwned(CFDictionaryCreateMutable(
                ptr::null(),
                0,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            ) as CFTypeRef))
        }
    }
    /// Set a value; the dictionary retains both key and value.
    pub fn set(&mut self, key: CFStringRef, value: CFTypeRef) -> &mut Self {
        unsafe { CFDictionarySetValue(self.0 .0 as CFMutableDictionaryRef, key, value) };
        self
    }
    pub fn as_ptr(&self) -> CFDictionaryRef {
        self.0 .0
    }
}

/// Read a CFBoolean (returns `None` if not a boolean).
///
/// # Safety
/// `v` must be null or a valid CF object.
pub unsafe fn cf_bool_value(v: CFTypeRef) -> Option<bool> {
    if v.is_null() || CFGetTypeID(v) != CFBooleanGetTypeID() {
        return None;
    }
    Some(CFBooleanGetValue(v) != 0)
}
