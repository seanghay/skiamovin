//! Runtime helpers for the generated JavaScript bindings: allocation, return buffers and errors.
use std::cell::RefCell;

thread_local! {
    static RET: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static ERR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

pub unsafe fn str_from<'a>(ptr: *const u8, len: usize) -> &'a str {
    if len == 0 {
        return "";
    }
    std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr, len))
}

pub unsafe fn slice_from<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if len == 0 {
        return &[];
    }
    std::slice::from_raw_parts(ptr, len)
}

pub fn ret_bytes(v: Vec<u8>) -> *const u8 {
    RET.with(|r| {
        *r.borrow_mut() = v;
        r.borrow().as_ptr()
    })
}

pub fn ret_vec<T: Copy>(v: Vec<T>) -> *const u8 {
    let bytes =
        unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * std::mem::size_of::<T>()) }.to_vec();
    ret_bytes(bytes)
}

pub fn set_error(e: String) {
    ERR.with(|r| *r.borrow_mut() = e.into_bytes());
}

#[no_mangle]
pub extern "C" fn skm_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn skm_free(p: *mut u8, n: usize) {
    if !p.is_null() {
        drop(Vec::from_raw_parts(p, 0, n.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn skm_ret_len() -> usize {
    RET.with(|r| r.borrow().len())
}

#[no_mangle]
pub extern "C" fn skm_ret_free() {
    RET.with(|r| *r.borrow_mut() = Vec::new());
}

#[no_mangle]
pub extern "C" fn skm_err_len() -> usize {
    ERR.with(|r| r.borrow().len())
}

#[no_mangle]
pub extern "C" fn skm_err_ptr() -> *const u8 {
    ERR.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn skm_err_clear() {
    ERR.with(|r| r.borrow_mut().clear());
}
