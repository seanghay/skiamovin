//! Per-thread handle table. Objects are stored as `Rc<RefCell<T>>` and addressed by non-zero `u32` handles.
//! Handle `0` always means "none".

use crate::R;
use std::any::Any;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

struct Table {
    next: u32,
    objects: HashMap<u32, Rc<dyn Any>>,
}

thread_local! {
    static TABLE: RefCell<Table> = RefCell::new(Table { next: 1, objects: HashMap::new() });
}

/// Stores a value and returns its handle.
pub fn put<T: 'static>(value: T) -> u32 {
    TABLE.with(|t| {
        let mut t = t.borrow_mut();
        let mut h = t.next;
        while h == 0 || t.objects.contains_key(&h) {
            h = h.wrapping_add(1);
        }
        t.next = h.wrapping_add(1);
        t.objects.insert(h, Rc::new(RefCell::new(value)) as Rc<dyn Any>);
        h
    })
}

/// Returns the object behind a handle, or an error if it doesn't exist or has another type.
pub fn get<T: 'static>(h: u32) -> R<Rc<RefCell<T>>> {
    let any = TABLE.with(|t| t.borrow().objects.get(&h).cloned());
    match any {
        None => Err(format!("{}: invalid or deleted handle {h}", short_type::<T>())),
        Some(rc) => rc.downcast::<RefCell<T>>().map_err(|_| format!("handle {h} is not a {}", short_type::<T>())),
    }
}

/// Like `get`, but `0` yields `None`.
pub fn get_opt<T: 'static>(h: u32) -> R<Option<Rc<RefCell<T>>>> {
    if h == 0 {
        Ok(None)
    } else {
        get::<T>(h).map(Some)
    }
}

/// Clones the value behind a handle. Meant for cheap reference-counted Skia types.
pub fn cloned<T: Clone + 'static>(h: u32) -> R<T> {
    Ok(get::<T>(h)?.borrow().clone())
}

pub fn cloned_opt<T: Clone + 'static>(h: u32) -> R<Option<T>> {
    Ok(get_opt::<T>(h)?.map(|v| v.borrow().clone()))
}

pub fn exists(h: u32) -> bool {
    TABLE.with(|t| t.borrow().objects.contains_key(&h))
}

pub fn remove(h: u32) {
    // Drop the value outside the table borrow, since dropping may touch the table.
    // `try_with` because the table may already be gone during thread shutdown.
    let v = TABLE.try_with(|t| t.try_borrow_mut().ok().and_then(|mut t| t.objects.remove(&h))).ok().flatten();
    drop(v);
}

pub fn count() -> u32 {
    TABLE.with(|t| t.borrow().objects.len() as u32)
}

fn short_type<T>() -> &'static str {
    let n = std::any::type_name::<T>().trim_end_matches('>');
    let n = n.rsplit("::").next().unwrap_or(n);
    n.strip_prefix("Sk").unwrap_or(n)
}
